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

import type { KubernetesObjectUI } from '/@/lib/objects/KubernetesObjectUI';

export interface KubeResourceUI extends KubernetesObjectUI {
  // the resource name of the type of the object (statefulsets, ...)
  resource: string;
  apiVersion: string;
  kind: string;
  uid: string;
  // undefined for non-namespaced resources
  namespace?: string;
  created?: Date;
  selected: boolean;
  // values of the columns of the descriptor, in the same order
  values: (string | undefined)[];
}
