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

import type { KubernetesObject } from '@kubernetes/client-node';
import type { IDisposable, KubernetesResourcesChanges, KubernetesResourcesVersion } from '@podman-desktop/core-api';
import { getKubernetesObjectKey } from '@podman-desktop/core-api';
import type { Unsubscriber, Writable } from 'svelte/store';

import { kubernetesContexts } from '/@/stores/kubernetes-contexts';
import { findMatchInLeaves } from '/@/stores/search-util';

import { createCoalescedRefresh } from './coalesced-refresh';

export interface ListenResourcesOptions {
  searchTermStore?: Writable<string>;
}

// listenResources returns undefined and does nothing when `kubernetes.statesExperimental` setting is not set to true
//
// In experimental mode:
// - watches kubernetes-update-${resourceName} events
// - watches changes of current context
// - watches changes of searchTerm
// and on each event, fetch resources from the backend (informers) filter them on searchTerm and send them through the callback.
//
// A single fetch is running at a time: the events received while fetching are grouped in a single fetch,
// and a change of searchTerm only filters again the last fetched resources.
// Only the changes since the previous fetch are received from the backend, and applied to the known resources.
export async function listenResources(
  resourceName: string,
  options: ListenResourcesOptions,
  callback: (resoures: KubernetesObject[]) => void,
): Promise<IDisposable | undefined> {
  if (!(await isKubernetesExperimentalMode())) {
    return;
  }
  let searchTerm: string = '';
  let contextName: string | undefined;
  let searchTermStoreUnsubscribe: Unsubscriber | undefined;
  // the resources known for the current context, by key, and their version
  let known:
    | { contextName: string; version: KubernetesResourcesVersion; objects: Map<string, KubernetesObject> }
    | undefined;
  // the last resources fetched, for the context they have been fetched for
  let lastResources: { contextName: string; items: KubernetesObject[] } | undefined;

  const sendFilteredResources = (): void => {
    // ignore resources fetched for a previous current context
    if (lastResources && lastResources.contextName === contextName) {
      callback(filter(lastResources.items, searchTerm));
    }
  };

  const applyChanges = (changes: KubernetesResourcesChanges): void => {
    // ignore changes fetched for a previous current context
    if (changes.contextName !== contextName) {
      return;
    }
    const objects = changes.full || !known ? new Map<string, KubernetesObject>() : known.objects;
    for (const key of changes.deleted) {
      objects.delete(key);
    }
    for (const item of changes.items) {
      objects.set(getKubernetesObjectKey(item), item);
    }
    known = {
      contextName: changes.contextName,
      version: { epoch: changes.epoch, generation: changes.generation },
      objects,
    };
    if (!changes.full && lastResources && !changes.items.length && !changes.deleted.length) {
      // nothing changed
      return;
    }
    lastResources = { contextName: changes.contextName, items: Array.from(objects.values()) };
    sendFilteredResources();
  };

  const refresher = createCoalescedRefresh(
    async (): Promise<KubernetesResourcesChanges | undefined> => {
      const fetchedContextName = contextName;
      if (!fetchedContextName) {
        return undefined;
      }
      const since = known?.contextName === fetchedContextName ? known.version : undefined;
      return window.kubernetesGetResourcesChanges(fetchedContextName, resourceName, since);
    },
    changes => {
      if (changes) {
        applyChanges(changes);
      }
    },
    () => {
      console.log(`error getting ${resourceName}`);
    },
  );

  const disposable = window.events.receive(`kubernetes-update-${resourceName}`, () => {
    if (!contextName) {
      return;
    }
    refresher.refresh();
  });

  const kubernetesContextsUnsubscribe = kubernetesContexts.subscribe(contexts => {
    const currentContext = contexts.find(c => c.currentContext)?.name;
    if (currentContext === contextName) {
      return;
    }
    contextName = currentContext;
    lastResources = undefined;
    known = undefined;
    if (!contextName) {
      callback([]);
      return;
    }
    refresher.refresh();
  });

  if (options.searchTermStore) {
    searchTermStoreUnsubscribe = options.searchTermStore.subscribe(newSearchTerm => {
      if (newSearchTerm === searchTerm) {
        return;
      }
      searchTerm = newSearchTerm;
      sendFilteredResources();
    });
  }

  return {
    dispose: (): void => {
      refresher.dispose();
      disposable.dispose();
      kubernetesContextsUnsubscribe();
      searchTermStoreUnsubscribe?.();
    },
  };
}

function filter(resources: KubernetesObject[], searchTerm: string): KubernetesObject[] {
  if (!searchTerm) {
    return resources;
  }
  return resources.filter(resource => findMatchInLeaves(resource, searchTerm.toLowerCase()));
}

export async function isKubernetesExperimentalMode(): Promise<boolean> {
  try {
    return await window.isExperimentalConfigurationEnabled('kubernetes.statesExperimental');
  } catch {
    return false;
  }
}
