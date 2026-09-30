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

import { getCustomResourceDescriptor, getCustomResourceDescriptors } from './custom-resource-descriptor';
import { buildCRD } from './tests-helpers/crd';

beforeEach(() => {
  vi.useRealTimers();
});

test('descriptor of a CRD without printer columns', () => {
  const descriptor = getCustomResourceDescriptor(buildCRD('cert-manager.io', 'Certificate', 'certificates'));
  expect(descriptor?.info).toEqual({
    resource: 'certificates.cert-manager.io',
    group: 'cert-manager.io',
    version: 'v1',
    kind: 'Certificate',
    plural: 'certificates',
    namespaced: true,
    category: 'Custom Resources',
  });
  expect(descriptor?.label).toEqual('Certificates');
  expect(descriptor?.singular).toEqual('Certificate');
  expect(descriptor?.columns).toEqual([]);
  expect(
    descriptor?.getStatus({ status: { conditions: [{ type: 'Ready', status: 'True' }] } } as KubernetesObject),
  ).toEqual('RUNNING');
});

test('no descriptor for a CRD not established', () => {
  expect(
    getCustomResourceDescriptor(buildCRD('cert-manager.io', 'Certificate', 'certificates', { established: false })),
  ).toBeUndefined();
});

test('printer columns of a CRD', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-10T00:00:00Z'));
  const descriptor = getCustomResourceDescriptor(
    buildCRD('cert-manager.io', 'Certificate', 'certificates', {
      columns: [
        { name: 'Ready', type: 'string', jsonPath: '.status.conditions[?(@.type=="Ready")].status' },
        { name: 'Secret', type: 'string', jsonPath: '.spec.secretName' },
        { name: 'Issuer', type: 'string', jsonPath: '.spec.issuerRef.name', priority: 1 },
        { name: 'Expires', type: 'date', jsonPath: '.status.notAfter' },
        { name: 'Age', type: 'date', jsonPath: '.metadata.creationTimestamp' },
      ],
    }),
  );
  expect(descriptor?.columns.map(column => column.title)).toEqual(['Ready', 'Secret', 'Expires']);
  const certificate = {
    spec: { secretName: 'my-secret' },
    status: { conditions: [{ type: 'Ready', status: 'True' }], notAfter: '2026-01-07T00:00:00Z' },
  } as KubernetesObject;
  expect(descriptor?.columns.map(column => column.value(certificate))).toEqual(['True', 'my-secret', '3 days']);
  expect(descriptor?.columns.map(column => column.value({} as KubernetesObject))).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
});

test('descriptors are sorted by label, and duplicated labels include the group', () => {
  const descriptors = getCustomResourceDescriptors([
    buildCRD('cert-manager.io', 'Certificate', 'certificates'),
    buildCRD('example.com', 'Certificate', 'certificates'),
    buildCRD('example.com', 'Alpha', 'alphas'),
    // conflicts with the built-in Namespaces
    buildCRD('example.com', 'Namespace', 'namespaces'),
    buildCRD('example.com', 'Invalid', 'invalids', { established: false }),
  ]);
  expect(descriptors.map(descriptor => descriptor.label)).toEqual([
    'Alphas',
    'Certificates (cert-manager.io)',
    'Certificates (example.com)',
    'Namespaces (example.com)',
  ]);
});
