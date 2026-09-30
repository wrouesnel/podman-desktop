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

import { describe, expect, test } from 'vitest';

import { computeVirtualEntries, computeVirtualWindow, findScrollContainer, VirtualSpacer } from './virtual-rows.svelte';

describe('computeVirtualWindow', () => {
  const fixed = (height: number) => (): number => height;

  test('first rows at the top of the list', () => {
    expect(
      computeVirtualWindow({ count: 1000, heightOf: fixed(50), viewportTop: 0, viewportHeight: 500, overscan: 100 }),
    ).toEqual({ start: 0, end: 12, topPadding: 0, bottomPadding: 988 * 50 });
  });

  test('rows in the middle of the list, with the overscan before and after the viewport', () => {
    expect(
      computeVirtualWindow({
        count: 1000,
        heightOf: fixed(50),
        viewportTop: 10_000,
        viewportHeight: 500,
        overscan: 100,
      }),
    ).toEqual({ start: 198, end: 212, topPadding: 198 * 50, bottomPadding: (1000 - 212) * 50 });
  });

  test('rows starting below the top of the viewport', () => {
    expect(
      computeVirtualWindow({ count: 1000, heightOf: fixed(50), viewportTop: -200, viewportHeight: 500, overscan: 0 }),
    ).toEqual({ start: 0, end: 6, topPadding: 0, bottomPadding: 994 * 50 });
  });

  test('end of the list', () => {
    expect(
      computeVirtualWindow({ count: 100, heightOf: fixed(50), viewportTop: 4800, viewportHeight: 500, overscan: 0 }),
    ).toEqual({ start: 96, end: 100, topPadding: 96 * 50, bottomPadding: 0 });
  });

  test('rows of different heights', () => {
    const heights = [100, 20, 20, 300, 20, 20];
    expect(
      computeVirtualWindow({
        count: heights.length,
        heightOf: index => heights[index]!,
        viewportTop: 130,
        viewportHeight: 50,
        overscan: 0,
      }),
    ).toEqual({ start: 2, end: 4, topPadding: 120, bottomPadding: 40 });
  });

  test('no rows', () => {
    expect(
      computeVirtualWindow({ count: 0, heightOf: fixed(50), viewportTop: 0, viewportHeight: 500, overscan: 100 }),
    ).toEqual({ start: 0, end: 0, topPadding: 0, bottomPadding: 0 });
  });
});

describe('computeVirtualEntries', () => {
  test('rows of the window with spacers before and after', () => {
    expect(
      computeVirtualEntries({ count: 10, heightOf: () => 50, viewportTop: 200, viewportHeight: 100, overscan: 0 }),
    ).toEqual([new VirtualSpacer(200, 'spacer-0'), { index: 4 }, { index: 5 }, new VirtualSpacer(200, 'spacer-6')]);
  });

  test('all the rows fit in the viewport', () => {
    expect(
      computeVirtualEntries({ count: 3, heightOf: () => 50, viewportTop: 0, viewportHeight: 500, overscan: 0 }),
    ).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }]);
  });

  test('pinned rows outside of the window are rendered at their position, between spacers', () => {
    expect(
      computeVirtualEntries({
        count: 10,
        heightOf: () => 50,
        viewportTop: 200,
        viewportHeight: 100,
        overscan: 0,
        pinned: [1, 5, 42, -1],
      }),
    ).toEqual([
      new VirtualSpacer(50, 'spacer-0'),
      { index: 1 },
      new VirtualSpacer(100, 'spacer-2'),
      { index: 4 },
      { index: 5 },
      new VirtualSpacer(200, 'spacer-6'),
    ]);
  });
});

test('findScrollContainer returns the nearest scrollable ancestor', () => {
  const outer = document.createElement('div');
  outer.style.overflowY = 'auto';
  const middle = document.createElement('div');
  middle.style.overflowY = 'hidden';
  const inner = document.createElement('div');
  outer.appendChild(middle);
  middle.appendChild(inner);
  document.body.appendChild(outer);

  expect(findScrollContainer(inner)).toBe(outer);
  expect(findScrollContainer(outer)).toBeUndefined();
  outer.remove();
});
