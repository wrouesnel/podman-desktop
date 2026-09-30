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
import type { KubernetesResourceTypeInfo } from '@podman-desktop/core-api';
import { GENERIC_KUBERNETES_RESOURCE_TYPES } from '@podman-desktop/core-api';

// a column displayed in the list of resources, and in the summary of a resource
export interface KubeResourceColumn {
  title: string;
  value: (object: KubernetesObject) => string | undefined;
}

// KubeResourceDescriptor describes how to display a resource type in the generic resource pages
export interface KubeResourceDescriptor {
  info: KubernetesResourceTypeInfo;
  // plural name displayed to the user (StatefulSets, ...)
  label: string;
  // singular name displayed to the user (StatefulSet, ...)
  singular: string;
  columns: KubeResourceColumn[];
  getStatus: (object: KubernetesObject) => string;
}

// placeholder used in URLs in place of the namespace, for non-namespaced resources
// (a namespace name cannot contain an underscore)
export const NO_NAMESPACE = '_';

export function getResourceListURL(resource: string): string {
  return `/kubernetes/resources/${encodeURIComponent(resource)}`;
}

export function getResourceDetailsURL(resource: string, name: string, namespace?: string): string {
  return `${getResourceListURL(resource)}/${encodeURIComponent(name)}/${encodeURIComponent(namespace ?? NO_NAMESPACE)}/summary`;
}

export function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/i.test(word)) {
    return `${word}es`;
  }
  return `${word}s`;
}

// getValue returns the value at the given dotted path (spec.replicas, ...) of an object
export function getValue(object: unknown, path: string): unknown {
  let current: unknown = object;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(v => formatValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function column(title: string, path: string): KubeResourceColumn {
  return { title, value: (object): string | undefined => formatValue(getValue(object, path)) };
}

function computed(title: string, fn: (object: KubernetesObject) => unknown): KubeResourceColumn {
  return { title, value: (object): string | undefined => formatValue(fn(object)) };
}

function count(title: string, path: string): KubeResourceColumn {
  return computed(title, object => {
    const value = getValue(object, path);
    return Array.isArray(value) ? value.length : 0;
  });
}

function ratio(title: string, currentPath: string, desiredPath: string): KubeResourceColumn {
  return computed(title, object => `${getValue(object, currentPath) ?? 0}/${getValue(object, desiredPath) ?? 0}`);
}

function labelSelector(title: string, path: string): KubeResourceColumn {
  return computed(title, object => {
    const selector = getValue(object, path) as { matchLabels?: Record<string, string> } | undefined;
    const labels = Object.entries(selector?.matchLabels ?? {}).map(([key, value]) => `${key}=${value}`);
    return labels.length ? labels.join(', ') : undefined;
  });
}

// status for resources managing replicas: RUNNING when all replicas are ready, DEGRADED when some are not
function replicasStatus(readyPath: string, desiredPath: string): (object: KubernetesObject) => string {
  return (object): string => {
    const desired = Number(getValue(object, desiredPath) ?? 0);
    const ready = Number(getValue(object, readyPath) ?? 0);
    if (desired === 0) {
      return '';
    }
    return ready >= desired ? 'RUNNING' : 'DEGRADED';
  };
}

function phaseStatus(runningPhases: string[]): (object: KubernetesObject) => string {
  return (object): string => {
    const phase = getValue(object, 'status.phase');
    if (typeof phase !== 'string') {
      return '';
    }
    return runningPhases.includes(phase) ? 'RUNNING' : 'DEGRADED';
  };
}

// default status: based on the Ready or Available condition, if any
export function getConditionsStatus(object: KubernetesObject): string {
  const conditions = getValue(object, 'status.conditions');
  if (!Array.isArray(conditions)) {
    return '';
  }
  const condition = conditions.find(c => c?.type === 'Ready') ?? conditions.find(c => c?.type === 'Available');
  if (condition?.status === 'True') {
    return 'RUNNING';
  }
  if (condition?.status === 'False') {
    return 'DEGRADED';
  }
  return '';
}

const BUILTIN_DISPLAY: Record<
  string,
  { columns: KubeResourceColumn[]; getStatus?: (object: KubernetesObject) => string }
> = {
  statefulsets: {
    columns: [ratio('Ready', 'status.readyReplicas', 'spec.replicas'), column('Service', 'spec.serviceName')],
    getStatus: replicasStatus('status.readyReplicas', 'spec.replicas'),
  },
  daemonsets: {
    columns: [
      column('Desired', 'status.desiredNumberScheduled'),
      column('Ready', 'status.numberReady'),
      column('Up-to-date', 'status.updatedNumberScheduled'),
      column('Available', 'status.numberAvailable'),
    ],
    getStatus: replicasStatus('status.numberReady', 'status.desiredNumberScheduled'),
  },
  replicasets: {
    columns: [
      column('Desired', 'spec.replicas'),
      column('Current', 'status.replicas'),
      column('Ready', 'status.readyReplicas'),
    ],
    getStatus: replicasStatus('status.readyReplicas', 'spec.replicas'),
  },
  replicationcontrollers: {
    columns: [
      column('Desired', 'spec.replicas'),
      column('Current', 'status.replicas'),
      column('Ready', 'status.readyReplicas'),
    ],
    getStatus: replicasStatus('status.readyReplicas', 'spec.replicas'),
  },
  horizontalpodautoscalers: {
    columns: [
      computed(
        'Reference',
        o => `${getValue(o, 'spec.scaleTargetRef.kind')}/${getValue(o, 'spec.scaleTargetRef.name')}`,
      ),
      computed('Min pods', o => getValue(o, 'spec.minReplicas') ?? 1),
      column('Max pods', 'spec.maxReplicas'),
      column('Replicas', 'status.currentReplicas'),
    ],
  },
  poddisruptionbudgets: {
    columns: [
      column('Min available', 'spec.minAvailable'),
      column('Max unavailable', 'spec.maxUnavailable'),
      column('Allowed disruptions', 'status.disruptionsAllowed'),
    ],
  },
  endpointslices: {
    columns: [
      column('Address type', 'addressType'),
      computed('Ports', o => (getValue(o, 'ports') as { port?: number }[] | undefined)?.map(p => p.port)),
      computed('Endpoints', o =>
        (getValue(o, 'endpoints') as { addresses?: string[] }[] | undefined)?.flatMap(e => e.addresses ?? []),
      ),
    ],
  },
  networkpolicies: {
    columns: [labelSelector('Pod selector', 'spec.podSelector'), column('Policy types', 'spec.policyTypes')],
  },
  ingressclasses: {
    columns: [
      column('Controller', 'spec.controller'),
      computed('Default', o => o.metadata?.annotations?.['ingressclass.kubernetes.io/is-default-class'] ?? 'false'),
    ],
  },
  persistentvolumes: {
    columns: [
      column('Capacity', 'spec.capacity.storage'),
      column('Access modes', 'spec.accessModes'),
      column('Reclaim policy', 'spec.persistentVolumeReclaimPolicy'),
      column('Status', 'status.phase'),
      computed('Claim', o =>
        getValue(o, 'spec.claimRef')
          ? `${getValue(o, 'spec.claimRef.namespace')}/${getValue(o, 'spec.claimRef.name')}`
          : undefined,
      ),
      column('Storage class', 'spec.storageClassName'),
    ],
    getStatus: phaseStatus(['Bound', 'Available']),
  },
  storageclasses: {
    columns: [
      column('Provisioner', 'provisioner'),
      column('Reclaim policy', 'reclaimPolicy'),
      column('Binding mode', 'volumeBindingMode'),
      computed('Default', o => o.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] ?? 'false'),
    ],
  },
  csidrivers: {
    columns: [column('Attach required', 'spec.attachRequired'), column('Modes', 'spec.volumeLifecycleModes')],
  },
  volumeattachments: {
    columns: [
      column('Attacher', 'spec.attacher'),
      column('Persistent volume', 'spec.source.persistentVolumeName'),
      column('Node', 'spec.nodeName'),
      column('Attached', 'status.attached'),
    ],
  },
  resourcequotas: {
    columns: [
      computed('Used / Hard', o => {
        const hard = (getValue(o, 'status.hard') ?? getValue(o, 'spec.hard') ?? {}) as Record<string, string>;
        const used = (getValue(o, 'status.used') ?? {}) as Record<string, string>;
        return Object.entries(hard).map(([key, value]) => `${key}: ${used[key] ?? 0}/${value}`);
      }),
    ],
  },
  limitranges: {
    columns: [
      computed('Types', o => (getValue(o, 'spec.limits') as { type?: string }[] | undefined)?.map(l => l.type)),
    ],
  },
  leases: {
    columns: [column('Holder', 'spec.holderIdentity')],
  },
  priorityclasses: {
    columns: [column('Value', 'value'), computed('Global default', o => getValue(o, 'globalDefault') ?? false)],
  },
  runtimeclasses: {
    columns: [column('Handler', 'handler')],
  },
  mutatingwebhookconfigurations: {
    columns: [count('Webhooks', 'webhooks')],
  },
  validatingwebhookconfigurations: {
    columns: [count('Webhooks', 'webhooks')],
  },
  serviceaccounts: {
    columns: [count('Secrets', 'secrets')],
  },
  roles: {
    columns: [count('Rules', 'rules')],
  },
  clusterroles: {
    columns: [count('Rules', 'rules')],
  },
  rolebindings: {
    columns: [
      computed('Role', o => `${getValue(o, 'roleRef.kind')}/${getValue(o, 'roleRef.name')}`),
      computed('Subjects', o => (getValue(o, 'subjects') as { name?: string }[] | undefined)?.map(s => s.name)),
    ],
  },
  clusterrolebindings: {
    columns: [
      computed('Role', o => `${getValue(o, 'roleRef.kind')}/${getValue(o, 'roleRef.name')}`),
      computed('Subjects', o => (getValue(o, 'subjects') as { name?: string }[] | undefined)?.map(s => s.name)),
    ],
  },
  namespaces: {
    columns: [column('Status', 'status.phase')],
    getStatus: phaseStatus(['Active']),
  },
  customresourcedefinitions: {
    columns: [
      column('Group', 'spec.group'),
      column('Kind', 'spec.names.kind'),
      column('Scope', 'spec.scope'),
      computed('Versions', o => (getValue(o, 'spec.versions') as { name?: string }[] | undefined)?.map(v => v.name)),
    ],
    getStatus: (o): string => {
      const conditions = getValue(o, 'status.conditions') as { type?: string; status?: string }[] | undefined;
      return conditions?.some(c => c.type === 'Established' && c.status === 'True') ? 'RUNNING' : '';
    },
  },
};

export function getBuiltinResourceDescriptor(info: KubernetesResourceTypeInfo): KubeResourceDescriptor {
  const display = BUILTIN_DISPLAY[info.resource];
  return {
    info,
    label: pluralize(info.kind),
    singular: info.kind,
    columns: display?.columns ?? [],
    getStatus: display?.getStatus ?? getConditionsStatus,
  };
}

export const BUILTIN_RESOURCE_DESCRIPTORS: readonly KubeResourceDescriptor[] =
  GENERIC_KUBERNETES_RESOURCE_TYPES.map(getBuiltinResourceDescriptor);
