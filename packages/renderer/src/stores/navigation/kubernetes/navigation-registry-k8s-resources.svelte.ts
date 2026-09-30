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

import type { KubernetesResourceCategory, ResourceCount } from '@podman-desktop/core-api';

import KubeIcon from '/@/lib/images/KubeIcon.svelte';
import { getResourceListURL, type KubeResourceDescriptor } from '/@/lib/kube-resources/kube-resource-descriptor';
import { kubernetesContexts } from '/@/stores/kubernetes-contexts';
import { kubernetesNavigationResourceDescriptors } from '/@/stores/kubernetes-resource-descriptors';
import { kubernetesResourcesCount } from '/@/stores/kubernetes-resources-count';
import type { NavigationRegistryEntry } from '/@/stores/navigation/navigation-registry';

const CATEGORIES_ORDER: KubernetesResourceCategory[] = [
  'Workloads',
  'Network',
  'Storage',
  'Configuration',
  'Access Control',
  'Cluster',
  'Custom Resources',
];

let descriptors: readonly KubeResourceDescriptor[] = $state([]);
let resourcesCount: ResourceCount[] = $state([]);
let currentContextName: string | undefined = $state();

const counts = $derived(
  resourcesCount
    .filter(count => count.contextName === currentContextName)
    .reduce((acc, count) => acc.set(count.resourceName, count.count), new Map<string, number>()),
);

const entries: NavigationRegistryEntry[] = $derived(
  descriptors
    .toSorted((a, b) => CATEGORIES_ORDER.indexOf(a.info.category) - CATEGORIES_ORDER.indexOf(b.info.category))
    .map(descriptor => ({
      name: descriptor.label,
      icon: { iconComponent: KubeIcon },
      link: getResourceListURL(descriptor.info.resource),
      tooltip: descriptor.label,
      type: 'entry',
      destinations: [],
      get counter(): number {
        return counts.get(descriptor.info.resource) ?? 0;
      },
    })),
);

// createNavigationKubernetesResourcesEntries returns the navigation entries for the resource types
// displayed with the generic resource pages
export function createNavigationKubernetesResourcesEntries(): { readonly entries: NavigationRegistryEntry[] } {
  kubernetesNavigationResourceDescriptors.subscribe(value => {
    descriptors = value;
  });
  kubernetesResourcesCount.subscribe(value => {
    resourcesCount = value;
  });
  kubernetesContexts.subscribe(value => {
    currentContextName = value.find(context => context.currentContext)?.name;
  });
  return {
    get entries(): NavigationRegistryEntry[] {
      return entries;
    },
  };
}
