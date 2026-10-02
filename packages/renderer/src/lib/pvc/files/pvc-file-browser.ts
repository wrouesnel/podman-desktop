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

import type { PvcBrowserSessionInfo, PvcFileEntry } from '@podman-desktop/core-api';

export interface PvcFileRow extends PvcFileEntry {
  selected?: boolean;
}

export const PVC_FILE_BROWSER_CONTEXT = 'pvc-file-browser';

// the actions of the browser, used by the cells of the table
export interface PvcFileBrowserContext {
  readonly readOnly: boolean;
  // the path of the entry being renamed
  readonly renaming: string | undefined;
  open(entry: PvcFileEntry): void;
  download(entries: PvcFileEntry[]): void;
  startRename(entry: PvcFileEntry): void;
  rename(entry: PvcFileEntry, newName: string): void;
  cancelRename(): void;
  delete(entries: PvcFileEntry[]): void;
}

export interface PathSegment {
  name: string;
  path: string;
}

// the segments of a path relative to the root of the volume, starting with the root
export function getPathSegments(dir: string): PathSegment[] {
  const segments: PathSegment[] = [{ name: '/', path: '' }];
  let path = '';
  for (const name of dir.split('/').filter(name => name)) {
    path = path ? `${path}/${name}` : name;
    segments.push({ name, path });
  }
  return segments;
}

export function getParentPath(dir: string): string {
  const index = dir.lastIndexOf('/');
  return index < 0 ? '' : dir.substring(0, index);
}

// the directories are listed first
export function compareByName(a: PvcFileEntry, b: PvcFileEntry): number {
  const aDir = a.type === 'directory' ? 0 : 1;
  const bDir = b.type === 'directory' ? 0 : 1;
  return aDir - bDir || a.name.localeCompare(b.name);
}

export function describeAccess(session: PvcBrowserSessionInfo): string {
  if (session.mode === 'pod') {
    return `Browsing through the pod ${session.podName} (container ${session.containerName}, mounted at ${session.root})`;
  }
  return `Browsing through the temporary pod ${session.podName} (${session.helperImage ?? 'helper'})`;
}

// the key identifying a set of paths dragged out
export function getDragKey(paths: string[]): string {
  return [...paths].sort((a, b) => a.localeCompare(b)).join('\0');
}
