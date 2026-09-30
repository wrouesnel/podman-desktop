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

import { isDeepStrictEqual } from 'node:util';

import type { KubernetesObject, V1CustomResourceDefinition } from '@kubernetes/client-node';
import { CustomObjectsApi } from '@kubernetes/client-node';
import type { Disposable } from '@podman-desktop/api';
import type { KubernetesResourceTypeInfo } from '@podman-desktop/core-api';
import { getCustomResourceTypeInfo } from '@podman-desktop/core-api';

import type { KubeConfigSingleContext } from './kubeconfig-single-context.js';

const DEFAULT_PROBE_INTERVAL_MS = 60_000;
const MAX_CONCURRENT_PROBES = 4;

export interface CustomResourcesMonitorOptions {
  kubeconfig: KubeConfigSingleContext;
  // called when instances of a custom resource type have been found, and the resources should be watched
  onInstantiated: (info: KubernetesResourceTypeInfo) => void;
  // called when a custom resource type, previously reported as instantiated, is removed or changed,
  // and the resources should not be watched anymore
  onRemoved: (resource: string) => void;
  probeIntervalMs?: number;
}

// CustomResourcesMonitor finds the custom resource types having instances (in the current namespace of the context
// for namespaced types), to avoid watching the resources of all the CRDs of the cluster.
//
// The types without instances are probed (listing at most one resource) when they are discovered,
// then periodically, until instances are found.
export class CustomResourcesMonitor implements Disposable {
  #options: CustomResourcesMonitorOptions;
  #client: CustomObjectsApi;
  // all the custom resource types, by resource name
  #types = new Map<string, KubernetesResourceTypeInfo>();
  // the types reported as instantiated
  #instantiated = new Set<string>();
  // the types waiting to be probed, and the ones being probed
  #queue: string[] = [];
  #probing = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  #disposed = false;

  constructor(options: CustomResourcesMonitorOptions) {
    this.#options = options;
    this.#client = options.kubeconfig.getKubeConfig().makeApiClient(CustomObjectsApi);
  }

  start(): void {
    this.#timer = setInterval(() => this.probeAll(), this.#options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS);
  }

  // update must be called with the complete list of CRDs every time it changes
  update(crds: readonly KubernetesObject[]): void {
    const types = new Map<string, KubernetesResourceTypeInfo>();
    for (const crd of crds) {
      const info = getCustomResourceTypeInfo(crd as V1CustomResourceDefinition);
      if (info) {
        types.set(info.resource, info);
      }
    }
    for (const [resource, info] of this.#types) {
      if (!isDeepStrictEqual(types.get(resource), info)) {
        this.#types.delete(resource);
        if (this.#instantiated.delete(resource)) {
          this.#options.onRemoved(resource);
        }
      }
    }
    for (const [resource, info] of types) {
      if (!this.#types.has(resource)) {
        this.#types.set(resource, info);
        this.enqueue(resource);
      }
    }
  }

  private probeAll(): void {
    for (const resource of this.#types.keys()) {
      this.enqueue(resource);
    }
  }

  private enqueue(resource: string): void {
    if (this.#instantiated.has(resource) || this.#queue.includes(resource) || this.#probing.has(resource)) {
      return;
    }
    this.#queue.push(resource);
    this.drain();
  }

  private drain(): void {
    while (!this.#disposed && this.#probing.size < MAX_CONCURRENT_PROBES && this.#queue.length) {
      const resource = this.#queue.shift();
      const info = resource ? this.#types.get(resource) : undefined;
      if (!info) {
        continue;
      }
      this.#probing.add(info.resource);
      this.probe(info)
        .catch((err: unknown) => console.debug(`unable to probe custom resources ${info.resource}: ${String(err)}`))
        .finally(() => {
          this.#probing.delete(info.resource);
          this.drain();
        });
    }
  }

  private async probe(info: KubernetesResourceTypeInfo): Promise<void> {
    const namespace = this.#options.kubeconfig.getNamespace();
    const list: { items?: unknown[] } = info.namespaced
      ? await this.#client.listNamespacedCustomObject({
          group: info.group,
          version: info.version,
          namespace,
          plural: info.plural,
          limit: 1,
        })
      : await this.#client.listClusterCustomObject({
          group: info.group,
          version: info.version,
          plural: info.plural,
          limit: 1,
        });
    // the type may have been removed or changed during the request
    if (this.#disposed || this.#types.get(info.resource) !== info || this.#instantiated.has(info.resource)) {
      return;
    }
    if (list.items?.length) {
      this.#instantiated.add(info.resource);
      this.#options.onInstantiated(info);
    }
  }

  dispose(): void {
    this.#disposed = true;
    clearInterval(this.#timer);
    this.#queue = [];
  }
}
