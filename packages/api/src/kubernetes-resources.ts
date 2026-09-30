/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import type { KubernetesObject } from '@kubernetes/client-node';

export interface KubernetesContextResources {
  contextName: string;
  items: readonly KubernetesObject[];
}

// identifies a state of the resources of a context, to request the changes since this state
export interface KubernetesResourcesVersion {
  // identifies the source of the resources (it changes when the informer is restarted)
  epoch: string;
  // incremented on each change of the resources
  generation: number;
}

// KubernetesResourcesChanges are the changes of the resources of a context since a given version,
// or all the resources when `full` is true
export interface KubernetesResourcesChanges extends KubernetesResourcesVersion {
  contextName: string;
  // true when `items` contains all the resources, and the resources known by the receiver must be replaced
  full: boolean;
  // the resources added or updated since the requested version (all the resources if `full` is true)
  items: readonly KubernetesObject[];
  // the keys (see getKubernetesObjectKey) of the resources deleted since the requested version
  deleted: readonly string[];
}

// getKubernetesObjectKey returns a key identifying a Kubernetes object
export function getKubernetesObjectKey(object: KubernetesObject): string {
  return object.metadata?.uid ?? `${object.metadata?.namespace ?? ''}/${object.metadata?.name ?? ''}`;
}
