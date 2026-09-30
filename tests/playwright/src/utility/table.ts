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

import type { Locator } from '@playwright/test';

// Helpers for the tables of the application (the `Table` component of @podman-desktop/ui-svelte).
//
// Large tables are virtualized: only the rows visible in the scroll container of the table (and a few more)
// are in the DOM. The table indicates the total number of rows in `aria-rowcount` and the index of each row
// in `aria-rowindex` (the header row having the index 1). These helpers scroll the table to reach all the rows.

async function getAriaRowCount(table: Locator): Promise<number | undefined> {
  // do not wait for the table (getAttribute waits for the element): lists display an empty screen instead
  if ((await table.count()) === 0) {
    return undefined;
  }
  const value = await table.first().getAttribute('aria-rowcount');
  return value ? Number(value) : undefined;
}

// getTableRowCount returns the number of rows of the table (including the rows not rendered), without the header row
export async function getTableRowCount(table: Locator): Promise<number> {
  const ariaRowCount = await getAriaRowCount(table);
  const count = ariaRowCount ?? (await table.getByRole('row').count());
  return Math.max(count - 1, 0);
}

// isTableVirtualized returns true if some rows of the table are not in the DOM
export async function isTableVirtualized(table: Locator): Promise<boolean> {
  const ariaRowCount = await getAriaRowCount(table);
  if (ariaRowCount === undefined) {
    return false;
  }
  return (await table.getByRole('row').count()) < ariaRowCount;
}

async function waitForRender(table: Locator): Promise<void> {
  // the table updates the rendered rows on the next animation frame after a scroll
  await table
    .page()
    .evaluate(
      () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))),
    );
}

// scrollTable scrolls the scroll container of the table to the top, or to the next page of rows.
// Returns false if the container could not be scrolled further
async function scrollTable(table: Locator, to: 'top' | 'next'): Promise<boolean> {
  const scrolled = await table.evaluate((element, to) => {
    let container = element.parentElement;
    while (container) {
      const overflowY = getComputedStyle(container).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        break;
      }
      container = container.parentElement;
    }
    if (!container) {
      return false;
    }
    const before = container.scrollTop;
    container.scrollTop = to === 'top' ? 0 : before + Math.max(container.clientHeight * 0.8, 50);
    return to === 'top' || container.scrollTop > before;
  }, to);
  await waitForRender(table);
  return scrolled;
}

// forEachTableRow calls `visit` once for each row of the table (except the header row), scrolling the table
// if it is virtualized. The iteration stops when `visit` returns true
export async function forEachTableRow(table: Locator, visit: (row: Locator) => Promise<boolean | void>): Promise<void> {
  const virtualized = await isTableVirtualized(table);
  if (virtualized) {
    await scrollTable(table, 'top');
  }
  const visited = new Set<string>();
  let more = true;
  while (more) {
    const rows = await table.getByRole('row').all();
    for (let i = 0; i < rows.length; i++) {
      const rowIndex = (await rows[i].getAttribute('aria-rowindex')) ?? String(i + 1);
      // skip the header row, and the rows already visited
      if (rowIndex === '1' || visited.has(rowIndex)) {
        continue;
      }
      visited.add(rowIndex);
      if (await visit(rows[i])) {
        return;
      }
    }
    more = virtualized && (await scrollTable(table, 'next'));
  }
}

// findTableRow returns `row` (a locator of a row of the table) once it is rendered, scrolling the table
// if it is virtualized, or undefined if the table does not contain the row
export async function findTableRow(table: Locator, row: Locator): Promise<Locator | undefined> {
  if ((await row.count()) > 0) {
    return row;
  }
  if (!(await isTableVirtualized(table))) {
    return undefined;
  }
  await scrollTable(table, 'top');
  do {
    if ((await row.count()) > 0) {
      return row;
    }
  } while (await scrollTable(table, 'next'));
  return undefined;
}
