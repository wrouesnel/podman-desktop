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

import type { KubernetesObject } from '@kubernetes/client-node';
import { getKubernetesResourceTypeApiVersion } from '@podman-desktop/core-api';

import type { KubeResourceDescriptor } from './kube-resource-descriptor';
import type { KubeResourceUI } from './KubeResourceUI';

export function getKubeResourceUI(descriptor: KubeResourceDescriptor, object: KubernetesObject): KubeResourceUI {
  const created = object.metadata?.creationTimestamp;
  return {
    resource: descriptor.info.resource,
    apiVersion: object.apiVersion ?? getKubernetesResourceTypeApiVersion(descriptor.info),
    kind: object.kind ?? descriptor.info.kind,
    uid: object.metadata?.uid ?? '',
    name: object.metadata?.name ?? '',
    namespace: descriptor.info.namespaced ? object.metadata?.namespace : undefined,
    created: created ? new Date(created) : undefined,
    status: descriptor.getStatus(object),
    selected: false,
    values: descriptor.columns.map(column => column.value(object)),
  };
}

export async function deleteKubeResource(resource: KubeResourceUI): Promise<void> {
  await window.kubernetesDeleteResource(resource.apiVersion, resource.kind, resource.name, resource.namespace);
}
