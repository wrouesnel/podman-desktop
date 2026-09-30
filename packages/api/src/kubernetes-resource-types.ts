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

// category used to order and group the Kubernetes resource types in the UI
export type KubernetesResourceCategory =
  | 'Workloads'
  | 'Network'
  | 'Storage'
  | 'Configuration'
  | 'Access Control'
  | 'Cluster'
  | 'Custom Resources';

// KubernetesResourceTypeInfo describes a Kubernetes resource type which can be watched and displayed generically
export interface KubernetesResourceTypeInfo {
  // unique name identifying the resource in the informers registry and in IPC events
  // (the plural name for built-in types, `<plural>.<group>` for custom resources)
  resource: string;
  // API group, empty for the core group
  group: string;
  version: string;
  kind: string;
  // plural name of the resource in the REST API
  plural: string;
  namespaced: boolean;
  category: KubernetesResourceCategory;
}

export function getKubernetesResourceTypeApiVersion(info: KubernetesResourceTypeInfo): string {
  return info.group ? `${info.group}/${info.version}` : info.version;
}

// getKubernetesResourceTypePath returns the path of the endpoint to list/watch the resources of the given type
// in the given namespace (or in the cluster for non-namespaced resources)
export function getKubernetesResourceTypePath(info: KubernetesResourceTypeInfo, namespace: string): string {
  const prefix = info.group ? `/apis/${info.group}/${info.version}` : `/api/${info.version}`;
  return info.namespaced ? `${prefix}/namespaces/${namespace}/${info.plural}` : `${prefix}/${info.plural}`;
}

function builtin(
  category: KubernetesResourceCategory,
  groupVersion: string,
  kind: string,
  plural: string,
  namespaced: boolean,
): KubernetesResourceTypeInfo {
  const separator = groupVersion.indexOf('/');
  const group = separator < 0 ? '' : groupVersion.slice(0, separator);
  const version = groupVersion.slice(separator + 1);
  return { resource: plural, group, version, kind, plural, namespaced, category };
}

// Built-in Kubernetes types without a dedicated page, displayed with the generic resource pages
export const GENERIC_KUBERNETES_RESOURCE_TYPES: readonly KubernetesResourceTypeInfo[] = [
  builtin('Workloads', 'apps/v1', 'StatefulSet', 'statefulsets', true),
  builtin('Workloads', 'apps/v1', 'DaemonSet', 'daemonsets', true),
  builtin('Workloads', 'apps/v1', 'ReplicaSet', 'replicasets', true),
  builtin('Workloads', 'v1', 'ReplicationController', 'replicationcontrollers', true),
  builtin('Workloads', 'autoscaling/v2', 'HorizontalPodAutoscaler', 'horizontalpodautoscalers', true),
  builtin('Workloads', 'policy/v1', 'PodDisruptionBudget', 'poddisruptionbudgets', true),
  builtin('Network', 'discovery.k8s.io/v1', 'EndpointSlice', 'endpointslices', true),
  builtin('Network', 'networking.k8s.io/v1', 'NetworkPolicy', 'networkpolicies', true),
  builtin('Network', 'networking.k8s.io/v1', 'IngressClass', 'ingressclasses', false),
  builtin('Storage', 'v1', 'PersistentVolume', 'persistentvolumes', false),
  builtin('Storage', 'storage.k8s.io/v1', 'StorageClass', 'storageclasses', false),
  builtin('Storage', 'storage.k8s.io/v1', 'CSIDriver', 'csidrivers', false),
  builtin('Storage', 'storage.k8s.io/v1', 'VolumeAttachment', 'volumeattachments', false),
  builtin('Configuration', 'v1', 'ResourceQuota', 'resourcequotas', true),
  builtin('Configuration', 'v1', 'LimitRange', 'limitranges', true),
  builtin('Configuration', 'coordination.k8s.io/v1', 'Lease', 'leases', true),
  builtin('Configuration', 'scheduling.k8s.io/v1', 'PriorityClass', 'priorityclasses', false),
  builtin('Configuration', 'node.k8s.io/v1', 'RuntimeClass', 'runtimeclasses', false),
  builtin(
    'Configuration',
    'admissionregistration.k8s.io/v1',
    'MutatingWebhookConfiguration',
    'mutatingwebhookconfigurations',
    false,
  ),
  builtin(
    'Configuration',
    'admissionregistration.k8s.io/v1',
    'ValidatingWebhookConfiguration',
    'validatingwebhookconfigurations',
    false,
  ),
  builtin('Access Control', 'v1', 'ServiceAccount', 'serviceaccounts', true),
  builtin('Access Control', 'rbac.authorization.k8s.io/v1', 'Role', 'roles', true),
  builtin('Access Control', 'rbac.authorization.k8s.io/v1', 'RoleBinding', 'rolebindings', true),
  builtin('Access Control', 'rbac.authorization.k8s.io/v1', 'ClusterRole', 'clusterroles', false),
  builtin('Access Control', 'rbac.authorization.k8s.io/v1', 'ClusterRoleBinding', 'clusterrolebindings', false),
  builtin('Cluster', 'v1', 'Namespace', 'namespaces', false),
  builtin('Cluster', 'apiextensions.k8s.io/v1', 'CustomResourceDefinition', 'customresourcedefinitions', false),
];

export function getGenericKubernetesResourceType(resource: string): KubernetesResourceTypeInfo | undefined {
  return GENERIC_KUBERNETES_RESOURCE_TYPES.find(info => info.resource === resource);
}
