/**********************************************************************
 * Copyright (C) 2024-2025 Red Hat, Inc.
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

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import type { PodUI } from '/@/lib/kube/pods/PodUI';
import {
  forgetTerminalWorkspace,
  getTerminalWorkspaceKey,
  terminalWorkspaces,
} from '/@/stores/kubernetes-terminal-workspace-store';

import KubernetesTerminalWorkspace from './KubernetesTerminalWorkspace.svelte';
import { getPanelTitle, getRunningContainers, getSessionKey } from './terminal-workspace';

vi.mock(import('./KubernetesTerminal.svelte'), async () => {
  const stub = await import('./TestTerminalStub.svelte');
  return { default: stub.default } as never;
});

function pod(containers: { name: string; status: string }[]): PodUI {
  return {
    name: 'pod1',
    namespace: 'ns1',
    status: 'RUNNING',
    selected: false,
    containers: containers.map(c => ({ Id: c.name, Names: c.name, Status: c.status })),
  } as PodUI;
}

function tabTitles(): string[] {
  return Array.from(document.querySelectorAll('.dv-default-tab-content')).map(tab => tab.textContent ?? '');
}

beforeEach(() => {
  vi.resetAllMocks();
  terminalWorkspaces.set(new Map());
  vi.mocked(window.kubernetesExecClose).mockResolvedValue(undefined);
});

test('helpers', () => {
  expect(
    getRunningContainers([
      { Id: '1', Names: 'a', Status: 'running' },
      { Id: '2', Names: 'b', Status: 'waiting' },
    ]),
  ).toEqual(['a']);
  expect(getSessionKey('ns1', 'pod1', 'a', 2)).toBe('ns1/pod1/a/2');
  expect(getPanelTitle('a', 1)).toBe('a');
  expect(getPanelTitle('a', 2)).toBe('a #2');
});

test('opens one tab per running container', async () => {
  render(KubernetesTerminalWorkspace, {
    pod: pod([
      { name: 'app', status: 'running' },
      { name: 'sidecar', status: 'running' },
      { name: 'stopped', status: 'terminated' },
    ]),
  });
  await vi.waitFor(() => expect(tabTitles()).toEqual(['app', 'sidecar']));
});

test('opens a new shell in the selected container', async () => {
  render(KubernetesTerminalWorkspace, { pod: pod([{ name: 'app', status: 'running' }]) });
  await vi.waitFor(() => expect(tabTitles()).toEqual(['app']));

  await fireEvent.click(screen.getByRole('button', { name: 'Open shell' }));
  await vi.waitFor(() => expect(tabTitles()).toEqual(['app', 'app #2']));
  expect(screen.getByText('terminal ns1/pod1/app/2')).toBeInTheDocument();
});

test('closing a tab closes its session', async () => {
  render(KubernetesTerminalWorkspace, { pod: pod([{ name: 'app', status: 'running' }]) });
  await vi.waitFor(() => expect(tabTitles()).toEqual(['app']));

  const closeAction = document.querySelector('.dv-default-tab-action') as HTMLElement;
  await fireEvent.pointerDown(closeAction);
  await fireEvent.click(closeAction);
  await vi.waitFor(() => expect(window.kubernetesExecClose).toHaveBeenCalledWith('ns1/pod1/app/1'));
  expect(tabTitles()).toEqual([]);
  expect(screen.getByText('Open a shell in a container')).toBeInTheDocument();
});

test('the workspace is kept (sessions open) when leaving, and restored when coming back', async () => {
  const first = render(KubernetesTerminalWorkspace, { pod: pod([{ name: 'app', status: 'running' }]) });
  await vi.waitFor(() => expect(tabTitles()).toEqual(['app']));
  await fireEvent.click(screen.getByRole('button', { name: 'Open shell' }));
  await vi.waitFor(() => expect(tabTitles()).toEqual(['app', 'app #2']));

  first.unmount();
  expect(window.kubernetesExecClose).not.toHaveBeenCalled();
  const saved = get(terminalWorkspaces).get(getTerminalWorkspaceKey('ns1', 'pod1'));
  expect(saved?.sessionKeys).toEqual(['ns1/pod1/app/1', 'ns1/pod1/app/2']);
  expect(saved?.layout).toBeDefined();

  render(KubernetesTerminalWorkspace, { pod: pod([{ name: 'app', status: 'running' }]) });
  await vi.waitFor(() => expect(tabTitles()).toEqual(['app', 'app #2']));
  // the numbering continues
  await fireEvent.click(screen.getByRole('button', { name: 'Open shell' }));
  await vi.waitFor(() => expect(tabTitles()).toContain('app #3'));
});

test('no running container', async () => {
  render(KubernetesTerminalWorkspace, { pod: pod([{ name: 'app', status: 'waiting' }]) });
  expect(await screen.findByText('No container is running')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open shell' })).toBeDisabled();
});

test('forgetTerminalWorkspace closes the sessions of the pod', async () => {
  const first = render(KubernetesTerminalWorkspace, {
    pod: pod([
      { name: 'app', status: 'running' },
      { name: 'sidecar', status: 'running' },
    ]),
  });
  await vi.waitFor(() => expect(tabTitles()).toHaveLength(2));
  first.unmount();

  forgetTerminalWorkspace('ns1', 'pod1');
  expect(window.kubernetesExecClose).toHaveBeenCalledWith('ns1/pod1/app/1');
  expect(window.kubernetesExecClose).toHaveBeenCalledWith('ns1/pod1/sidecar/1');
  expect(get(terminalWorkspaces).size).toBe(0);
  // unknown workspace: nothing to do
  forgetTerminalWorkspace('ns1', 'other');
});
