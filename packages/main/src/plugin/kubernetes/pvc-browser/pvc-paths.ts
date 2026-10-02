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

import { posix } from 'node:path';

import type { PvcFileEntry, PvcFileType } from '@podman-desktop/core-api';

// the format of the stat command used to list a directory: the name is last, it can contain the separator
export const STAT_FORMAT = '%F|%s|%Y|%A|%n';

/**
 * Normalizes a path relative to the root of a volume: the result never escapes the root
 * ('' is the root itself, no leading or trailing slash)
 */
export function normalizeRelativePath(path: string): string {
  if (path.includes('\0')) {
    throw new Error('invalid path');
  }
  // resolved from '/': '..' can't go above the root
  return posix.normalize(posix.join('/', path)).replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Returns the path in the container of a path relative to the root of the volume
 */
export function toContainerPath(root: string, path: string): string {
  const relative = normalizeRelativePath(path);
  return relative ? posix.join(root, relative) : posix.normalize(root);
}

/**
 * Checks that a name is a single path component (new folder, rename target)
 */
export function checkFileName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new Error(`invalid name '${name}'`);
  }
}

export function toFileType(statType: string): PvcFileType {
  if (statType.startsWith('regular')) {
    return 'file';
  }
  if (statType === 'directory') {
    return 'directory';
  }
  if (statType === 'symbolic link') {
    return 'symlink';
  }
  return 'other';
}

/**
 * Parses the output of the stat command (STAT_FORMAT) listing the content of `dir` (relative to the root)
 * (GNU coreutils and busybox output the same format)
 */
export function parseStatOutput(output: string, dir: string): PvcFileEntry[] {
  const relativeDir = normalizeRelativePath(dir);
  const entries: PvcFileEntry[] = [];
  for (const line of output.split('\n')) {
    const [type, size, modified, permissions, ...nameFields] = line.split('|');
    if (type === undefined || size === undefined || modified === undefined || permissions === undefined) {
      continue;
    }
    const name = posix.basename(nameFields.join('|'));
    if (!name) {
      continue;
    }
    entries.push({
      name,
      path: relativeDir ? `${relativeDir}/${name}` : name,
      type: toFileType(type),
      size: Number.parseInt(size, 10) || 0,
      modified: (Number.parseInt(modified, 10) || 0) * 1000,
      permissions,
    });
  }
  return entries;
}
