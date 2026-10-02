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

import { checkFileName, normalizeRelativePath, parseStatOutput, toContainerPath } from './pvc-paths.js';

test.each([
  ['', ''],
  ['/', ''],
  ['a/b/', 'a/b'],
  ['/a//b', 'a/b'],
  ['a/../b', 'b'],
  ['../../etc/passwd', 'etc/passwd'],
  ['a/../../..', ''],
  ['./a/.', 'a'],
])('normalizeRelativePath(%j) is %j', (path, expected) => {
  expect(normalizeRelativePath(path)).toBe(expected);
});

test('normalizeRelativePath rejects NUL characters', () => {
  expect(() => normalizeRelativePath('a\0b')).toThrow('invalid path');
});

test('toContainerPath confines the paths to the root', () => {
  expect(toContainerPath('/data', '')).toBe('/data');
  expect(toContainerPath('/data/', '')).toBe('/data/');
  expect(toContainerPath('/data', 'dir/file')).toBe('/data/dir/file');
  expect(toContainerPath('/data', '../../etc')).toBe('/data/etc');
  expect(toContainerPath('/data', '-rf')).toBe('/data/-rf');
});

test('checkFileName', () => {
  expect(() => checkFileName('file.txt')).not.toThrow();
  expect(() => checkFileName('.hidden')).not.toThrow();
  for (const name of ['', '.', '..', 'a/b', 'a\0']) {
    expect(() => checkFileName(name)).toThrow('invalid name');
  }
});

test('parseStatOutput parses GNU and busybox outputs', () => {
  const output = [
    'regular file|12|1700000000|-rw-r--r--|/data/dir/file.txt',
    'regular empty file|0|1700000001|-rw-------|/data/dir/empty',
    'directory|4096|1700000002|drwxr-xr-x|/data/dir/sub dir',
    'symbolic link|7|1700000003|lrwxrwxrwx|/data/dir/link',
    'fifo|0|1700000004|prw-r--r--|/data/dir/pipe',
    'regular file|1|1700000005|-rw-r--r--|/data/dir/a|b',
    '',
  ].join('\n');
  expect(parseStatOutput(output, 'dir/')).toEqual([
    {
      name: 'file.txt',
      path: 'dir/file.txt',
      type: 'file',
      size: 12,
      modified: 1700000000000,
      permissions: '-rw-r--r--',
    },
    { name: 'empty', path: 'dir/empty', type: 'file', size: 0, modified: 1700000001000, permissions: '-rw-------' },
    {
      name: 'sub dir',
      path: 'dir/sub dir',
      type: 'directory',
      size: 4096,
      modified: 1700000002000,
      permissions: 'drwxr-xr-x',
    },
    { name: 'link', path: 'dir/link', type: 'symlink', size: 7, modified: 1700000003000, permissions: 'lrwxrwxrwx' },
    { name: 'pipe', path: 'dir/pipe', type: 'other', size: 0, modified: 1700000004000, permissions: 'prw-r--r--' },
    { name: 'a|b', path: 'dir/a|b', type: 'file', size: 1, modified: 1700000005000, permissions: '-rw-r--r--' },
  ]);
});

test('parseStatOutput at the root', () => {
  expect(parseStatOutput('directory|4096|1|drwxr-xr-x|/pvc/lost+found\n', '')).toEqual([
    expect.objectContaining({ name: 'lost+found', path: 'lost+found' }),
  ]);
});
