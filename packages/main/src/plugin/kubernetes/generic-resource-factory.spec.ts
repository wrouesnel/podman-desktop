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

import { KubeConfig, KubernetesObjectApi } from '@kubernetes/client-node';
import type { KubernetesResourceTypeInfo } from '@podman-desktop/core-api';
import { GENERIC_KUBERNETES_RESOURCE_TYPES } from '@podman-desktop/core-api';
import { beforeEach, expect, test, vi } from 'vitest';

import { GenericResourceFactory } from './generic-resource-factory.js';
import { KubeConfigSingleContext } from './kubeconfig-single-context.js';
import { ResourceInformer } from './resource-informer.js';

vi.mock(import('./resource-informer.js'));

const statefulsets: KubernetesResourceTypeInfo = {
  resource: 'statefulsets',
  group: 'apps',
  version: 'v1',
  kind: 'StatefulSet',
  plural: 'statefulsets',
  namespaced: true,
  category: 'Workloads',
};

const persistentvolumes: KubernetesResourceTypeInfo = {
  resource: 'persistentvolumes',
  group: '',
  version: 'v1',
  kind: 'PersistentVolume',
  plural: 'persistentvolumes',
  namespaced: false,
  category: 'Storage',
};

let kubeconfig: KubeConfigSingleContext;
const listMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  const config = new KubeConfig();
  config.loadFromOptions({
    clusters: [{ name: 'cluster1', server: 'https://server1' }],
    users: [{ name: 'user1' }],
    contexts: [{ name: 'context1', cluster: 'cluster1', user: 'user1', namespace: 'ns1' }],
    currentContext: 'context1',
  });
  kubeconfig = new KubeConfigSingleContext(config, config.contexts[0]!);
  vi.spyOn(KubeConfig.prototype, 'makeApiClient').mockReturnValue({
    list: listMock,
  } as unknown as KubernetesObjectApi);
});

test('permissions for a namespaced resource', () => {
  const factory = new GenericResourceFactory(statefulsets);
  expect(factory.resource).toEqual('statefulsets');
  expect(factory.permissions?.isNamespaced).toBeTruthy();
  expect(factory.permissions?.permissionsRequests).toEqual([
    { group: '*', resource: '*', verb: 'watch' },
    { group: 'apps', resource: 'statefulsets', verb: 'watch' },
  ]);
});

test('permissions for a non-namespaced core resource', () => {
  const factory = new GenericResourceFactory(persistentvolumes);
  expect(factory.permissions?.isNamespaced).toBeFalsy();
  expect(factory.permissions?.permissionsRequests[1]).toEqual({
    group: '',
    resource: 'persistentvolumes',
    verb: 'watch',
  });
});

test('createInformer for a namespaced resource', async () => {
  const factory = new GenericResourceFactory(statefulsets);
  factory.informer?.createInformer(kubeconfig);
  expect(KubeConfig.prototype.makeApiClient).toHaveBeenCalledWith(KubernetesObjectApi);
  expect(ResourceInformer).toHaveBeenCalledWith(
    expect.objectContaining({
      kubeconfig,
      path: '/apis/apps/v1/namespaces/ns1/statefulsets',
      kind: 'StatefulSet',
      plural: 'statefulsets',
    }),
  );
  const listFn = vi.mocked(ResourceInformer).mock.calls[0]![0].listFn;
  await listFn();
  expect(listMock).toHaveBeenCalledWith('apps/v1', 'StatefulSet', 'ns1');
});

test('createInformer for a non-namespaced resource', async () => {
  const factory = new GenericResourceFactory(persistentvolumes);
  factory.informer?.createInformer(kubeconfig);
  expect(ResourceInformer).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/v1/persistentvolumes',
      kind: 'PersistentVolume',
      plural: 'persistentvolumes',
    }),
  );
  const listFn = vi.mocked(ResourceInformer).mock.calls[0]![0].listFn;
  await listFn();
  expect(listMock).toHaveBeenCalledWith('v1', 'PersistentVolume', undefined);
});

test('generic resource types do not conflict with each other', () => {
  const resources = GENERIC_KUBERNETES_RESOURCE_TYPES.map(info => info.resource);
  expect(new Set(resources).size).toEqual(resources.length);
});
