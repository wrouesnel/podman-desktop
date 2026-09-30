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

import type { Attachment } from 'svelte/attachments';

// the rows rendered by a virtualized table, and the space taken by the rows not rendered
export interface VirtualWindow {
  // index of the first rendered row
  start: number;
  // index after the last rendered row
  end: number;
  // height of the rows before the first rendered row
  topPadding: number;
  // height of the rows after the last rendered row
  bottomPadding: number;
}

export interface VirtualWindowOptions {
  count: number;
  heightOf: (index: number) => number;
  // position of the top of the viewport, relative to the top of the first row (negative when the rows start
  // below the top of the viewport)
  viewportTop: number;
  viewportHeight: number;
  // height rendered before and after the viewport
  overscan: number;
}

// a spacer taking the place of rows not rendered
export class VirtualSpacer {
  constructor(
    readonly height: number,
    // identifies the spacer among the rendered entries
    readonly key: string,
  ) {}
}

// an entry to render: a row (by its index), or a spacer
export type VirtualEntry = { index: number } | VirtualSpacer;

// the position of the top of each row, and of the end of the last row
function computeTops(count: number, heightOf: (index: number) => number): number[] {
  const tops = new Array<number>(count + 1);
  tops[0] = 0;
  for (let i = 0; i < count; i++) {
    tops[i + 1] = tops[i]! + heightOf(i);
  }
  return tops;
}

// computeVirtualWindow returns the rows to render to fill the viewport (and the overscan around it)
export function computeVirtualWindow(options: VirtualWindowOptions): VirtualWindow {
  return computeWindow(options, computeTops(options.count, options.heightOf));
}

function computeWindow(options: VirtualWindowOptions, tops: number[]): VirtualWindow {
  const { count, viewportTop, viewportHeight, overscan } = options;
  const rangeTop = viewportTop - overscan;
  const rangeBottom = viewportTop + viewportHeight + overscan;

  let start = 0;
  while (start < count && tops[start + 1]! <= rangeTop) {
    start++;
  }
  let end = start;
  while (end < count && tops[end]! < rangeBottom) {
    end++;
  }

  return {
    start,
    end,
    topPadding: tops[start]!,
    bottomPadding: tops[count]! - tops[end]!,
  };
}

// computeVirtualEntries returns the rows to render to fill the viewport, and the `pinned` rows wherever they are,
// with spacers taking the place of the rows not rendered
export function computeVirtualEntries(options: VirtualWindowOptions & { pinned?: readonly number[] }): VirtualEntry[] {
  const tops = computeTops(options.count, options.heightOf);
  const { start, end } = computeWindow(options, tops);
  const pinned = (options.pinned ?? []).filter(index => index >= 0 && index < options.count);
  const indexes = [...Array.from({ length: end - start }, (_, i) => start + i), ...pinned].toSorted((a, b) => a - b);

  const entries: VirtualEntry[] = [];
  let next = 0;
  for (const index of indexes) {
    if (index < next) {
      // already rendered (pinned row in the window)
      continue;
    }
    if (index > next) {
      entries.push(new VirtualSpacer(tops[index]! - tops[next]!, `spacer-${next}`));
    }
    entries.push({ index });
    next = index + 1;
  }
  if (next < options.count) {
    entries.push(new VirtualSpacer(tops[options.count]! - tops[next]!, `spacer-${next}`));
  }
  return entries;
}

function isScrollable(element: Element): boolean {
  const overflowY = getComputedStyle(element).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

// the nearest ancestor of the element scrolling vertically
export function findScrollContainer(element: Element): Element | undefined {
  let current = element.parentElement;
  while (current) {
    if (isScrollable(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return undefined;
}

// the height of the viewport assumed before the scroll container is known
const INITIAL_VIEWPORT_HEIGHT = 1000;

// VirtualRows tracks the information needed to virtualize the rows of a table:
// the position of the rows in their scroll container, the measured height of each row,
// and the row containing the focus (which must not be removed, as it can contain an open modal or menu)
export class VirtualRows<T extends object> {
  #estimatedRowHeight: number;
  #overscan: number;
  #heights = new WeakMap<T, number>();
  #objectsByElement = new WeakMap<Element, T>();
  #heightsVersion = $state(0);
  #viewportTop = $state(0);
  // undefined until the scroll container is known
  #viewportHeight: number | undefined = $state();
  // raw state: the object is compared by identity with the rows
  #focused: T | undefined = $state.raw();
  #frame: number | undefined;

  constructor(options?: { estimatedRowHeight?: number; overscan?: number }) {
    this.#estimatedRowHeight = options?.estimatedRowHeight ?? 58;
    this.#overscan = options?.overscan ?? 600;
  }

  // the entries to render: the rows around the viewport and the row containing the focus.
  // All the rows are rendered when the scroll container is not found or has no height (not laid out)
  getEntries(items: readonly T[]): VirtualEntry[] {
    // eslint-disable-next-line sonarjs/void-use
    void this.#heightsVersion;
    if (this.#viewportHeight !== undefined && this.#viewportHeight <= 0) {
      return items.map((_, index) => ({ index }));
    }
    const focused = this.#focused;
    return computeVirtualEntries({
      count: items.length,
      heightOf: index => this.#heights.get(items[index]!) ?? this.#estimatedRowHeight,
      viewportTop: this.#viewportTop,
      viewportHeight: this.#viewportHeight ?? INITIAL_VIEWPORT_HEIGHT,
      overscan: this.#overscan,
      pinned: focused ? [items.indexOf(focused)] : [],
    });
  }

  // attachment for the element containing the rows: follows the scroll of its scroll container,
  // and the focus in the rows
  body: Attachment<HTMLElement> = body => {
    const container = findScrollContainer(body);
    if (!container) {
      // no scroll container: render all the rows
      this.#viewportHeight = 0;
      return;
    }
    const update = (): void => {
      this.#frame = undefined;
      this.#viewportTop = container.getBoundingClientRect().top - body.getBoundingClientRect().top;
      this.#viewportHeight = container.clientHeight;
    };
    const scheduleUpdate = (): void => {
      this.#frame ??= requestAnimationFrame(update);
    };
    const onFocusIn = (event: FocusEvent): void => {
      this.#focused = this.getObjectOf(event.target);
    };
    const onFocusOut = (event: FocusEvent): void => {
      const next = this.getObjectOf(event.relatedTarget);
      if (next !== this.#focused) {
        this.#focused = next;
      }
    };
    update();
    container.addEventListener('scroll', scheduleUpdate, { passive: true });
    body.addEventListener('focusin', onFocusIn);
    body.addEventListener('focusout', onFocusOut);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(container);
    return (): void => {
      container.removeEventListener('scroll', scheduleUpdate);
      body.removeEventListener('focusin', onFocusIn);
      body.removeEventListener('focusout', onFocusOut);
      resizeObserver?.disconnect();
      if (this.#frame !== undefined) {
        cancelAnimationFrame(this.#frame);
        this.#frame = undefined;
      }
    };
  };

  // attachment for the element of a row: measures its height (including its margins)
  row(object: T): Attachment<HTMLElement> {
    return element => {
      this.#objectsByElement.set(element, object);
      const measure = (): void => {
        const style = getComputedStyle(element);
        const height =
          element.getBoundingClientRect().height +
          (Number.parseFloat(style.marginTop) || 0) +
          (Number.parseFloat(style.marginBottom) || 0);
        if (height > 0 && this.#heights.get(object) !== height) {
          this.#heights.set(object, height);
          this.#heightsVersion++;
        }
      };
      measure();
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      const resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(element);
      return (): void => resizeObserver.disconnect();
    };
  }

  private getObjectOf(target: EventTarget | null): T | undefined {
    let element = target instanceof Element ? target : undefined;
    while (element) {
      const object = this.#objectsByElement.get(element);
      if (object) {
        return object;
      }
      element = element.parentElement ?? undefined;
    }
    return undefined;
  }
}
