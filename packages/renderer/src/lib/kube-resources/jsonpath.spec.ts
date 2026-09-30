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

import { expect, test } from 'vitest';

import { evaluateJsonPath } from './jsonpath';

const object = {
  metadata: {
    name: 'cert1',
    labels: { 'app.kubernetes.io/name': 'my-app' },
  },
  spec: {
    replicas: 3,
    dnsNames: ['a.example.com', 'b.example.com'],
    ports: [{ port: 80 }, { port: 443 }],
  },
  status: {
    ready: true,
    conditions: [
      { type: 'Ready', status: 'True', reason: 'Ok' },
      { type: 'Issuing', status: 'False' },
    ],
  },
};

test.each<[string, unknown[]]>([
  ['.spec.replicas', [3]],
  ['{.spec.replicas}', [3]],
  ['$.spec.replicas', [3]],
  ['.status.ready', [true]],
  ['.spec.dnsNames', [['a.example.com', 'b.example.com']]],
  ['.spec.dnsNames[0]', ['a.example.com']],
  ['.spec.dnsNames[-1]', ['b.example.com']],
  ['.spec.dnsNames[*]', ['a.example.com', 'b.example.com']],
  ['.spec.ports[*].port', [80, 443]],
  ['.status.conditions[?(@.type=="Ready")].status', ['True']],
  [`.status.conditions[?(@.type == 'Issuing')].status`, ['False']],
  ['.status.conditions[?(@.type!="Ready")].type', ['Issuing']],
  ['.status.conditions[?(@.reason)].type', ['Ready']],
  [`.metadata.labels['app.kubernetes.io/name']`, ['my-app']],
  ['.metadata.labels["app.kubernetes.io/name"]', ['my-app']],
  ['.spec.unknown', []],
  ['.spec.unknown.deeper', []],
  ['.spec.replicas.deeper', []],
  ['.spec.dnsNames[5]', []],
  ['.spec[unbalanced', []],
])('%s', (path, expected) => {
  expect(evaluateJsonPath(object, path)).toEqual(expected);
});
