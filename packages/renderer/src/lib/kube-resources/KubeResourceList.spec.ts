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

import '@testing-library/jest-dom/vitest';

import type { KubernetesObject } from '@kubernetes/client-node';
import type { IDisposable } from '@podman-desktop/core-api';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import { listenResources } from '/@/lib/kube/resources-listen';
import { initListExperimental } from '/@/lib/kube/tests-helpers/init-lists';
import * as states from '/@/stores/kubernetes-contexts-state';
import { isKubernetesExperimentalModeStore } from '/@/stores/kubernetes-experimental';

import KubeResourceList from './KubeResourceList.svelte';
import { buildCRD } from './tests-helpers/crd';

vi.mock(import('/@/lib/kube/resources-listen'));
vi.mock(import('/@/stores/kubernetes-contexts-state'));
vi.mock(import('/@/lib/dialogs/messagebox-utils'));

const statefulset: KubernetesObject = {
  apiVersion: 'apps/v1',
  kind: 'StatefulSet',
  metadata: { name: 'web', namespace: 'ns1', uid: 'uid1' },
  spec: { replicas: 3, serviceName: 'web-svc' },
  status: { readyReplicas: 2 },
} as KubernetesObject;

beforeEach(() => {
  vi.resetAllMocks();
  isKubernetesExperimentalModeStore.set(true);
  vi.mocked(states).kubernetesContextsCheckingStateDelayed = writable();
  vi.mocked(states).kubernetesCurrentContextState = writable();
  Object.defineProperty(window, 'kubernetesDeleteResource', { value: vi.fn(), writable: true });
  vi.mocked(withConfirmation).mockImplementation(callback => callback());
});

test('displays the resources with the columns of the type', async () => {
  initListExperimental({ resourceName: 'statefulsets' })([statefulset]);
  render(KubeResourceList, { resource: 'statefulsets' });

  await vi.waitFor(() => {
    expect(screen.getByRole('cell', { name: 'web ns1' })).toBeInTheDocument();
  });
  expect(screen.getByRole('heading', { name: 'StatefulSets' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Ready' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Service' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '2/3' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'web-svc' })).toBeInTheDocument();
});

test('clicking on the name opens the details', async () => {
  const gotoSpy = vi.spyOn(router, 'goto');
  initListExperimental({ resourceName: 'statefulsets' })([statefulset]);
  render(KubeResourceList, { resource: 'statefulsets' });

  const name = await vi.waitFor(() => screen.getByRole('button', { name: 'web ns1' }));
  await fireEvent.click(name);
  expect(gotoSpy).toHaveBeenCalledWith('/kubernetes/resources/statefulsets/web/ns1/summary');
});

test('delete a resource', async () => {
  initListExperimental({ resourceName: 'statefulsets' })([statefulset]);
  render(KubeResourceList, { resource: 'statefulsets' });

  const deleteButton = await vi.waitFor(() => screen.getByRole('button', { name: 'Delete StatefulSet' }));
  await fireEvent.click(deleteButton);
  expect(window.kubernetesDeleteResource).toHaveBeenCalledWith('apps/v1', 'StatefulSet', 'web', 'ns1');
});

test('displays the empty screen', async () => {
  initListExperimental({ resourceName: 'statefulsets' })([]);
  render(KubeResourceList, { resource: 'statefulsets' });

  await vi.waitFor(() => {
    expect(screen.getByRole('heading', { name: /StatefulSets not accessible|No StatefulSets/ })).toBeInTheDocument();
  });
});

test('displays a message when experimental mode is disabled', async () => {
  isKubernetesExperimentalModeStore.set(false);
  render(KubeResourceList, { resource: 'statefulsets' });

  expect(screen.getByText('Experimental Kubernetes mode required')).toBeInTheDocument();
});

test('displays custom resources with the printer columns of the CRD', async () => {
  const crd = buildCRD('cert-manager.io', 'Certificate', 'certificates', {
    columns: [{ name: 'Secret', type: 'string', jsonPath: '.spec.secretName' }],
  });
  const certificate = {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: { name: 'cert1', namespace: 'ns1' },
    spec: { secretName: 'cert1-tls' },
  } as KubernetesObject;
  const resources: Record<string, KubernetesObject[]> = {
    customresourcedefinitions: [crd],
    'certificates.cert-manager.io': [certificate],
  };
  vi.mocked(listenResources).mockImplementation(async (resourceName, _options, callback): Promise<IDisposable> => {
    setTimeout(() => callback(resources[resourceName] ?? []));
    return { dispose: vi.fn() };
  });
  render(KubeResourceList, { resource: 'certificates.cert-manager.io' });

  await vi.waitFor(() => {
    expect(screen.getByRole('cell', { name: 'cert1 ns1' })).toBeInTheDocument();
  });
  expect(screen.getByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Secret' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'cert1-tls' })).toBeInTheDocument();
});
