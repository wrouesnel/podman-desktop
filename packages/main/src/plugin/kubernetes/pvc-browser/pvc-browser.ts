/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import { PassThrough, Transform, type TransformCallback } from 'node:stream';

import type { V1Container, V1PersistentVolumeClaim, V1Pod, V1PodList } from '@kubernetes/client-node';
import type { PvcBrowserSessionInfo, PvcFileEntry } from '@podman-desktop/core-api';
import { c as tarCreate, x as tarExtract } from 'tar';

import type { ExecCommandOptions, ExecCommandResult } from '/@/plugin/kubernetes/kubernetes-exec-command.js';

import { checkFileName, normalizeRelativePath, parseStatOutput, STAT_FORMAT, toContainerPath } from './pvc-paths.js';

// the Kubernetes operations used by the browser
export interface PvcBrowserKubernetesClient {
  listNamespacedPod(namespace: string, fieldSelector?: string, labelSelector?: string): Promise<V1PodList>;
  readNamespacedPersistentVolumeClaim(name: string, namespace: string): Promise<V1PersistentVolumeClaim | undefined>;
  readNamespacedPod(name: string, namespace: string): Promise<V1Pod>;
  createPod(namespace: string, body: V1Pod): Promise<V1Pod>;
  deleteNamespacedPod(name: string, namespace: string): Promise<void>;
  execCommand(
    namespace: string,
    podName: string,
    containerName: string,
    command: string[],
    options?: ExecCommandOptions,
  ): Promise<ExecCommandResult>;
}

export interface PvcBrowserSettings {
  // the image of the helper pods
  helperImage: string;
  // the maximum size of the files downloaded to be dragged out of the application, in bytes
  dragOutMaxSize: number;
}

export interface TransferOptions {
  // called with the number of bytes transferred, and the estimated total
  onProgress?: (transferred: number, total: number) => void;
  signal?: AbortSignal;
}

export const HELPER_LABEL = 'podman-desktop.io/pvc-browser';
export const HELPER_PVC_ANNOTATION = 'podman-desktop.io/pvc-browser-claim';
export const HELPER_CONTAINER = 'browser';
export const HELPER_ROOT = '/pvc';
// the helper pods exit after this time (the stale ones are deleted when a session is opened)
export const HELPER_LIFETIME_SECONDS = 3600;
export const HELPER_START_TIMEOUT_MS = 60_000;
export const HELPER_POLL_MS = 1_000;
export const DEFAULT_HELPER_IMAGE = 'docker.io/library/busybox:1.37';
export const DEFAULT_DRAG_OUT_MAX_SIZE = 50 * 1024 * 1024;

// the commands needed in a container to browse its volume
const REQUIRED_TOOLS = ['tar', 'find', 'stat', 'mkdir', 'mv', 'rm', 'du'];
const PROBE_COMMAND = ['sh', '-c', REQUIRED_TOOLS.map(tool => `command -v ${tool}`).join(' && ')];

// waiting reasons of a container meaning that the helper pod will never start
const HELPER_FAILURE_REASONS = [
  'ErrImagePull',
  'ImagePullBackOff',
  'InvalidImageName',
  'ErrImageNeverPull',
  'CreateContainerConfigError',
  'CreateContainerError',
];

interface Session {
  info: PvcBrowserSessionInfo;
  // temporary directory of the files prepared for drag-out
  tempDir?: string;
}

// counts the bytes going through
class ByteCounter extends Transform {
  #count = 0;

  constructor(private readonly onCount: (count: number) => void) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#count += chunk.length;
    this.onCount(this.#count);
    callback(undefined, chunk);
  }
}

function isRunning(pod: V1Pod): boolean {
  return pod.status?.phase === 'Running' && !pod.metadata?.deletionTimestamp;
}

function isTerminated(pod: V1Pod): boolean {
  return pod.status?.phase === 'Succeeded' || pod.status?.phase === 'Failed';
}

function isHelper(pod: V1Pod): boolean {
  return pod.metadata?.labels?.[HELPER_LABEL] !== undefined;
}

// the names of the volumes of a pod using the claim
function getClaimVolumes(pod: V1Pod, pvcName: string): { name: string; readOnly: boolean }[] {
  return (pod.spec?.volumes ?? [])
    .filter(volume => volume.persistentVolumeClaim?.claimName === pvcName)
    .map(volume => ({ name: volume.name, readOnly: !!volume.persistentVolumeClaim?.readOnly }));
}

function commandError(action: string, result: ExecCommandResult): Error {
  const details = result.stderr.trim() || `exit code ${result.exitCode ?? 'unknown'}`;
  return new Error(`${action}: ${details}`);
}

async function getLocalSize(path: string): Promise<number> {
  const stats = await stat(path);
  if (!stats.isDirectory()) {
    return stats.size;
  }
  const entries = await readdir(path);
  const sizes = await Promise.all(entries.map(entry => getLocalSize(join(path, entry))));
  return sizes.reduce((total, size) => total + size, 0);
}

/**
 * Browses the files of PersistentVolumeClaims: the commands are executed in a container of a running pod
 * mounting the volume, or in a temporary helper pod when there is none with the needed tools
 */
export class PvcBrowser {
  #sessions = new Map<string, Session>();

  constructor(
    private readonly client: PvcBrowserKubernetesClient,
    private readonly getSettings: () => PvcBrowserSettings,
  ) {}

  async openSession(namespace: string, pvcName: string, signal?: AbortSignal): Promise<PvcBrowserSessionInfo> {
    const pvc = await this.client.readNamespacedPersistentVolumeClaim(pvcName, namespace);
    if (!pvc) {
      throw new Error(`PersistentVolumeClaim ${pvcName} not found in namespace ${namespace}`);
    }
    const pods = (await this.client.listNamespacedPod(namespace)).items;
    const users = pods.filter(pod => !isHelper(pod) && !isTerminated(pod) && getClaimVolumes(pod, pvcName).length);

    const sessionId = randomUUID();
    const access =
      (await this.findPodAccess(namespace, pvcName, users)) ??
      (await this.createHelper(namespace, pvc, pvcName, users, pods, signal));
    const info: PvcBrowserSessionInfo = { sessionId, namespace, pvcName, ...access };
    this.#sessions.set(sessionId, { info });
    return info;
  }

  // a container of a running pod mounting the whole volume and having the needed tools
  protected async findPodAccess(
    namespace: string,
    pvcName: string,
    users: V1Pod[],
  ): Promise<Pick<PvcBrowserSessionInfo, 'mode' | 'podName' | 'containerName' | 'root' | 'readOnly'> | undefined> {
    for (const pod of users.filter(isRunning)) {
      const podName = pod.metadata?.name ?? '';
      const volumes = getClaimVolumes(pod, pvcName);
      const containers: V1Container[] = pod.spec?.containers ?? [];
      for (const container of containers) {
        const running = pod.status?.containerStatuses?.find(status => status.name === container.name)?.state?.running;
        const mount = container.volumeMounts?.find(
          mount => volumes.some(volume => volume.name === mount.name) && !mount.subPath && !mount.subPathExpr,
        );
        if (!running || !mount) {
          continue;
        }
        const volume = volumes.find(volume => volume.name === mount.name);
        const usable = await this.client
          .execCommand(namespace, podName, container.name, PROBE_COMMAND)
          .then(result => result.exitCode === 0)
          .catch(() => false);
        if (usable) {
          return {
            mode: 'pod',
            podName,
            containerName: container.name,
            root: mount.mountPath,
            readOnly: !!mount.readOnly || !!volume?.readOnly,
          };
        }
      }
    }
    return undefined;
  }

  protected async createHelper(
    namespace: string,
    pvc: V1PersistentVolumeClaim,
    pvcName: string,
    users: V1Pod[],
    pods: V1Pod[],
    signal?: AbortSignal,
  ): Promise<Pick<PvcBrowserSessionInfo, 'mode' | 'podName' | 'containerName' | 'root' | 'readOnly' | 'helperImage'>> {
    const accessModes = pvc.status?.accessModes ?? pvc.spec?.accessModes ?? [];
    if (accessModes.includes('ReadWriteOncePod') && users.length) {
      throw new Error(
        `the volume can only be mounted by one pod and it is used by the pod ${users[0]?.metadata?.name}, ` +
          `which has no container with the needed commands (${REQUIRED_TOOLS.join(', ')})`,
      );
    }
    const readOnly = accessModes.length > 0 && accessModes.every(mode => mode === 'ReadOnlyMany');
    // a ReadWriteOnce volume can only be mounted on one node: the helper is started on the node using it
    const shared = accessModes.some(mode => mode === 'ReadWriteMany' || mode === 'ReadOnlyMany');
    const nodeName = shared ? undefined : users.find(pod => pod.spec?.nodeName)?.spec?.nodeName;

    await this.deleteStaleHelpers(namespace, pods);

    const helperImage = this.getSettings().helperImage || DEFAULT_HELPER_IMAGE;
    const podName = `pd-pvc-browser-${randomBytes(3).toString('hex')}`;
    const body: V1Pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        namespace,
        labels: { 'app.kubernetes.io/managed-by': 'podman-desktop', [HELPER_LABEL]: 'true' },
        annotations: { [HELPER_PVC_ANNOTATION]: pvcName },
      },
      spec: {
        containers: [
          {
            name: HELPER_CONTAINER,
            image: helperImage,
            command: ['sleep', String(HELPER_LIFETIME_SECONDS)],
            volumeMounts: [{ name: 'pvc', mountPath: HELPER_ROOT, readOnly }],
          },
        ],
        volumes: [{ name: 'pvc', persistentVolumeClaim: { claimName: pvcName, readOnly } }],
        restartPolicy: 'Never',
        terminationGracePeriodSeconds: 0,
        nodeName,
      },
    };
    await this.client.createPod(namespace, body);
    try {
      await this.waitForHelper(namespace, podName, signal);
    } catch (error: unknown) {
      await this.deleteHelper(namespace, podName);
      throw error;
    }
    return { mode: 'helper', podName, containerName: HELPER_CONTAINER, root: HELPER_ROOT, readOnly, helperImage };
  }

  protected async waitForHelper(namespace: string, podName: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + HELPER_START_TIMEOUT_MS;
    for (;;) {
      if (signal?.aborted) {
        throw new Error('the opening of the volume has been cancelled');
      }
      const pod = await this.client.readNamespacedPod(podName, namespace);
      if (isRunning(pod)) {
        return;
      }
      if (isTerminated(pod)) {
        throw new Error(`the helper pod ${podName} has terminated: ${pod.status?.message ?? pod.status?.phase}`);
      }
      const waiting = pod.status?.containerStatuses?.find(status => status.state?.waiting)?.state?.waiting;
      if (waiting?.reason && HELPER_FAILURE_REASONS.includes(waiting.reason)) {
        throw new Error(`the helper pod ${podName} can't start: ${waiting.reason} ${waiting.message ?? ''}`.trim());
      }
      const unschedulable = pod.status?.conditions?.find(
        condition => condition.type === 'PodScheduled' && condition.reason === 'Unschedulable',
      );
      if (unschedulable) {
        throw new Error(`the helper pod ${podName} can't be scheduled: ${unschedulable.message ?? ''}`.trim());
      }
      if (Date.now() >= deadline) {
        throw new Error(`the helper pod ${podName} did not start in ${HELPER_START_TIMEOUT_MS / 1000} seconds`);
      }
      await new Promise(resolve => setTimeout(resolve, HELPER_POLL_MS));
    }
  }

  // the helpers left by previous sessions (not closed when the application has been stopped)
  protected async deleteStaleHelpers(namespace: string, pods: V1Pod[]): Promise<void> {
    const active = new Set(Array.from(this.#sessions.values()).map(session => session.info.podName));
    const now = Date.now();
    const stale = pods.filter(pod => {
      if (!isHelper(pod) || active.has(pod.metadata?.name ?? '')) {
        return false;
      }
      const created = pod.metadata?.creationTimestamp ? new Date(pod.metadata.creationTimestamp).getTime() : now;
      return isTerminated(pod) || now - created > HELPER_LIFETIME_SECONDS * 1000;
    });
    await Promise.all(stale.map(pod => this.deleteHelper(namespace, pod.metadata?.name ?? '')));
  }

  protected async deleteHelper(namespace: string, podName: string): Promise<void> {
    try {
      await this.client.deleteNamespacedPod(podName, namespace);
    } catch (error: unknown) {
      console.warn(`Unable to delete the helper pod ${podName}`, error);
    }
  }

  getSession(sessionId: string): PvcBrowserSessionInfo {
    return this.#getSession(sessionId).info;
  }

  #getSession(sessionId: string): Session {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new Error('the volume browsing session has been closed');
    }
    return session;
  }

  #checkWritable(session: Session): void {
    if (session.info.readOnly) {
      throw new Error('the volume is mounted read only');
    }
  }

  async #exec(session: Session, command: string[], options?: ExecCommandOptions): Promise<ExecCommandResult> {
    const { namespace, podName, containerName } = session.info;
    return this.client.execCommand(namespace, podName, containerName, command, options);
  }

  async #run(session: Session, action: string, command: string[]): Promise<string> {
    const { namespace, podName, containerName } = session.info;
    const result = await this.client.execCommand(namespace, podName, containerName, command);
    if (result.exitCode !== 0) {
      throw commandError(action, result);
    }
    return result.stdout;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.#sessions.delete(sessionId);
    if (session.info.mode === 'helper') {
      await this.deleteHelper(session.info.namespace, session.info.podName);
    }
    if (session.tempDir) {
      await rm(session.tempDir, { recursive: true, force: true });
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(Array.from(this.#sessions.keys()).map(sessionId => this.closeSession(sessionId)));
  }

  async list(sessionId: string, dir: string): Promise<PvcFileEntry[]> {
    const session = this.#getSession(sessionId);
    const containerDir = toContainerPath(session.info.root, dir);
    const output = await this.#run(session, `Unable to list ${dir || '/'}`, [
      'find',
      containerDir,
      '-mindepth',
      '1',
      '-maxdepth',
      '1',
      '-exec',
      'stat',
      '-c',
      STAT_FORMAT,
      '{}',
      '+',
    ]);
    return parseStatOutput(output, dir);
  }

  async mkdir(sessionId: string, dir: string, name: string): Promise<void> {
    const session = this.#getSession(sessionId);
    this.#checkWritable(session);
    checkFileName(name);
    const path = posix.join(toContainerPath(session.info.root, dir), name);
    await this.#run(session, `Unable to create the folder ${name}`, ['mkdir', '-p', path]);
  }

  async rename(sessionId: string, path: string, newName: string): Promise<void> {
    const session = this.#getSession(sessionId);
    this.#checkWritable(session);
    checkFileName(newName);
    const relative = normalizeRelativePath(path);
    if (!relative) {
      throw new Error('the root of the volume can not be renamed');
    }
    const source = toContainerPath(session.info.root, relative);
    const target = posix.join(posix.dirname(source), newName);
    // the paths are given as arguments of the script: they are not interpreted by the shell
    await this.#run(session, `Unable to rename ${posix.basename(relative)}`, [
      'sh',
      '-c',
      'if [ -e "$2" ] || [ -L "$2" ]; then echo "$(basename "$2") already exists" >&2; exit 1; fi; mv "$1" "$2"',
      'sh',
      source,
      target,
    ]);
  }

  async delete(sessionId: string, paths: string[]): Promise<void> {
    const session = this.#getSession(sessionId);
    this.#checkWritable(session);
    const relatives = paths.map(normalizeRelativePath);
    if (!relatives.length || relatives.some(relative => !relative)) {
      throw new Error('the root of the volume can not be deleted');
    }
    await this.#run(session, 'Unable to delete', [
      'rm',
      '-rf',
      ...relatives.map(relative => toContainerPath(session.info.root, relative)),
    ]);
  }

  // the size of files and directories, in bytes (approximate: disk usage)
  async getSize(sessionId: string, paths: string[]): Promise<number> {
    const session = this.#getSession(sessionId);
    const containerPaths = paths.map(path => toContainerPath(session.info.root, path));
    const output = await this.#run(session, 'Unable to compute the size', ['du', '-sk', ...containerPaths]);
    return output
      .split('\n')
      .map(line => Number.parseInt(line.split(/\s/)[0] ?? '', 10))
      .filter(size => !Number.isNaN(size))
      .reduce((total, size) => total + size * 1024, 0);
  }

  /**
   * Downloads files and directories of the volume into a local directory; returns the local paths
   */
  async download(sessionId: string, paths: string[], localDir: string, options?: TransferOptions): Promise<string[]> {
    const session = this.#getSession(sessionId);
    const relatives = paths.map(normalizeRelativePath).filter(relative => !!relative);
    if (!relatives.length) {
      throw new Error('nothing to download');
    }
    const total = options?.onProgress ? await this.getSize(sessionId, relatives).catch(() => 0) : 0;

    // one archive per parent directory
    const byParent = new Map<string, string[]>();
    for (const relative of relatives) {
      const parent = posix.dirname(relative);
      byParent.set(parent, [...(byParent.get(parent) ?? []), posix.basename(relative)]);
    }
    let transferred = 0;
    for (const [parent, names] of byParent) {
      const done = transferred;
      const counter = new ByteCounter(count => {
        transferred = done + count;
        options?.onProgress?.(transferred, Math.max(total, transferred));
      });
      const unpack = tarExtract({ cwd: localDir });
      const extracted = new Promise<void>((resolve, reject) => {
        unpack.on('close', () => resolve());
        unpack.on('error', reject);
      });
      counter.pipe(unpack);
      // ./name: names starting with a dash are not taken as options
      const result = await this.#exec(
        session,
        ['tar', '-C', toContainerPath(session.info.root, parent === '.' ? '' : parent), '-cf', '-'].concat(
          names.map(name => `./${name}`),
        ),
        { stdout: counter, signal: options?.signal },
      );
      if (result.exitCode !== 0) {
        // the extraction of an incomplete archive fails too
        extracted.catch(() => {});
        throw commandError('Unable to download', result);
      }
      await extracted;
    }
    return relatives.map(relative => join(localDir, posix.basename(relative)));
  }

  /**
   * Uploads local files and directories into a directory of the volume
   */
  async upload(sessionId: string, localPaths: string[], dir: string, options?: TransferOptions): Promise<void> {
    const session = this.#getSession(sessionId);
    this.#checkWritable(session);
    if (!localPaths.length) {
      return;
    }
    const containerDir = toContainerPath(session.info.root, dir);
    const total = options?.onProgress
      ? (await Promise.all(localPaths.map(getLocalSize))).reduce((sum, size) => sum + size, 0)
      : 0;

    let transferred = 0;
    for (const localPath of localPaths) {
      const done = transferred;
      const counter = new ByteCounter(count => {
        transferred = done + count;
        options?.onProgress?.(transferred, Math.max(total, transferred));
      });
      const pack = tarCreate({ cwd: dirname(localPath), portable: true }, [basename(localPath)]);
      const stdin = new PassThrough();
      pack.on('error', (error: unknown) => stdin.destroy(error instanceof Error ? error : new Error(String(error))));
      pack.pipe(counter).pipe(stdin);
      // -o: the files belong to the user extracting them
      const result = await this.#exec(session, ['tar', '-x', '-o', '-f', '-', '-C', containerDir], {
        stdin,
        signal: options?.signal,
      });
      if (result.exitCode !== 0) {
        throw commandError(`Unable to upload ${basename(localPath)}`, result);
      }
    }
  }

  // a path returned by prepareDragOut
  isDragOutPath(path: string): boolean {
    const resolved = resolve(path);
    return Array.from(this.#sessions.values()).some(
      session => session.tempDir && resolved.startsWith(session.tempDir + sep),
    );
  }

  /**
   * Downloads files to a temporary directory, so they can be dragged out of the application
   */
  async prepareDragOut(sessionId: string, paths: string[], signal?: AbortSignal): Promise<string[]> {
    const session = this.#getSession(sessionId);
    const maxSize = this.getSettings().dragOutMaxSize;
    const size = await this.getSize(sessionId, paths);
    if (size > maxSize) {
      throw new Error(
        `the selection is too large to be dragged (${Math.ceil(size / 1024 / 1024)} MB, the limit is ` +
          `${Math.floor(maxSize / 1024 / 1024)} MB): use Download`,
      );
    }
    session.tempDir ??= await mkdtemp(join(tmpdir(), 'pd-pvc-'));
    const target = await mkdtemp(join(session.tempDir, 'drag-'));
    return this.download(sessionId, paths, target, { signal });
  }
}
