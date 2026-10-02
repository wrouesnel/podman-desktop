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

import {
  base64ToBytes,
  bytesToBase64,
  bytesToText,
  formatSize,
  getBase64Size,
  getConfigDataKeys,
  getLanguage,
  isBinary,
  textToBytes,
} from './config-data';

test('base64 round trip', () => {
  const bytes = new Uint8Array(70000).map((_, i) => i % 256);
  expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  expect(bytesToBase64(textToBytes('héllo'))).toBe(btoa(unescape(encodeURIComponent('héllo'))));
  expect(bytesToText(base64ToBytes(bytesToBase64(textToBytes('héllo'))))).toBe('héllo');
});

test.each([
  ['text', textToBytes('hello\nworld\t!\r\n'), false],
  ['UTF-8 text', textToBytes('héllo ✓'), false],
  ['empty', new Uint8Array(), false],
  ['ANSI colors', textToBytes('\u001b[31mred\u001b[0m'), false],
  ['NUL', new Uint8Array([0x61, 0, 0x62]), true],
  ['invalid UTF-8', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), true],
  ['control characters', new Uint8Array([1, 2, 3, 0x61, 0x62]), true],
])('isBinary %s', (_name, bytes, expected) => {
  expect(isBinary(bytes)).toBe(expected);
});

test('getConfigDataKeys', () => {
  expect(
    getConfigDataKeys('ConfigMap', { data: { b: 'text' }, binaryData: { a: 'AP8=' } }).map(key => [
      key.key,
      key.base64,
    ]),
  ).toEqual([
    ['a', 'AP8='],
    ['b', btoa('text')],
  ]);
  expect(getConfigDataKeys('Secret', { data: { token: 'dG9rZW4=' } })).toEqual([{ key: 'token', base64: 'dG9rZW4=' }]);
  expect(getConfigDataKeys('Secret', undefined)).toEqual([]);
});

test('getLanguage, formatSize and getBase64Size', () => {
  expect(getLanguage('config.JSON')).toBe('json');
  expect(getLanguage('values.yml')).toBe('yaml');
  expect(getLanguage('token')).toBe('plaintext');
  expect(formatSize(10)).toBe('10 B');
  expect(formatSize(2048)).toBe('2.0 KiB');
  expect(getBase64Size('AP8=')).toBe(2);
  expect(getBase64Size(btoa('abc'))).toBe(3);
  expect(getBase64Size('')).toBe(0);
});
