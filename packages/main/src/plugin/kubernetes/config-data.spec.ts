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

import { checkResourceVersion, decodeUtf8, setConfigMapKey, setSecretKey } from './config-data.js';

const b64 = (value: string | Uint8Array): string => Buffer.from(value).toString('base64');

test('decodeUtf8', () => {
  expect(decodeUtf8(Buffer.from('héllo'))).toBe('héllo');
  expect(decodeUtf8(new Uint8Array([0xff, 0xfe]))).toBeUndefined();
});

test('setConfigMapKey stores text in data and binary content in binaryData', () => {
  const configMap = { metadata: { name: 'cm' }, data: { a: 'x', b: 'y' }, binaryData: { c: b64('z') } };

  const text = setConfigMapKey(configMap, 'c', b64('text'));
  expect(text.data).toEqual({ a: 'x', b: 'y', c: 'text' });
  expect(text.binaryData).toBeUndefined();

  const binary = setConfigMapKey(configMap, 'a', b64(new Uint8Array([0, 0xff])));
  expect(binary.data).toEqual({ b: 'y' });
  expect(binary.binaryData).toEqual({ a: 'AP8=', c: b64('z') });
  // not modified
  expect(configMap.data).toEqual({ a: 'x', b: 'y' });
});

test('setSecretKey', () => {
  const secret = { metadata: { name: 's' }, data: { a: b64('x') }, stringData: { a: 'old' } };
  expect(setSecretKey(secret, 'a', b64('new'))).toEqual({ metadata: { name: 's' }, data: { a: b64('new') } });
  expect(setSecretKey(secret, 'b', b64('v')).data).toEqual({ a: b64('x'), b: b64('v') });
});

test('checkResourceVersion', () => {
  const resource = { metadata: { name: 'cm', resourceVersion: '2' } };
  expect(() => checkResourceVersion(resource, 'ConfigMap', '2')).not.toThrow();
  expect(() => checkResourceVersion(resource, 'ConfigMap')).not.toThrow();
  expect(() => checkResourceVersion(resource, 'ConfigMap', '1')).toThrow('has been modified since it was opened');
  expect(() => checkResourceVersion({ ...resource, immutable: true }, 'Secret', '2')).toThrow(
    'the Secret cm is immutable',
  );
});
