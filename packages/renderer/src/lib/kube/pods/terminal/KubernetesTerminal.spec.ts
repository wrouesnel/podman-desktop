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

import { render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import KubernetesTerminal from '/@/lib/kube/pods/terminal/KubernetesTerminal.svelte';
import { terminalStates } from '/@/stores/kubernetes-terminal-state-store';

type ExecArgs = [
  string,
  string | undefined,
  string,
  string,
  (data: Buffer) => void,
  (data: Buffer) => void,
  () => void,
];

let onStdOut: (data: Buffer) => void;
let onClose: () => void;
let resizeCallbacks: (() => void)[];
const originalResizeObserver = globalThis.ResizeObserver;

const props = { sessionKey: 'ns1/pod1/container1/1', namespace: 'ns1', podName: 'pod1', containerName: 'container1' };

beforeEach(() => {
  vi.resetAllMocks();
  terminalStates.set(new Map());
  vi.mocked(window.getConfigurationValue).mockImplementation(async (key: string) =>
    key === 'terminal.integrated.scrollback' ? 1000 : undefined,
  );
  let execCount = 0;
  vi.mocked(window.kubernetesExec).mockImplementation(async (...args: ExecArgs) => {
    onStdOut = args[4];
    onClose = args[6];
    execCount++;
    return execCount;
  });
  vi.mocked(window.kubernetesExecSend).mockResolvedValue(undefined);
  vi.mocked(window.kubernetesExecResize).mockResolvedValue(undefined);
  vi.mocked(window.kubernetesExecDetach).mockResolvedValue(undefined);
  // a ResizeObserver whose callbacks can be triggered by the tests
  resizeCallbacks = [];
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

test('opens the session in the namespace of the pod and displays its output', async () => {
  const renderObject = render(KubernetesTerminal, props);
  await waitFor(() => expect(window.kubernetesExec).toHaveBeenCalled());
  expect(window.kubernetesExec).toHaveBeenCalledWith(
    'ns1/pod1/container1/1',
    'ns1',
    'pod1',
    'container1',
    expect.any(Function),
    expect.any(Function),
    expect.any(Function),
  );

  onStdOut(Buffer.from('hello\nworld'));
  await waitFor(() => {
    const terminalLinesLiveRegion = renderObject.container.querySelector('div[aria-live="assertive"]');
    expect(terminalLinesLiveRegion).toHaveTextContent('hello world');
  });
});

test('the session is detached (not closed) and its output saved when the terminal is destroyed', async () => {
  const renderObject = render(KubernetesTerminal, props);
  await waitFor(() => expect(window.kubernetesExec).toHaveBeenCalled());
  expect(get(terminalStates).size).toBe(0);

  renderObject.unmount();
  expect(window.kubernetesExecDetach).toHaveBeenCalledWith(1);
  expect(window.kubernetesExecClose).not.toHaveBeenCalled();
  expect(get(terminalStates).get('ns1/pod1/container1/1')?.terminal).toBeDefined();

  // a new terminal for the same session reattaches to it
  render(KubernetesTerminal, props);
  await waitFor(() => expect(window.kubernetesExec).toHaveBeenCalledTimes(2));
  expect(vi.mocked(window.kubernetesExec).mock.calls[1]?.[0]).toBe('ns1/pod1/container1/1');
});

test('a new shell is started when the shell exits', async () => {
  render(KubernetesTerminal, props);
  await waitFor(() => expect(window.kubernetesExec).toHaveBeenCalledOnce());
  onClose();
  await waitFor(() => expect(window.kubernetesExec).toHaveBeenCalledTimes(2));
});

test('the session is resized when the terminal element is resized', async () => {
  const renderObject = render(KubernetesTerminal, props);
  await waitFor(() => expect(resizeCallbacks).toHaveLength(1));
  const element = renderObject.getByLabelText('Terminal of container1');
  Object.defineProperty(element, 'clientWidth', { value: 800 });
  Object.defineProperty(element, 'clientHeight', { value: 600 });
  vi.mocked(window.kubernetesExecResize).mockClear();

  resizeCallbacks[0]?.();
  await waitFor(() =>
    expect(window.kubernetesExecResize).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Number)),
  );
});
