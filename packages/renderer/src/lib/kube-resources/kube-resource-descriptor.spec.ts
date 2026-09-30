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
import { GENERIC_KUBERNETES_RESOURCE_TYPES } from '@podman-desktop/core-api';
import { describe, expect, test } from 'vitest';

import {
  BUILTIN_RESOURCE_DESCRIPTORS,
  formatValue,
  getConditionsStatus,
  getResourceDetailsURL,
  getResourceListURL,
  getValue,
  type KubeResourceDescriptor,
  pluralize,
} from './kube-resource-descriptor';

function getDescriptor(resource: string): KubeResourceDescriptor {
  const descriptor = BUILTIN_RESOURCE_DESCRIPTORS.find(d => d.info.resource === resource);
  if (!descriptor) {
    throw new Error(`no descriptor for ${resource}`);
  }
  return descriptor;
}

function getColumnValues(resource: string, object: KubernetesObject): Record<string, string | undefined> {
  return Object.fromEntries(getDescriptor(resource).columns.map(column => [column.title, column.value(object)]));
}

test.each([
  ['StatefulSet', 'StatefulSets'],
  ['NetworkPolicy', 'NetworkPolicies'],
  ['IngressClass', 'IngressClasses'],
  ['Gateway', 'Gateways'],
  ['Mesh', 'Meshes'],
  ['Box', 'Boxes'],
])('pluralize %s', (word, expected) => {
  expect(pluralize(word)).toEqual(expected);
});

test('getValue', () => {
  const object = { spec: { replicas: 3, template: { name: 'foo' } } };
  expect(getValue(object, 'spec.replicas')).toEqual(3);
  expect(getValue(object, 'spec.template.name')).toEqual('foo');
  expect(getValue(object, 'spec.unknown.name')).toBeUndefined();
  expect(getValue(undefined, 'spec')).toBeUndefined();
});

test('formatValue', () => {
  expect(formatValue(undefined)).toBeUndefined();
  expect(formatValue(null)).toBeUndefined();
  expect(formatValue(3)).toEqual('3');
  expect(formatValue(false)).toEqual('false');
  expect(formatValue(['a', 'b'])).toEqual('a, b');
  expect(formatValue({ a: 1 })).toEqual('{"a":1}');
  expect(formatValue(new Date('2026-01-01T00:00:00Z'))).toEqual('2026-01-01T00:00:00.000Z');
});

test('URLs', () => {
  expect(getResourceListURL('statefulsets')).toEqual('/kubernetes/resources/statefulsets');
  expect(getResourceDetailsURL('statefulsets', 'web', 'ns1')).toEqual(
    '/kubernetes/resources/statefulsets/web/ns1/summary',
  );
  expect(getResourceDetailsURL('persistentvolumes', 'pv1')).toEqual(
    '/kubernetes/resources/persistentvolumes/pv1/_/summary',
  );
});

test('a descriptor exists for every generic resource type', () => {
  expect(BUILTIN_RESOURCE_DESCRIPTORS.map(d => d.info)).toEqual(GENERIC_KUBERNETES_RESOURCE_TYPES);
  expect(getDescriptor('networkpolicies').label).toEqual('NetworkPolicies');
  expect(getDescriptor('networkpolicies').singular).toEqual('NetworkPolicy');
});

describe('getConditionsStatus', () => {
  test.each<[string, unknown, string]>([
    ['no status', undefined, ''],
    ['Ready True', [{ type: 'Ready', status: 'True' }], 'RUNNING'],
    ['Ready False', [{ type: 'Ready', status: 'False' }], 'DEGRADED'],
    ['Available True', [{ type: 'Available', status: 'True' }], 'RUNNING'],
    [
      'Ready takes precedence',
      [
        { type: 'Available', status: 'True' },
        { type: 'Ready', status: 'False' },
      ],
      'DEGRADED',
    ],
    ['Unknown', [{ type: 'Ready', status: 'Unknown' }], ''],
  ])('%s', (_name, conditions, expected) => {
    expect(getConditionsStatus({ status: { conditions } } as KubernetesObject)).toEqual(expected);
  });
});

test('statefulsets columns and status', () => {
  const statefulset = {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    spec: { replicas: 3, serviceName: 'web' },
    status: { readyReplicas: 2 },
  } as KubernetesObject;
  expect(getColumnValues('statefulsets', statefulset)).toEqual({ Ready: '2/3', Service: 'web' });
  expect(getDescriptor('statefulsets').getStatus(statefulset)).toEqual('DEGRADED');
  expect(
    getDescriptor('statefulsets').getStatus({ ...statefulset, status: { readyReplicas: 3 } } as KubernetesObject),
  ).toEqual('RUNNING');
  expect(
    getDescriptor('statefulsets').getStatus({ ...statefulset, spec: { replicas: 0 } } as KubernetesObject),
  ).toEqual('');
});

test('persistentvolumes columns and status', () => {
  const pv = {
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    spec: {
      capacity: { storage: '1Gi' },
      accessModes: ['ReadWriteOnce'],
      persistentVolumeReclaimPolicy: 'Delete',
      claimRef: { namespace: 'ns1', name: 'claim1' },
      storageClassName: 'standard',
    },
    status: { phase: 'Bound' },
  } as KubernetesObject;
  expect(getColumnValues('persistentvolumes', pv)).toEqual({
    Capacity: '1Gi',
    'Access modes': 'ReadWriteOnce',
    'Reclaim policy': 'Delete',
    Status: 'Bound',
    Claim: 'ns1/claim1',
    'Storage class': 'standard',
  });
  expect(getDescriptor('persistentvolumes').getStatus(pv)).toEqual('RUNNING');
  expect(getDescriptor('persistentvolumes').getStatus({ status: { phase: 'Failed' } } as KubernetesObject)).toEqual(
    'DEGRADED',
  );
});

test('rolebindings columns', () => {
  const binding = {
    roleRef: { kind: 'ClusterRole', name: 'admin' },
    subjects: [{ name: 'user1' }, { name: 'sa1' }],
  } as KubernetesObject;
  expect(getColumnValues('rolebindings', binding)).toEqual({ Role: 'ClusterRole/admin', Subjects: 'user1, sa1' });
});

test('storageclasses default annotation', () => {
  const storageClass = {
    metadata: { annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
    provisioner: 'rancher.io/local-path',
  } as KubernetesObject;
  expect(getColumnValues('storageclasses', storageClass)).toEqual(
    expect.objectContaining({ Provisioner: 'rancher.io/local-path', Default: 'true' }),
  );
  expect(getColumnValues('storageclasses', {} as KubernetesObject)).toEqual(
    expect.objectContaining({ Default: 'false' }),
  );
});

test('resourcequotas columns', () => {
  const quota = {
    status: { hard: { pods: '10', 'requests.cpu': '4' }, used: { pods: '3' } },
  } as KubernetesObject;
  expect(getColumnValues('resourcequotas', quota)).toEqual({ 'Used / Hard': 'pods: 3/10, requests.cpu: 0/4' });
});

test('customresourcedefinitions columns and status', () => {
  const crd = {
    spec: {
      group: 'cert-manager.io',
      names: { kind: 'Certificate' },
      scope: 'Namespaced',
      versions: [{ name: 'v1' }, { name: 'v1beta1' }],
    },
    status: { conditions: [{ type: 'Established', status: 'True' }] },
  } as KubernetesObject;
  expect(getColumnValues('customresourcedefinitions', crd)).toEqual({
    Group: 'cert-manager.io',
    Kind: 'Certificate',
    Scope: 'Namespaced',
    Versions: 'v1, v1beta1',
  });
  expect(getDescriptor('customresourcedefinitions').getStatus(crd)).toEqual('RUNNING');
});
