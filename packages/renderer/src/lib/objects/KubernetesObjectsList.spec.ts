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

import '@testing-library/jest-dom/vitest';

import type { KubernetesObject } from '@kubernetes/client-node';
import type { IDisposable } from '@podman-desktop/core-api';
import { TableColumn, TableRow, TableSimpleColumn } from '@podman-desktop/ui-svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { readable, writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import KubeIcon from '/@/lib/images/KubeIcon.svelte';
import { listenResources } from '/@/lib/kube/resources-listen';
import * as states from '/@/stores/kubernetes-contexts-state';

import KubernetesObjectsList from './KubernetesObjectsList.svelte';
import type { KubernetesNamespacedObjectUI } from './KubernetesObjectUI';

vi.mock(import('/@/lib/kube/resources-listen'));
vi.mock(import('/@/stores/kubernetes-contexts-state'));

let sendResources: (resources: KubernetesObject[]) => void;
const transformer = vi.fn(
  (object: KubernetesObject): KubernetesNamespacedObjectUI => ({
    kind: 'Thing',
    name: object.metadata?.name ?? '',
    namespace: 'ns1',
    status: '',
    selected: false,
  }),
);

function thing(name: string, resourceVersion: string): KubernetesObject {
  return { kind: 'Thing', metadata: { name, uid: `uid-${name}`, resourceVersion } };
}

beforeEach(() => {
  vi.resetAllMocks();
  transformer.mockImplementation(object => ({
    kind: 'Thing',
    name: object.metadata?.name ?? '',
    namespace: 'ns1',
    status: '',
    selected: false,
  }));
  vi.mocked(states).kubernetesContextsCheckingStateDelayed = writable();
  vi.mocked(states).kubernetesCurrentContextState = writable();
  vi.mocked(listenResources).mockImplementation(async (_resourceName, _options, callback): Promise<IDisposable> => {
    sendResources = callback;
    return { dispose: vi.fn() };
  });
});

async function renderList(): Promise<void> {
  render(KubernetesObjectsList, {
    kinds: [
      {
        resource: 'things',
        transformer,
        delete: vi.fn(),
        isResource: (): boolean => true,
        legacySearchPatternStore: writable(''),
        legacyObjectStore: readable<KubernetesObject[]>(),
      },
    ],
    singular: 'Thing',
    plural: 'Things',
    icon: KubeIcon,
    searchTerm: '',
    columns: [
      new TableColumn<KubernetesNamespacedObjectUI, string>('Name', {
        renderMapping: (object): string => object.name,
        renderer: TableSimpleColumn,
      }),
    ],
    row: new TableRow<KubernetesNamespacedObjectUI>({ selectable: (): boolean => true }),
    emptySnippet: createRawSnippet(() => ({ render: (): string => '<p>empty</p>' })),
  });
  await vi.waitFor(() => expect(listenResources).toHaveBeenCalled());
}

test('unchanged resources are not transformed again', async () => {
  await renderList();
  sendResources([thing('a', '1'), thing('b', '1')]);
  await vi.waitFor(() => expect(screen.getByRole('cell', { name: 'b' })).toBeInTheDocument());
  expect(transformer).toHaveBeenCalledTimes(2);

  // only b changes
  sendResources([thing('a', '1'), thing('b', '2'), thing('c', '1')]);
  await vi.waitFor(() => expect(screen.getByRole('cell', { name: 'c' })).toBeInTheDocument());
  expect(transformer).toHaveBeenCalledTimes(4);
  expect(transformer).toHaveBeenNthCalledWith(3, thing('b', '2'));
  expect(transformer).toHaveBeenNthCalledWith(4, thing('c', '1'));
});

test('the selection is kept when resources are updated', async () => {
  await renderList();
  sendResources([thing('a', '1'), thing('b', '1')]);
  await vi.waitFor(() => expect(screen.getByRole('cell', { name: 'b' })).toBeInTheDocument());

  const checkboxes = screen.getAllByRole('checkbox', { name: 'Toggle Thing' });
  await fireEvent.click(checkboxes[0]!);
  await fireEvent.click(checkboxes[1]!);
  await vi.waitFor(() => expect(screen.getByText('On 2 selected items.')).toBeInTheDocument());

  // a is not changed, b is changed
  sendResources([thing('a', '1'), thing('b', '2')]);
  await tick();
  expect(transformer).toHaveBeenCalledTimes(3);
  expect(screen.getByText('On 2 selected items.')).toBeInTheDocument();
});

test('resources being deleted are transformed again on update', async () => {
  await renderList();
  sendResources([thing('a', '1')]);
  await vi.waitFor(() => expect(screen.getByRole('cell', { name: 'a' })).toBeInTheDocument());
  const ui = transformer.mock.results[0]!.value as KubernetesNamespacedObjectUI;
  ui.status = 'DELETING';

  sendResources([thing('a', '1')]);
  await tick();
  expect(transformer).toHaveBeenCalledTimes(2);
});
