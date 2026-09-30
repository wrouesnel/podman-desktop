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
import type { IDisposable, KubeContext, ResourceCount } from '@podman-desktop/core-api';
import { get } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import { listenResources } from '/@/lib/kube/resources-listen';
import { BUILTIN_RESOURCE_DESCRIPTORS } from '/@/lib/kube-resources/kube-resource-descriptor';
import { buildCRD } from '/@/lib/kube-resources/tests-helpers/crd';

import { kubernetesContexts } from './kubernetes-contexts';
import { isKubernetesExperimentalModeStore } from './kubernetes-experimental';
import {
  kubernetesNavigationResourceDescriptors,
  kubernetesResourceDescriptors,
} from './kubernetes-resource-descriptors';
import { kubernetesResourcesCount } from './kubernetes-resources-count';

vi.mock(import('/@/lib/kube/resources-listen'));

let sendCRDs: (crds: KubernetesObject[]) => void;
const disposeMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  isKubernetesExperimentalModeStore.set(false);
  vi.mocked(listenResources).mockImplementation(async (resourceName, _options, callback): Promise<IDisposable> => {
    expect(resourceName).toEqual('customresourcedefinitions');
    sendCRDs = callback;
    return { dispose: disposeMock };
  });
  kubernetesContexts.set([{ name: 'ctx1', currentContext: true } as KubeContext]);
  kubernetesResourcesCount.set([]);
});

test('no generic resources in the navigation when experimental mode is disabled', () => {
  expect(get(kubernetesNavigationResourceDescriptors)).toEqual([]);
  expect(get(kubernetesResourceDescriptors)).toEqual(BUILTIN_RESOURCE_DESCRIPTORS);
  expect(listenResources).not.toHaveBeenCalled();
});

test('custom resources are displayed in the navigation when they have instances in the current context', async () => {
  isKubernetesExperimentalModeStore.set(true);
  const values: string[][] = [];
  const unsubscribe = kubernetesNavigationResourceDescriptors.subscribe(descriptors =>
    values.push(descriptors.map(d => d.info.resource)),
  );
  await vi.waitFor(() => expect(listenResources).toHaveBeenCalled());

  sendCRDs([buildCRD('cert-manager.io', 'Certificate', 'certificates'), buildCRD('example.com', 'Widget', 'widgets')]);

  // all CRDs are available for the list and details pages
  expect(get(kubernetesResourceDescriptors).map(d => d.info.resource)).toEqual(
    expect.arrayContaining(['certificates.cert-manager.io', 'widgets.example.com']),
  );
  // only built-in types in the navigation, as there are no instances
  expect(values.at(-1)).toEqual(BUILTIN_RESOURCE_DESCRIPTORS.map(d => d.info.resource));

  kubernetesResourcesCount.set([
    { contextName: 'ctx1', resourceName: 'certificates.cert-manager.io', count: 2 },
    { contextName: 'ctx1', resourceName: 'widgets.example.com', count: 0 },
    { contextName: 'ctx2', resourceName: 'widgets.example.com', count: 4 },
  ] as ResourceCount[]);
  expect(values.at(-1)).toEqual([
    ...BUILTIN_RESOURCE_DESCRIPTORS.map(d => d.info.resource),
    'certificates.cert-manager.io',
  ]);

  // switching context
  kubernetesContexts.set([
    { name: 'ctx1', currentContext: false } as KubeContext,
    { name: 'ctx2', currentContext: true } as KubeContext,
  ]);
  expect(values.at(-1)).toEqual([...BUILTIN_RESOURCE_DESCRIPTORS.map(d => d.info.resource), 'widgets.example.com']);

  unsubscribe();
  expect(disposeMock).toHaveBeenCalled();
});
