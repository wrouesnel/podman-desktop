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

export interface CoalescedRefresh {
  // requests a refresh
  refresh: () => void;
  // no more refresh is done, and no more result is sent, after dispose
  dispose: () => void;
}

// createCoalescedRefresh ensures that at most one `fetch` is running at a time:
// the refreshes requested while a fetch is running are grouped in a single fetch, started when the running one ends.
// As a single fetch is running at a time, the results are sent to `onResult` in the order of the requests,
// and a result can never be replaced by an older one.
export function createCoalescedRefresh<T>(
  fetch: () => Promise<T>,
  onResult: (result: T) => void,
  onError: (err: unknown) => void,
): CoalescedRefresh {
  let running = false;
  let pending = false;
  let disposed = false;

  const run = (): void => {
    running = true;
    pending = false;
    fetch()
      .then(result => {
        if (!disposed) {
          onResult(result);
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          onError(err);
        }
      })
      .finally(() => {
        running = false;
        if (pending && !disposed) {
          run();
        }
      });
  };

  return {
    refresh: (): void => {
      if (disposed) {
        return;
      }
      if (running) {
        pending = true;
        return;
      }
      run();
    },
    dispose: (): void => {
      disposed = true;
    },
  };
}
