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
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import TestVirtualTable from './TestVirtualTable.svelte';

// jsdom has no layout: the scroll container is 580px high, and the rows (not measured) use the estimated height
const VIEWPORT_HEIGHT = 580;
let scrollTop = 0;

function items(count: number): { name: string; selected?: boolean }[] {
  return Array.from({ length: count }, (_, i) => ({ name: `item-${i}` }));
}

function renderedNames(): string[] {
  return screen
    .getAllByRole('row')
    .map(row => row.getAttribute('aria-label'))
    .filter(label => label?.startsWith('item-')) as string[];
}

beforeEach(() => {
  scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('aria-label') === 'scroller' ? VIEWPORT_HEIGHT : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    // the rows start 28px (the header) below the top of the scroll container, and move up when scrolling
    const top = this.getAttribute('role') === 'rowgroup' ? 28 - scrollTop : 0;
    return { top, bottom: top, left: 0, right: 0, height: 0, width: 0, x: 0, y: top, toJSON: (): object => ({}) };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function scrollTo(position: number): Promise<void> {
  scrollTop = position;
  await fireEvent.scroll(screen.getByLabelText('scroller'));
  await new Promise(resolve => requestAnimationFrame(resolve));
}

test('only the rows around the viewport are rendered for a large list', async () => {
  render(TestVirtualTable, { items: items(1000) });
  const names = renderedNames();
  // 580px viewport + 600px overscan, with an estimated height of 58px per row
  expect(names).toHaveLength(Math.ceil((VIEWPORT_HEIGHT + 600 - 28) / 58));
  expect(names[0]).toEqual('item-0');
});

test('the rows are rendered when scrolling', async () => {
  render(TestVirtualTable, { items: items(1000) });
  await scrollTo(58 * 500);
  const names = renderedNames();
  expect(names).toContain('item-500');
  expect(names).not.toContain('item-0');
  expect(names).not.toContain('item-999');
});

test('the space of the rows not rendered is kept', async () => {
  const { container } = render(TestVirtualTable, { items: items(1000) });
  await scrollTo(58 * 500);
  const spacers = container.querySelectorAll('[role="presentation"]');
  expect(spacers).toHaveLength(2);
  const names = renderedNames();
  const first = Number(names[0]!.replace('item-', ''));
  const last = Number(names.at(-1)!.replace('item-', ''));
  expect((spacers[0] as HTMLElement).style.height).toEqual(`${first * 58}px`);
  expect((spacers[1] as HTMLElement).style.height).toEqual(`${(999 - last) * 58}px`);
});

test('the rows have their index in the whole list', async () => {
  render(TestVirtualTable, { items: items(1000) });
  expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '1001');
  await scrollTo(58 * 500);
  expect(screen.getByRole('row', { name: 'item-500' })).toHaveAttribute('aria-rowindex', '502');
});

test('toggle all selects the rows not rendered', async () => {
  const data = items(1000);
  render(TestVirtualTable, { items: data });
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle all' }));
  expect(data.every(item => item.selected)).toBeTruthy();
  expect(screen.getByLabelText('selected count')).toHaveTextContent('1000');
});

test('small lists are not virtualized', async () => {
  render(TestVirtualTable, { items: items(100) });
  expect(renderedNames()).toHaveLength(100);
});

test('virtualization can be disabled', async () => {
  render(TestVirtualTable, { items: items(1000), virtualization: 'never' });
  expect(renderedNames()).toHaveLength(1000);
});

test('virtualization can be forced for small lists', async () => {
  render(TestVirtualTable, { items: items(50), virtualization: 'always' });
  expect(renderedNames().length).toBeLessThan(50);
});

test('all the rows are rendered when the scroll container has no height', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(0);
  render(TestVirtualTable, { items: items(200) });
  expect(renderedNames()).toHaveLength(200);
});

test('the row containing the focus stays rendered when scrolling', async () => {
  render(TestVirtualTable, { items: items(1000) });
  const checkbox = screen.getAllByRole('checkbox', { name: 'Toggle item' })[1]!;
  checkbox.focus();
  expect(document.activeElement).toBe(checkbox);

  await scrollTo(58 * 500);
  const names = renderedNames();
  expect(names).toContain('item-1');
  expect(names).toContain('item-500');
  // the rows between the focused row and the viewport are not rendered
  expect(names).not.toContain('item-100');
  expect(document.activeElement).toBe(checkbox);
});
