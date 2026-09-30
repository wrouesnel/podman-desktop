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

import type { CoreV1Event, KubernetesObject } from '@kubernetes/client-node';
import { render, screen } from '@testing-library/svelte';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import { isKubernetesExperimentalMode, listenResources } from '/@/lib/kube/resources-listen';
import { initListExperimental } from '/@/lib/kube/tests-helpers/init-lists';
import { isKubernetesExperimentalModeStore } from '/@/stores/kubernetes-experimental';

import KubeResourceDetails from './KubeResourceDetails.svelte';

vi.mock(import('/@/lib/kube/resources-listen'), async importOriginal => {
  const original = await importOriginal();
  return {
    ...original,
    listenResources: vi.fn(),
    isKubernetesExperimentalMode: vi.fn(),
  };
});

const statefulset: KubernetesObject = {
  apiVersion: 'apps/v1',
  kind: 'StatefulSet',
  metadata: { name: 'web', namespace: 'ns1', uid: 'uid1' },
  spec: { replicas: 3, serviceName: 'web-svc' },
  status: {
    readyReplicas: 2,
    conditions: [{ type: 'Progressing', status: 'True', reason: 'SomeReason', message: 'some message' }],
  },
} as KubernetesObject;

const event = {
  kind: 'Event',
  type: 'Normal',
  reason: 'SuccessfulCreate',
  message: 'create Pod web-0',
  involvedObject: { uid: 'uid1' },
  metadata: {},
} as CoreV1Event;

beforeEach(() => {
  vi.resetAllMocks();
  router.goto('/kubernetes/resources/statefulsets/web/ns1/summary');
  isKubernetesExperimentalModeStore.set(true);
  vi.mocked(isKubernetesExperimentalMode).mockResolvedValue(true);
});

test('displays the resource', async () => {
  initListExperimental({ resourceName: 'statefulsets' })([statefulset], [event]);
  render(KubeResourceDetails, { resource: 'statefulsets', name: 'web', namespace: 'ns1' });

  await vi.waitFor(() => {
    expect(screen.getByText('web')).toBeInTheDocument();
  });
  expect(screen.getByText('ns1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete StatefulSet' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Kube' })).toBeInTheDocument();
});

test('displays a non-namespaced resource with the kind as subtitle', async () => {
  const pv = {
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    metadata: { name: 'pv1', uid: 'uid2' },
  } as KubernetesObject;
  initListExperimental({ resourceName: 'persistentvolumes' })([pv]);
  render(KubeResourceDetails, { resource: 'persistentvolumes', name: 'pv1', namespace: '_' });

  await vi.waitFor(() => {
    expect(screen.getByText('pv1')).toBeInTheDocument();
  });
  expect(screen.getByText('PersistentVolume')).toBeInTheDocument();
  expect(listenResources).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
});

test('displays a message when experimental mode is disabled', async () => {
  isKubernetesExperimentalModeStore.set(false);
  render(KubeResourceDetails, { resource: 'statefulsets', name: 'web', namespace: 'ns1' });

  expect(screen.getByText('Experimental Kubernetes mode required')).toBeInTheDocument();
});
