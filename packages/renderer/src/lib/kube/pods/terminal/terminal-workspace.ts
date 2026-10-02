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

import type { PodInfoContainerUI } from '/@/lib/pod/PodInfoUI';

// the parameters of a terminal panel of the workspace
export interface TerminalPanelParams {
  sessionKey: string;
  namespace: string;
  podName: string;
  containerName: string;
}

// the containers in which a shell can be opened
export function getRunningContainers(containers: PodInfoContainerUI[]): string[] {
  return containers.filter(container => container.Status === 'running').map(container => container.Names);
}

// the key of the n-th shell opened in a container of a pod
export function getSessionKey(namespace: string, podName: string, containerName: string, shellNumber: number): string {
  return `${namespace}/${podName}/${containerName}/${shellNumber}`;
}

// the title of the tab of the n-th shell opened in a container
export function getPanelTitle(containerName: string, shellNumber: number): string {
  return shellNumber === 1 ? containerName : `${containerName} #${shellNumber}`;
}
