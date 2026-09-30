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
import { expect, test } from 'vitest';

import { BUILTIN_RESOURCE_DESCRIPTORS } from './kube-resource-descriptor';
import KubeResourceDetailsSummary from './KubeResourceDetailsSummary.svelte';

const statefulsets = BUILTIN_RESOURCE_DESCRIPTORS.find(d => d.info.resource === 'statefulsets')!;
const persistentvolumes = BUILTIN_RESOURCE_DESCRIPTORS.find(d => d.info.resource === 'persistentvolumes')!;

const statefulset: KubernetesObject = {
  apiVersion: 'apps/v1',
  kind: 'StatefulSet',
  metadata: { name: 'web', namespace: 'ns1', uid: 'uid1' },
  spec: { replicas: 3 },
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

test('displays metadata, details, conditions and events', () => {
  render(KubeResourceDetailsSummary, { props: { descriptor: statefulsets, object: statefulset, events: [event] } });

  expect(screen.getByText('Metadata')).toBeInTheDocument();
  expect(screen.getByText('Details')).toBeInTheDocument();
  expect(screen.getByText('Ready')).toBeInTheDocument();
  expect(screen.getByText('2/3')).toBeInTheDocument();
  // the Service column has no value, it is not displayed
  expect(screen.queryByText('Service')).not.toBeInTheDocument();
  expect(screen.getByText('Conditions')).toBeInTheDocument();
  expect(screen.getByText('some message')).toBeInTheDocument();
  expect(screen.getByText('Events')).toBeInTheDocument();
  expect(screen.getByText('create Pod web-0')).toBeInTheDocument();
});

test('does not display events and conditions for a non-namespaced resource without conditions', () => {
  const pv = {
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    metadata: { name: 'pv1' },
    spec: { capacity: { storage: '1Gi' } },
  } as KubernetesObject;
  render(KubeResourceDetailsSummary, { props: { descriptor: persistentvolumes, object: pv, events: [] } });

  expect(screen.getByText('1Gi')).toBeInTheDocument();
  expect(screen.queryByText('Conditions')).not.toBeInTheDocument();
  expect(screen.queryByText('Events')).not.toBeInTheDocument();
});

test('displays loading when the object is not available', () => {
  render(KubeResourceDetailsSummary, { props: { descriptor: persistentvolumes, object: undefined, events: [] } });

  expect(screen.getByText('Loading...')).toBeInTheDocument();
});
