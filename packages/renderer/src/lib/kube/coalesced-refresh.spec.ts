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

import { expect, test, vi } from 'vitest';

import { createCoalescedRefresh } from './coalesced-refresh';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve: (value: T) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('refreshes requested during a fetch are grouped in a single fetch', async () => {
  const fetches = [deferred<number>(), deferred<number>()];
  let call = 0;
  const fetch = vi.fn(() => fetches[call++]!.promise);
  const onResult = vi.fn();
  const refresher = createCoalescedRefresh(fetch, onResult, vi.fn());

  refresher.refresh();
  refresher.refresh();
  refresher.refresh();
  refresher.refresh();
  expect(fetch).toHaveBeenCalledTimes(1);

  fetches[0]!.resolve(1);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(onResult).toHaveBeenCalledWith(1);

  fetches[1]!.resolve(2);
  await vi.waitFor(() => expect(onResult).toHaveBeenLastCalledWith(2));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(onResult).toHaveBeenCalledTimes(2);
});

test('a refresh after the end of a fetch starts a new fetch', async () => {
  const fetch = vi.fn().mockResolvedValue('value');
  const onResult = vi.fn();
  const refresher = createCoalescedRefresh(fetch, onResult, vi.fn());

  refresher.refresh();
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
  refresher.refresh();
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('errors are reported and do not block the next refreshes', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('an error')).mockResolvedValue('value');
  const onResult = vi.fn();
  const onError = vi.fn();
  const refresher = createCoalescedRefresh(fetch, onResult, onError);

  refresher.refresh();
  refresher.refresh();
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith('value'));
  expect(onError).toHaveBeenCalledWith(new Error('an error'));
});

test('no result is sent and no fetch is done after dispose', async () => {
  const first = deferred<string>();
  const fetch = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('second');
  const onResult = vi.fn();
  const refresher = createCoalescedRefresh(fetch, onResult, vi.fn());

  refresher.refresh();
  refresher.refresh();
  refresher.dispose();
  first.resolve('first');
  await new Promise(resolve => setTimeout(resolve, 10));
  refresher.refresh();
  expect(onResult).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});
