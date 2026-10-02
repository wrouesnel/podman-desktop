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

// how the files of a PersistentVolumeClaim are accessed
export type PvcBrowserMode =
  // in a container of a running pod mounting the volume
  | 'pod'
  // in a temporary helper pod created to mount the volume
  | 'helper';

export interface PvcBrowserSessionInfo {
  sessionId: string;
  namespace: string;
  pvcName: string;
  mode: PvcBrowserMode;
  podName: string;
  containerName: string;
  // the path of the volume in the container
  root: string;
  // the volume is mounted read only: no modification is possible
  readOnly: boolean;
  // the image of the helper pod (mode 'helper')
  helperImage?: string;
}

export type PvcFileType = 'file' | 'directory' | 'symlink' | 'other';

export interface PvcFileEntry {
  name: string;
  // the path of the entry, relative to the root of the volume ('' for the root itself)
  path: string;
  type: PvcFileType;
  size: number;
  // modification time, in milliseconds since the epoch
  modified: number;
  // permissions, as displayed by ls (e.g. drwxr-xr-x)
  permissions: string;
}
