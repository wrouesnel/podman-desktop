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

import type { KubeContext, ResourceCount } from '@podman-desktop/core-api';
import type { writable } from 'svelte/store';
import { expect, test, vi } from 'vitest';

import {
  BUILTIN_RESOURCE_DESCRIPTORS,
  type KubeResourceDescriptor,
} from '/@/lib/kube-resources/kube-resource-descriptor';

import { createNavigationKubernetesResourcesEntries } from './navigation-registry-k8s-resources.svelte';

const mocks = vi.hoisted(() => ({
  descriptors: undefined as unknown,
  contexts: undefined as unknown,
  counts: undefined as unknown,
}));

vi.mock(import('/@/stores/kubernetes-resource-descriptors'), async () => {
  const { writable } = await import('svelte/store');
  mocks.descriptors = writable([]);
  return { kubernetesNavigationResourceDescriptors: mocks.descriptors } as never;
});
vi.mock(import('/@/stores/kubernetes-contexts'), async () => {
  const { writable } = await import('svelte/store');
  mocks.contexts = writable([]);
  return { kubernetesContexts: mocks.contexts } as never;
});
vi.mock(import('/@/stores/kubernetes-resources-count'), async () => {
  const { writable } = await import('svelte/store');
  mocks.counts = writable([]);
  return { kubernetesResourcesCount: mocks.counts } as never;
});

function getDescriptor(resource: string): KubeResourceDescriptor {
  return BUILTIN_RESOURCE_DESCRIPTORS.find(d => d.info.resource === resource)!;
}

test('entries are sorted by category, with counters for the current context', async () => {
  const descriptorsStore = mocks.descriptors as ReturnType<typeof writable<KubeResourceDescriptor[]>>;
  const contextsStore = mocks.contexts as ReturnType<typeof writable<KubeContext[]>>;
  const countsStore = mocks.counts as ReturnType<typeof writable<ResourceCount[]>>;

  const result = createNavigationKubernetesResourcesEntries();
  expect(result.entries).toEqual([]);

  descriptorsStore.set([
    getDescriptor('namespaces'),
    getDescriptor('persistentvolumes'),
    getDescriptor('statefulsets'),
  ]);
  contextsStore.set([
    { name: 'ctx1', currentContext: true } as KubeContext,
    { name: 'ctx2', currentContext: false } as KubeContext,
  ]);
  countsStore.set([
    { contextName: 'ctx1', resourceName: 'statefulsets', count: 3 },
    { contextName: 'ctx2', resourceName: 'statefulsets', count: 5 },
    { contextName: 'ctx2', resourceName: 'namespaces', count: 2 },
  ]);

  await vi.waitFor(() => {
    expect(result.entries.map(e => e.name)).toEqual(['StatefulSets', 'PersistentVolumes', 'Namespaces']);
  });
  expect(result.entries[0]).toEqual(
    expect.objectContaining({
      tooltip: 'StatefulSets',
      link: '/kubernetes/resources/statefulsets',
      type: 'entry',
    }),
  );
  expect(result.entries.map(e => e.counter)).toEqual([3, 0, 0]);
});
