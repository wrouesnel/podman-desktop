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

import type {
  KubernetesObject,
  V1CustomResourceColumnDefinition,
  V1CustomResourceDefinition,
} from '@kubernetes/client-node';
import { getCustomResourceTypeInfo } from '@podman-desktop/core-api';
import humanizeDuration from 'humanize-duration';
import moment from 'moment';

import { evaluateJsonPath } from './jsonpath';
import {
  BUILTIN_RESOURCE_DESCRIPTORS,
  formatValue,
  getConditionsStatus,
  type KubeResourceColumn,
  type KubeResourceDescriptor,
  pluralize,
} from './kube-resource-descriptor';

function formatPrinterColumnValue(value: unknown, type: string): string | undefined {
  if (type === 'date' && (typeof value === 'string' || value instanceof Date)) {
    return humanizeDuration(moment().diff(value), { round: true, largest: 1 });
  }
  return formatValue(value);
}

function getPrinterColumn(definition: V1CustomResourceColumnDefinition): KubeResourceColumn {
  return {
    title: definition.name,
    value: (object: KubernetesObject): string | undefined => {
      const values = evaluateJsonPath(object, definition.jsonPath)
        .map(value => formatPrinterColumnValue(value, definition.type))
        .filter(value => value !== undefined);
      return values.length ? values.join(', ') : undefined;
    },
  };
}

// getCustomResourceDescriptor returns the descriptor of the resources defined by a CRD,
// using the additional printer columns of the CRD as columns
export function getCustomResourceDescriptor(crd: V1CustomResourceDefinition): KubeResourceDescriptor | undefined {
  const info = getCustomResourceTypeInfo(crd);
  if (!info) {
    return undefined;
  }
  const version = crd.spec.versions.find(v => v.name === info.version);
  const columns = (version?.additionalPrinterColumns ?? [])
    // only the columns displayed by default by kubectl, the creation date is already displayed as the Age column
    .filter(column => !column.priority && column.jsonPath !== '.metadata.creationTimestamp')
    .map(getPrinterColumn);
  return {
    info,
    label: pluralize(info.kind),
    singular: info.kind,
    columns,
    getStatus: getConditionsStatus,
  };
}

// getCustomResourceDescriptors returns the descriptors of the resources defined by CRDs, sorted by label.
// The group is added to the label of the types whose label is not unique
export function getCustomResourceDescriptors(crds: readonly KubernetesObject[]): KubeResourceDescriptor[] {
  const descriptors = crds
    .map(crd => getCustomResourceDescriptor(crd as V1CustomResourceDefinition))
    .filter(descriptor => !!descriptor);
  const labels = [...BUILTIN_RESOURCE_DESCRIPTORS, ...descriptors].map(descriptor => descriptor.label);
  return descriptors
    .map(descriptor =>
      labels.filter(label => label === descriptor.label).length > 1
        ? { ...descriptor, label: `${descriptor.label} (${descriptor.info.group})` }
        : descriptor,
    )
    .toSorted((a, b) => a.label.localeCompare(b.label));
}
