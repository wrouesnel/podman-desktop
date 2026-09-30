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

import type { KubernetesListObject, KubernetesObject } from '@kubernetes/client-node';
import { KubernetesObjectApi } from '@kubernetes/client-node';
import type { KubernetesResourceTypeInfo } from '@podman-desktop/core-api';
import { getKubernetesResourceTypeApiVersion, getKubernetesResourceTypePath } from '@podman-desktop/core-api';

import type { KubeConfigSingleContext } from './kubeconfig-single-context.js';
import type { ResourceFactory } from './resource-factory.js';
import { ResourceFactoryBase } from './resource-factory.js';
import { ResourceInformer } from './resource-informer.js';

// GenericResourceFactory creates informers for any resource type described by a KubernetesResourceTypeInfo
export class GenericResourceFactory extends ResourceFactoryBase implements ResourceFactory {
  #info: KubernetesResourceTypeInfo;

  constructor(info: KubernetesResourceTypeInfo) {
    super({
      resource: info.resource,
    });
    this.#info = info;

    this.setPermissions({
      isNamespaced: info.namespaced,
      permissionsRequests: [
        {
          group: '*',
          resource: '*',
          verb: 'watch',
        },
        {
          group: info.group,
          resource: info.plural,
          verb: 'watch',
        },
      ],
    });
    this.setInformer({
      createInformer: this.createInformer.bind(this),
    });
  }

  get info(): KubernetesResourceTypeInfo {
    return this.#info;
  }

  createInformer(kubeconfig: KubeConfigSingleContext): ResourceInformer<KubernetesObject> {
    const info = this.#info;
    const namespace = kubeconfig.getNamespace();
    const apiClient = kubeconfig.getKubeConfig().makeApiClient(KubernetesObjectApi);
    const apiVersion = getKubernetesResourceTypeApiVersion(info);
    const listFn = (): Promise<KubernetesListObject<KubernetesObject>> =>
      apiClient.list(apiVersion, info.kind, info.namespaced ? namespace : undefined);
    const path = getKubernetesResourceTypePath(info, namespace);
    return new ResourceInformer<KubernetesObject>({ kubeconfig, path, listFn, kind: info.kind, plural: info.resource });
  }
}
