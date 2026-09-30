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

import type { KubernetesObject } from '@kubernetes/client-node';
import type { IDisposable } from '@podman-desktop/core-api';
import { CUSTOM_RESOURCE_DEFINITIONS_RESOURCE } from '@podman-desktop/core-api';
import { derived, type Readable } from 'svelte/store';

import { listenResources } from '/@/lib/kube/resources-listen';
import { getCustomResourceDescriptors } from '/@/lib/kube-resources/custom-resource-descriptor';
import {
  BUILTIN_RESOURCE_DESCRIPTORS,
  type KubeResourceDescriptor,
} from '/@/lib/kube-resources/kube-resource-descriptor';

import { kubernetesContexts } from './kubernetes-contexts';
import { isKubernetesExperimentalModeStore } from './kubernetes-experimental';
import { kubernetesResourcesCount } from './kubernetes-resources-count';

// the CRDs of the current context (experimental mode only)
const customResourceDefinitions: Readable<readonly KubernetesObject[]> = derived<
  typeof isKubernetesExperimentalModeStore,
  readonly KubernetesObject[]
>(
  isKubernetesExperimentalModeStore,
  (experimental, set) => {
    if (!experimental) {
      set([]);
      return;
    }
    let stopped = false;
    let disposable: IDisposable | undefined;
    listenResources(CUSTOM_RESOURCE_DEFINITIONS_RESOURCE, {}, set)
      .then(result => {
        if (stopped) {
          result?.dispose();
        } else {
          disposable = result;
        }
      })
      .catch((err: unknown) => console.error('error listening to custom resource definitions', err));
    return (): void => {
      stopped = true;
      disposable?.dispose();
    };
  },
  [],
);

// all the resource types which can be displayed with the generic resource pages
export const kubernetesResourceDescriptors: Readable<readonly KubeResourceDescriptor[]> = derived(
  customResourceDefinitions,
  crds => [...BUILTIN_RESOURCE_DESCRIPTORS, ...getCustomResourceDescriptors(crds)],
);

// the resource types to display in the navigation: all the built-in types, and the custom resource types
// having instances in the current context (generic resources are only available in experimental mode)
export const kubernetesNavigationResourceDescriptors: Readable<readonly KubeResourceDescriptor[]> = derived(
  [isKubernetesExperimentalModeStore, kubernetesResourceDescriptors, kubernetesResourcesCount, kubernetesContexts],
  ([experimental, descriptors, counts, contexts]) => {
    if (!experimental) {
      return [];
    }
    const currentContextName = contexts.find(context => context.currentContext)?.name;
    const instantiated = new Set(
      counts
        .filter(count => count.contextName === currentContextName && count.count > 0)
        .map(count => count.resourceName),
    );
    return descriptors.filter(
      descriptor => descriptor.info.category !== 'Custom Resources' || instantiated.has(descriptor.info.resource),
    );
  },
);
