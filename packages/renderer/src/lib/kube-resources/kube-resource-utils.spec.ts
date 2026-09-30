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
import { beforeEach, expect, test, vi } from 'vitest';

import { BUILTIN_RESOURCE_DESCRIPTORS } from './kube-resource-descriptor';
import { deleteKubeResource, getKubeResourceUI } from './kube-resource-utils';

const statefulsets = BUILTIN_RESOURCE_DESCRIPTORS.find(d => d.info.resource === 'statefulsets')!;
const persistentvolumes = BUILTIN_RESOURCE_DESCRIPTORS.find(d => d.info.resource === 'persistentvolumes')!;

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'kubernetesDeleteResource', { value: vi.fn(), writable: true });
});

test('getKubeResourceUI for a namespaced resource', () => {
  const object: KubernetesObject = {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: { name: 'web', namespace: 'ns1', uid: 'uid1', creationTimestamp: new Date('2026-01-01T00:00:00Z') },
    spec: { replicas: 1 },
    status: { readyReplicas: 1 },
  } as KubernetesObject;
  expect(getKubeResourceUI(statefulsets, object)).toEqual({
    resource: 'statefulsets',
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    uid: 'uid1',
    name: 'web',
    namespace: 'ns1',
    created: new Date('2026-01-01T00:00:00Z'),
    status: 'RUNNING',
    selected: false,
    values: ['1/1', undefined],
  });
});

test('getKubeResourceUI for a non-namespaced resource without apiVersion and kind', () => {
  const object: KubernetesObject = {
    metadata: { name: 'pv1' },
  };
  const ui = getKubeResourceUI(persistentvolumes, object);
  expect(ui.apiVersion).toEqual('v1');
  expect(ui.kind).toEqual('PersistentVolume');
  expect(ui.namespace).toBeUndefined();
  expect(ui.created).toBeUndefined();
});

test('deleteKubeResource', async () => {
  const ui = getKubeResourceUI(statefulsets, {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: { name: 'web', namespace: 'ns1' },
  });
  await deleteKubeResource(ui);
  expect(window.kubernetesDeleteResource).toHaveBeenCalledWith('apps/v1', 'StatefulSet', 'web', 'ns1');
});
