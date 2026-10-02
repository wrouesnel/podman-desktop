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

import type { SerializedDockview } from 'dockview-core';
import { get, writable } from 'svelte/store';

import { terminalStates } from './kubernetes-terminal-state-store';

// The terminal workspace of a pod: the layout of its panes and the open sessions,
// kept when leaving the terminal tab so the shells and their layout are restored when coming back
export interface TerminalWorkspaceState {
  layout?: SerializedDockview;
  // keys of the open sessions
  sessionKeys: string[];
  // number of shells opened in each container, used to number the new ones
  shellCounters: Record<string, number>;
}

export const terminalWorkspaces = writable(new Map<string, TerminalWorkspaceState>());

export function getTerminalWorkspaceKey(namespace: string, podName: string): string {
  return `${namespace}/${podName}`;
}

// closes the sessions of the workspace of a pod and forgets it (e.g. the pod has been deleted)
export function forgetTerminalWorkspace(namespace: string, podName: string): void {
  const key = getTerminalWorkspaceKey(namespace, podName);
  const workspace = get(terminalWorkspaces).get(key);
  if (!workspace) {
    return;
  }
  for (const sessionKey of workspace.sessionKeys) {
    window.kubernetesExecClose(sessionKey).catch((err: unknown) => console.error(`Error closing ${sessionKey}`, err));
  }
  terminalStates.update(states => {
    workspace.sessionKeys.forEach(sessionKey => states.delete(sessionKey));
    return states;
  });
  terminalWorkspaces.update(workspaces => {
    workspaces.delete(key);
    return workspaces;
  });
}
