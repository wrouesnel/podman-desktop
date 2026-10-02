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

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import type { V1PersistentVolumeClaim, V1Pod } from '@kubernetes/client-node';
import { c as tarCreate, x as tarExtract } from 'tar';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ExecCommandOptions, ExecCommandResult } from '/@/plugin/kubernetes/kubernetes-exec-command.js';

import { HELPER_LABEL, PvcBrowser, type PvcBrowserKubernetesClient } from './pvc-browser.js';

const client = {
  listNamespacedPod: vi.fn(),
  readNamespacedPersistentVolumeClaim: vi.fn(),
  readNamespacedPod: vi.fn(),
  createPod: vi.fn(),
  deleteNamespacedPod: vi.fn(),
  execCommand: vi.fn(),
} satisfies PvcBrowserKubernetesClient;

const settings = { helperImage: 'busybox:test', dragOutMaxSize: 1024 * 1024 };
let browser: PvcBrowser;
let tempDirs: string[] = [];

async function newTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pvc-browser-spec-'));
  tempDirs.push(dir);
  return dir;
}

function pvc(accessModes: string[]): V1PersistentVolumeClaim {
  return { metadata: { name: 'data' }, spec: { accessModes }, status: { accessModes } };
}

function userPod(
  name: string,
  options: { running?: boolean; subPath?: string; readOnly?: boolean; nodeName?: string } = {},
): V1Pod {
  return {
    metadata: { name },
    spec: {
      nodeName: options.nodeName,
      volumes: [{ name: 'vol', persistentVolumeClaim: { claimName: 'data' } }],
      containers: [
        { name: 'sidecar', image: 'x' },
        {
          name: 'app',
          image: 'y',
          volumeMounts: [{ name: 'vol', mountPath: '/var/data', subPath: options.subPath, readOnly: options.readOnly }],
        },
      ],
    },
    status: {
      phase: options.running === false ? 'Pending' : 'Running',
      containerStatuses: [
        { name: 'sidecar', ready: true, restartCount: 0, image: 'x', imageID: 'x', state: { running: {} } },
        { name: 'app', ready: true, restartCount: 0, image: 'y', imageID: 'y', state: { running: {} } },
      ],
    },
  };
}

const runningHelper: V1Pod = { status: { phase: 'Running' } };

function ok(stdout = ''): ExecCommandResult {
  return { exitCode: 0, stdout, stderr: '' };
}

beforeEach(() => {
  vi.resetAllMocks();
  tempDirs = [];
  browser = new PvcBrowser(client, () => settings);
  client.readNamespacedPersistentVolumeClaim.mockResolvedValue(pvc(['ReadWriteOnce']));
  client.listNamespacedPod.mockResolvedValue({ items: [] });
  client.readNamespacedPod.mockResolvedValue(runningHelper);
  client.createPod.mockImplementation(async (_ns: string, body: V1Pod) => body);
  client.deleteNamespacedPod.mockResolvedValue(undefined);
  client.execCommand.mockResolvedValue(ok());
});

afterEach(async () => {
  await browser.dispose();
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

describe('openSession', () => {
  test('reuses a running container mounting the volume and having the needed commands', async () => {
    client.listNamespacedPod.mockResolvedValue({ items: [userPod('pod1', { readOnly: true })] });

    const info = await browser.openSession('ns1', 'data');

    expect(info).toEqual(
      expect.objectContaining({
        namespace: 'ns1',
        pvcName: 'data',
        mode: 'pod',
        podName: 'pod1',
        containerName: 'app',
        root: '/var/data',
        readOnly: true,
      }),
    );
    expect(client.execCommand).toHaveBeenCalledWith('ns1', 'pod1', 'app', [
      'sh',
      '-c',
      expect.stringContaining('command -v tar && command -v find'),
    ]);
    expect(client.createPod).not.toHaveBeenCalled();
  });

  test('creates a helper pod when no container can be used, pinned to the node of a ReadWriteOnce volume', async () => {
    client.listNamespacedPod.mockResolvedValue({
      items: [userPod('subpath', { subPath: 'sub' }), userPod('notools', { nodeName: 'node1' })],
    });
    // notools/app has no tar
    client.execCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' });

    const info = await browser.openSession('ns1', 'data');

    // the container mounting a sub path of the volume is not probed
    expect(client.execCommand).toHaveBeenCalledTimes(1);
    expect(client.execCommand).toHaveBeenCalledWith('ns1', 'notools', 'app', expect.anything());
    expect(info).toEqual(
      expect.objectContaining({
        mode: 'helper',
        containerName: 'browser',
        root: '/pvc',
        readOnly: false,
        helperImage: 'busybox:test',
      }),
    );
    expect(info.podName).toMatch(/^pd-pvc-browser-[0-9a-f]{6}$/);
    const body = client.createPod.mock.calls[0]?.[1] as V1Pod;
    expect(body.metadata?.labels?.[HELPER_LABEL]).toBe('true');
    expect(body.spec?.nodeName).toBe('node1');
    expect(body.spec?.restartPolicy).toBe('Never');
    expect(body.spec?.containers[0]).toEqual(
      expect.objectContaining({
        image: 'busybox:test',
        command: ['sleep', '3600'],
        volumeMounts: [{ name: 'pvc', mountPath: '/pvc', readOnly: false }],
      }),
    );
    expect(body.spec?.volumes).toEqual([
      { name: 'pvc', persistentVolumeClaim: { claimName: 'data', readOnly: false } },
    ]);
  });

  test('a shared volume is not pinned, a ReadOnlyMany volume is read only', async () => {
    client.listNamespacedPod.mockResolvedValue({ items: [userPod('pending', { running: false, nodeName: 'node1' })] });
    client.readNamespacedPersistentVolumeClaim.mockResolvedValue(pvc(['ReadOnlyMany']));

    const info = await browser.openSession('ns1', 'data');

    expect(info.readOnly).toBe(true);
    const body = client.createPod.mock.calls[0]?.[1] as V1Pod;
    expect(body.spec?.nodeName).toBeUndefined();
    expect(body.spec?.volumes?.[0]?.persistentVolumeClaim?.readOnly).toBe(true);
  });

  test('a ReadWriteOncePod volume used by a pod without the needed commands can not be browsed', async () => {
    client.readNamespacedPersistentVolumeClaim.mockResolvedValue(pvc(['ReadWriteOncePod']));
    client.listNamespacedPod.mockResolvedValue({ items: [userPod('pod1')] });
    client.execCommand.mockRejectedValue(new Error('no sh'));

    await expect(browser.openSession('ns1', 'data')).rejects.toThrow(
      'the volume can only be mounted by one pod and it is used by the pod pod1',
    );
    expect(client.createPod).not.toHaveBeenCalled();
  });

  test('the helper pod is deleted when it can not start', async () => {
    client.readNamespacedPod.mockResolvedValue({
      status: {
        phase: 'Pending',
        containerStatuses: [
          {
            name: 'browser',
            ready: false,
            restartCount: 0,
            image: 'x',
            imageID: '',
            state: { waiting: { reason: 'ImagePullBackOff', message: 'pull denied' } },
          },
        ],
      },
    });

    await expect(browser.openSession('ns1', 'data')).rejects.toThrow(/can't start: ImagePullBackOff pull denied/);
    const podName = (client.createPod.mock.calls[0]?.[1] as V1Pod).metadata?.name;
    expect(client.deleteNamespacedPod).toHaveBeenCalledWith(podName, 'ns1');
  });

  test('an unschedulable helper pod fails', async () => {
    client.readNamespacedPod.mockResolvedValue({
      status: {
        phase: 'Pending',
        conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: '0/1 nodes' }],
      },
    });
    await expect(browser.openSession('ns1', 'data')).rejects.toThrow("can't be scheduled: 0/1 nodes");
  });

  test('the stale helper pods are deleted', async () => {
    const helper = (name: string, created: Date, phase: string): V1Pod => ({
      metadata: { name, labels: { [HELPER_LABEL]: 'true' }, creationTimestamp: created },
      spec: { containers: [], volumes: [{ name: 'pvc', persistentVolumeClaim: { claimName: 'data' } }] },
      status: { phase },
    });
    client.listNamespacedPod.mockResolvedValue({
      items: [
        helper('old', new Date(Date.now() - 2 * 3600 * 1000), 'Running'),
        helper('failed', new Date(), 'Failed'),
        helper('recent', new Date(), 'Running'),
      ],
    });

    await browser.openSession('ns1', 'data');

    expect(client.deleteNamespacedPod).toHaveBeenCalledWith('old', 'ns1');
    expect(client.deleteNamespacedPod).toHaveBeenCalledWith('failed', 'ns1');
    expect(client.deleteNamespacedPod).not.toHaveBeenCalledWith('recent', 'ns1');
    // the helpers are not used: a new one is created
    expect(client.createPod).toHaveBeenCalled();
  });

  test('closing a session deletes its helper pod', async () => {
    const info = await browser.openSession('ns1', 'data');
    await browser.closeSession(info.sessionId);

    expect(client.deleteNamespacedPod).toHaveBeenCalledWith(info.podName, 'ns1');
    await expect(browser.list(info.sessionId, '')).rejects.toThrow('the volume browsing session has been closed');
  });
});

describe('operations', () => {
  async function openPodSession(readOnly = false): Promise<string> {
    client.listNamespacedPod.mockResolvedValue({ items: [userPod('pod1', { readOnly })] });
    const info = await browser.openSession('ns1', 'data');
    client.execCommand.mockReset();
    client.execCommand.mockResolvedValue(ok());
    return info.sessionId;
  }

  test('list', async () => {
    const sessionId = await openPodSession();
    client.execCommand.mockResolvedValue(ok('regular file|3|10|-rw-r--r--|/var/data/dir/a\n'));

    await expect(browser.list(sessionId, '../dir')).resolves.toEqual([
      { name: 'a', path: 'dir/a', type: 'file', size: 3, modified: 10000, permissions: '-rw-r--r--' },
    ]);
    expect(client.execCommand).toHaveBeenCalledWith('ns1', 'pod1', 'app', [
      'find',
      '/var/data/dir',
      '-mindepth',
      '1',
      '-maxdepth',
      '1',
      '-exec',
      'stat',
      '-c',
      '%F|%s|%Y|%A|%n',
      '{}',
      '+',
    ]);
  });

  test('a failing command reports its error output', async () => {
    const sessionId = await openPodSession();
    client.execCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'find: /var/data/x: No such file\n' });
    await expect(browser.list(sessionId, 'x')).rejects.toThrow('Unable to list x: find: /var/data/x: No such file');
  });

  test('mkdir, rename and delete', async () => {
    const sessionId = await openPodSession();

    await browser.mkdir(sessionId, 'dir', 'new');
    expect(client.execCommand).toHaveBeenLastCalledWith('ns1', 'pod1', 'app', ['mkdir', '-p', '/var/data/dir/new']);

    await browser.rename(sessionId, 'dir/old', 'new name');
    expect(client.execCommand).toHaveBeenLastCalledWith('ns1', 'pod1', 'app', [
      'sh',
      '-c',
      expect.stringContaining('mv "$1" "$2"'),
      'sh',
      '/var/data/dir/old',
      '/var/data/dir/new name',
    ]);

    await browser.delete(sessionId, ['dir/a', '-rf']);
    expect(client.execCommand).toHaveBeenLastCalledWith('ns1', 'pod1', 'app', [
      'rm',
      '-rf',
      '/var/data/dir/a',
      '/var/data/-rf',
    ]);

    await expect(browser.mkdir(sessionId, '', '../x')).rejects.toThrow('invalid name');
    await expect(browser.rename(sessionId, 'a', 'b/c')).rejects.toThrow('invalid name');
    await expect(browser.rename(sessionId, '..', 'x')).rejects.toThrow('can not be renamed');
    await expect(browser.delete(sessionId, ['a', '../'])).rejects.toThrow('can not be deleted');
  });

  test('a read only volume can not be modified', async () => {
    const sessionId = await openPodSession(true);
    await expect(browser.mkdir(sessionId, '', 'x')).rejects.toThrow('the volume is mounted read only');
    await expect(browser.rename(sessionId, 'a', 'b')).rejects.toThrow('the volume is mounted read only');
    await expect(browser.delete(sessionId, ['a'])).rejects.toThrow('the volume is mounted read only');
    await expect(browser.upload(sessionId, ['/tmp/a'], '')).rejects.toThrow('the volume is mounted read only');
    expect(client.execCommand).not.toHaveBeenCalled();
  });

  // simulates the commands in a container where `remoteRoot` is mounted at /var/data
  function simulateContainer(remoteRoot: string): void {
    const local = (path: string): string => join(remoteRoot, path.replace(/^\/var\/data/, ''));
    client.execCommand.mockImplementation(
      async (_ns: string, _pod: string, _container: string, command: string[], options?: ExecCommandOptions) => {
        if (command[0] === 'du') {
          return ok(
            command
              .slice(2)
              .map(path => `4\t${path}`)
              .join('\n'),
          );
        }
        if (command[0] === 'tar' && command.includes('-cf')) {
          const cwd = local(command[2] ?? '');
          const pack = tarCreate({ cwd }, command.slice(5));
          await new Promise<void>((resolve, reject) => {
            pack.on('end', resolve);
            pack.on('error', reject);
            pack.pipe(options?.stdout as Writable);
          });
          return ok();
        }
        if (command[0] === 'tar' && command.includes('-x')) {
          const unpack = tarExtract({ cwd: local(command[command.length - 1] ?? '') });
          await new Promise<void>((resolve, reject) => {
            unpack.on('close', resolve);
            unpack.on('error', reject);
            (options?.stdin as Readable).pipe(unpack);
          });
          return ok();
        }
        return { exitCode: 127, stdout: '', stderr: 'unexpected command' };
      },
    );
  }

  test('download extracts files and directories, and reports the progress', async () => {
    const sessionId = await openPodSession();
    const remote = await newTempDir();
    await mkdir(join(remote, 'dir/sub'), { recursive: true });
    await writeFile(join(remote, 'dir/a.txt'), 'content a');
    await writeFile(join(remote, 'dir/sub/b.txt'), 'content b');
    await writeFile(join(remote, 'dir/-dash'), 'dash');
    simulateContainer(remote);
    const localDir = await newTempDir();
    const onProgress = vi.fn();

    const result = await browser.download(sessionId, ['dir/a.txt', 'dir/sub', 'dir/-dash'], localDir, { onProgress });

    expect(result).toEqual([join(localDir, 'a.txt'), join(localDir, 'sub'), join(localDir, '-dash')]);
    expect(await readFile(join(localDir, 'a.txt'), 'utf-8')).toBe('content a');
    expect(await readFile(join(localDir, 'sub/b.txt'), 'utf-8')).toBe('content b');
    expect(await readFile(join(localDir, '-dash'), 'utf-8')).toBe('dash');
    expect(client.execCommand).toHaveBeenCalledWith(
      'ns1',
      'pod1',
      'app',
      ['tar', '-C', '/var/data/dir', '-cf', '-', './a.txt', './sub', './-dash'],
      expect.anything(),
    );
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.lastCall?.[1]).toBeGreaterThanOrEqual(3 * 4096);
  });

  test('a failing download is reported', async () => {
    const sessionId = await openPodSession();
    client.execCommand.mockImplementation(async (_ns, _pod, _container, _command, options?: ExecCommandOptions) => {
      options?.stdout?.end();
      return { exitCode: 2, stdout: '', stderr: 'tar: ./x: No such file' };
    });
    await expect(browser.download(sessionId, ['x'], await newTempDir())).rejects.toThrow(
      'Unable to download: tar: ./x: No such file',
    );
  });

  test('upload sends files and directories', async () => {
    const sessionId = await openPodSession();
    const remote = await newTempDir();
    await mkdir(join(remote, 'target'));
    simulateContainer(remote);
    const local = await newTempDir();
    await mkdir(join(local, 'folder/nested'), { recursive: true });
    await writeFile(join(local, 'folder/nested/c.txt'), 'content c');
    await writeFile(join(local, 'd.txt'), 'content d');
    const onProgress = vi.fn();

    await browser.upload(sessionId, [join(local, 'folder'), join(local, 'd.txt')], 'target', { onProgress });

    expect(await readFile(join(remote, 'target/folder/nested/c.txt'), 'utf-8')).toBe('content c');
    expect(await readFile(join(remote, 'target/d.txt'), 'utf-8')).toBe('content d');
    expect(client.execCommand).toHaveBeenCalledWith(
      'ns1',
      'pod1',
      'app',
      ['tar', '-x', '-o', '-f', '-', '-C', '/var/data/target'],
      expect.objectContaining({ stdin: expect.anything() }),
    );
    // the archive is larger than the files (headers)
    expect(onProgress.mock.lastCall?.[0]).toBeGreaterThan(18);
    expect(onProgress.mock.lastCall?.[0]).toBe(onProgress.mock.lastCall?.[1]);
  });

  test('prepareDragOut downloads to a temporary directory, removed when the session is closed', async () => {
    const sessionId = await openPodSession();
    const remote = await newTempDir();
    await writeFile(join(remote, 'e.txt'), 'content e');
    simulateContainer(remote);

    const [file] = await browser.prepareDragOut(sessionId, ['e.txt']);

    expect(file).toBeDefined();
    expect(await readFile(file ?? '', 'utf-8')).toBe('content e');
    expect(browser.isDragOutPath(file ?? '')).toBe(true);
    expect(browser.isDragOutPath(join(remote, 'e.txt'))).toBe(false);
    expect(browser.isDragOutPath(join(file ?? '', '../../../x'))).toBe(false);

    await browser.closeSession(sessionId);
    expect(existsSync(file ?? '')).toBe(false);
    expect(browser.isDragOutPath(file ?? '')).toBe(false);
  });

  test('prepareDragOut refuses large selections', async () => {
    const sessionId = await openPodSession();
    client.execCommand.mockResolvedValue(ok('2048\t/var/data/big\n'));
    await expect(browser.prepareDragOut(sessionId, ['big'])).rejects.toThrow(
      'the selection is too large to be dragged (2 MB, the limit is 1 MB): use Download',
    );
  });
});
