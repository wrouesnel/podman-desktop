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

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, expect, test } from 'vitest';

import { renderCounter } from './test-render-counter';
import type { Item } from './TestTableRendering.svelte';
import TestTableRendering from './TestTableRendering.svelte';

function items(): Item[] {
  return [
    { name: 'a', value: 'value-a' },
    { name: 'b', value: 'value-b' },
    { name: 'locked', value: 'value-locked' },
  ];
}

function rowCheckboxes(): HTMLElement[] {
  return screen.getAllByRole('checkbox', { name: 'Toggle item' });
}

function selectedCount(): string | null {
  return screen.getByLabelText('selected count').textContent;
}

beforeEach(() => {
  renderCounter.count = 0;
});

test('selecting a row sets the selected property of the object and updates the selection count', async () => {
  const data = items();
  render(TestTableRendering, { items: data });
  expect(selectedCount()).toEqual('0');

  await fireEvent.click(rowCheckboxes()[0]!);
  expect(data[0]!.selected).toBeTruthy();
  expect(rowCheckboxes()[0]).toBeChecked();
  expect(selectedCount()).toEqual('1');

  await fireEvent.click(rowCheckboxes()[0]!);
  expect(data[0]!.selected).toBeFalsy();
  expect(rowCheckboxes()[0]).not.toBeChecked();
  expect(selectedCount()).toEqual('0');
});

test('toggle all selects all the selectable rows', async () => {
  const data = items();
  render(TestTableRendering, { items: data });
  const toggleAll = screen.getByRole('checkbox', { name: 'Toggle all' });

  await fireEvent.click(toggleAll);
  expect(data.map(item => !!item.selected)).toEqual([true, true, false]);
  expect(rowCheckboxes()[0]).toBeChecked();
  expect(rowCheckboxes()[1]).toBeChecked();
  expect(toggleAll).toBeChecked();
  expect(selectedCount()).toEqual('2');

  await fireEvent.click(toggleAll);
  expect(data.map(item => !!item.selected)).toEqual([false, false, false]);
  expect(selectedCount()).toEqual('0');
});

test('toggle all is checked when all the selectable rows are selected one by one', async () => {
  render(TestTableRendering, { items: items() });
  await fireEvent.click(rowCheckboxes()[0]!);
  expect(screen.getByRole('checkbox', { name: 'Toggle all' })).not.toBeChecked();
  await fireEvent.click(rowCheckboxes()[1]!);
  expect(screen.getByRole('checkbox', { name: 'Toggle all' })).toBeChecked();
});

test('selecting a row selects its children', async () => {
  const data: Item[] = [
    {
      name: 'parent',
      value: 'value-parent',
      children: [
        { name: 'child1', value: 'value-child1' },
        { name: 'child2', value: 'value-child2' },
      ],
    },
  ];
  render(TestTableRendering, { items: data });

  await fireEvent.click(rowCheckboxes()[0]!);
  expect(data[0]!.children!.map(child => !!child.selected)).toEqual([true, true]);
  expect(rowCheckboxes().every(checkbox => (checkbox as HTMLInputElement).checked)).toBeTruthy();
  expect(selectedCount()).toEqual('3');

  // unselect one child
  await fireEvent.click(rowCheckboxes()[2]!);
  expect(data[0]!.children![1]!.selected).toBeFalsy();
  expect(selectedCount()).toEqual('2');
});

test('collapsing a row hides its children', async () => {
  const data: Item[] = [
    { name: 'parent', value: 'value-parent', children: [{ name: 'child1', value: 'value-child1' }] },
  ];
  render(TestTableRendering, { items: data });
  expect(screen.getByText('value-child1')).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Collapse Row' }));
  expect(screen.queryByText('value-child1')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Expand Row' }));
  expect(screen.getByText('value-child1')).toBeInTheDocument();
});

test('the rows of unchanged objects are not rendered again when the data changes', async () => {
  const data = items();
  const component = render(TestTableRendering, { items: data });
  expect(renderCounter.count).toEqual(3);

  // one object is replaced, one is added
  renderCounter.count = 0;
  const updated = [data[0]!, { ...data[1]!, value: 'value-b2' }, data[2]!, { name: 'c', value: 'value-c' }];
  await component.rerender({ items: updated });
  await tick();
  expect(renderCounter.count).toEqual(2);
  expect(screen.getByText('value-b2')).toBeInTheDocument();
  expect(screen.getByText('value-c')).toBeInTheDocument();
  expect(screen.queryByText('value-b')).not.toBeInTheDocument();
});

test('the selection of unchanged objects is kept when the data changes', async () => {
  const data = items();
  const component = render(TestTableRendering, { items: data });
  await fireEvent.click(rowCheckboxes()[0]!);

  await component.rerender({ items: [...data, { name: 'c', value: 'value-c' }] });
  await tick();
  expect(rowCheckboxes()[0]).toBeChecked();
  expect(selectedCount()).toEqual('1');
});

test('the rows are sorted when the data changes', async () => {
  const component = render(TestTableRendering, { items: items() });
  await component.rerender({ items: [...items(), { name: 'aa', value: 'value-aa' }] });
  await tick();
  const values = screen.getAllByText(/^value-/).map(element => element.textContent);
  expect(values).toEqual(['value-a', 'value-aa', 'value-b', 'value-locked']);
});
