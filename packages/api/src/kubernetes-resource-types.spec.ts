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

import type { V1CustomResourceDefinition } from '@kubernetes/client-node';
import { expect, test } from 'vitest';

import {
  getCustomResourceTypeInfo,
  getKubernetesResourceTypeApiVersion,
  getKubernetesResourceTypePath,
  type KubernetesResourceTypeInfo,
} from './kubernetes-resource-types.js';

function buildCRD(
  overrides?: Partial<V1CustomResourceDefinition['spec']>,
  established = true,
): V1CustomResourceDefinition {
  return {
    metadata: { name: 'certificates.cert-manager.io' },
    spec: {
      group: 'cert-manager.io',
      names: { kind: 'Certificate', plural: 'certificates' },
      scope: 'Namespaced',
      versions: [
        { name: 'v1alpha1', served: false, storage: false },
        { name: 'v1beta1', served: true, storage: false },
        { name: 'v1', served: true, storage: true },
      ],
      ...overrides,
    },
    status: {
      acceptedNames: { kind: 'Certificate', plural: 'certificates' },
      storedVersions: ['v1'],
      conditions: [{ type: 'Established', status: established ? 'True' : 'False' }],
    },
  };
}

test('getKubernetesResourceTypeApiVersion and path', () => {
  const core: KubernetesResourceTypeInfo = {
    resource: 'persistentvolumes',
    group: '',
    version: 'v1',
    kind: 'PersistentVolume',
    plural: 'persistentvolumes',
    namespaced: false,
    category: 'Storage',
  };
  expect(getKubernetesResourceTypeApiVersion(core)).toEqual('v1');
  expect(getKubernetesResourceTypePath(core, 'ns1')).toEqual('/api/v1/persistentvolumes');
  const grouped = { ...core, group: 'apps', kind: 'StatefulSet', plural: 'statefulsets', namespaced: true };
  expect(getKubernetesResourceTypeApiVersion(grouped)).toEqual('apps/v1');
  expect(getKubernetesResourceTypePath(grouped, 'ns1')).toEqual('/apis/apps/v1/namespaces/ns1/statefulsets');
});

test('getCustomResourceTypeInfo uses the served storage version', () => {
  expect(getCustomResourceTypeInfo(buildCRD())).toEqual({
    resource: 'certificates.cert-manager.io',
    group: 'cert-manager.io',
    version: 'v1',
    kind: 'Certificate',
    plural: 'certificates',
    namespaced: true,
    category: 'Custom Resources',
  });
});

test('getCustomResourceTypeInfo uses the first served version when the storage version is not served', () => {
  const crd = buildCRD({
    scope: 'Cluster',
    versions: [
      { name: 'v1beta1', served: true, storage: false },
      { name: 'v1', served: false, storage: true },
    ],
  });
  expect(getCustomResourceTypeInfo(crd)).toEqual(expect.objectContaining({ version: 'v1beta1', namespaced: false }));
});

test('getCustomResourceTypeInfo returns undefined when no version is served', () => {
  const crd = buildCRD({ versions: [{ name: 'v1', served: false, storage: true }] });
  expect(getCustomResourceTypeInfo(crd)).toBeUndefined();
});

test('getCustomResourceTypeInfo returns undefined when the CRD is not established', () => {
  expect(getCustomResourceTypeInfo(buildCRD({}, false))).toBeUndefined();
});

test('getCustomResourceTypeInfo returns undefined for custom resources with a dedicated page', () => {
  const crd = buildCRD();
  crd.metadata = { name: 'routes.route.openshift.io' };
  expect(getCustomResourceTypeInfo(crd)).toBeUndefined();
});
