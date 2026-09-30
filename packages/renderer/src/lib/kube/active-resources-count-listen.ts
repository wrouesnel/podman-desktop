/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import type { IDisposable, ResourceCount } from '@podman-desktop/core-api';

import { createCoalescedRefresh } from './coalesced-refresh';

// listenActiveResourcesCount listens the count of active resources
// (a single fetch is running at a time, the events received while fetching are grouped in a single fetch)
export async function listenActiveResourcesCount(
  callback: (activeResourcesCounts: ResourceCount[]) => void,
): Promise<IDisposable | undefined> {
  if (!(await isKubernetesExperimentalMode())) {
    return;
  }

  const refresher = createCoalescedRefresh(
    () => window.kubernetesGetActiveResourcesCount(),
    callback,
    () => {
      console.error(`error getting active resources counts`);
    },
  );

  const disposable = window.events.receive('kubernetes-active-resources-count', () => {
    refresher.refresh();
  });

  refresher.refresh();

  return {
    dispose: (): void => {
      refresher.dispose();
      disposable.dispose();
    },
  };
}

async function isKubernetesExperimentalMode(): Promise<boolean> {
  try {
    return await window.isExperimentalConfigurationEnabled('kubernetes.statesExperimental');
  } catch {
    return false;
  }
}
