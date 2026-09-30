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

import type { KubernetesObject, ObjectCache } from '@kubernetes/client-node';
import { KubeConfig } from '@kubernetes/client-node';
import type { KubernetesResourceTypeInfo } from '@podman-desktop/core-api';
import { beforeEach, expect, test, vi } from 'vitest';

import type { ContextHealthState } from './context-health-checker.js';
import { ContextHealthChecker } from './context-health-checker.js';
import type { ContextPermissionResult, ContextPermissionsRequest } from './context-permissions-checker.js';
import { ContextPermissionsChecker } from './context-permissions-checker.js';
import { ContextsManagerExperimental } from './contexts-manager-experimental.js';
import type { CustomResourcesMonitorOptions } from './custom-resources-monitor.js';
import { CustomResourcesMonitor } from './custom-resources-monitor.js';
import { GenericResourceFactory } from './generic-resource-factory.js';
import { KubeConfigSingleContext } from './kubeconfig-single-context.js';
import { ResourceChangesTracker } from './resource-changes-tracker.js';
import type { ResourceFactory } from './resource-factory.js';
import { ResourceFactoryBase } from './resource-factory.js';
import type { CacheUpdatedEvent, ResourceInformer } from './resource-informer.js';

interface MockInformer {
  informer: ResourceInformer<KubernetesObject>;
  tracker: ResourceChangesTracker;
  items: KubernetesObject[];
  fireCacheUpdated: () => void;
}

const informers = new Map<string, MockInformer>();

function createMockInformer(kubeconfig: KubeConfigSingleContext, resource: string): ResourceInformer<KubernetesObject> {
  const cacheUpdatedListeners: ((e: CacheUpdatedEvent) => void)[] = [];
  const tracker = new ResourceChangesTracker();
  const mock: MockInformer = {
    tracker,
    items: [],
    fireCacheUpdated: (): void =>
      cacheUpdatedListeners.forEach(listener => listener({ kubeconfig, resourceName: resource, countChanged: true })),
    informer: {
      onCacheUpdated: vi.fn((listener: (e: CacheUpdatedEvent) => void) => {
        cacheUpdatedListeners.push(listener);
        return { dispose: vi.fn() };
      }),
      onOffline: vi.fn(),
      start: vi.fn(
        (): ObjectCache<KubernetesObject> => ({ list: () => mock.items }) as unknown as ObjectCache<KubernetesObject>,
      ),
      dispose: vi.fn(),
      changesTracker: tracker,
    } as unknown as ResourceInformer<KubernetesObject>,
  };
  informers.set(resource, mock);
  return mock.informer;
}

class TestContextsManagerExperimental extends ContextsManagerExperimental {
  override getResourceFactories(): ResourceFactory[] {
    return [
      new ResourceFactoryBase({ resource: 'customresourcedefinitions' })
        .setPermissions({
          isNamespaced: false,
          permissionsRequests: [{ group: '*', resource: '*', verb: 'watch' }],
        })
        .setInformer({
          createInformer: (kubeconfig: KubeConfigSingleContext) =>
            createMockInformer(kubeconfig, 'customresourcedefinitions'),
        }),
    ];
  }

  public override stopMonitoring(contextName: string): void {
    return super.stopMonitoring(contextName);
  }
}

vi.mock(import('./context-health-checker.js'), () => ({
  ContextHealthChecker: vi.fn(class {}) as unknown as typeof ContextHealthChecker,
}));
vi.mock(import('./context-permissions-checker.js'), () => ({
  ContextPermissionsChecker: vi.fn(
    class {
      contextName: string;
      request: ContextPermissionsRequest;
      constructor(_kubeconfig: KubeConfigSingleContext, contextName: string, request: ContextPermissionsRequest) {
        this.contextName = contextName;
        this.request = request;
      }
    },
  ) as unknown as typeof ContextPermissionsChecker,
}));
vi.mock(import('./custom-resources-monitor.js'));
vi.mock(import('./generic-resource-factory.js'), () => ({
  GenericResourceFactory: vi.fn(
    class {
      resource: string;
      informer: { createInformer: (kubeconfig: KubeConfigSingleContext) => ResourceInformer<KubernetesObject> };
      constructor(info: KubernetesResourceTypeInfo) {
        this.resource = info.resource;
        this.informer = {
          createInformer: (kubeconfig: KubeConfigSingleContext): ResourceInformer<KubernetesObject> =>
            createMockInformer(kubeconfig, info.resource),
        };
      }
    },
  ) as unknown as typeof GenericResourceFactory,
}));

const certificates: KubernetesResourceTypeInfo = {
  resource: 'certificates.cert-manager.io',
  group: 'cert-manager.io',
  version: 'v1',
  kind: 'Certificate',
  plural: 'certificates',
  namespaced: true,
  category: 'Custom Resources',
};

let kubeConfig: KubeConfig;
let permitted: boolean;

beforeEach(() => {
  vi.resetAllMocks();
  informers.clear();
  permitted = true;
  kubeConfig = new KubeConfig();
  kubeConfig.loadFromOptions({
    clusters: [{ name: 'cluster1', server: 'https://server1' }],
    users: [{ name: 'user1' }],
    contexts: [{ name: 'context1', cluster: 'cluster1', user: 'user1', namespace: 'ns1' }],
    currentContext: 'context1',
  });
  const kcSingle = new KubeConfigSingleContext(kubeConfig, kubeConfig.contexts[0]!);

  vi.mocked(ContextHealthChecker.prototype).onReachable = vi.fn().mockImplementation(f => {
    f({ kubeConfig: kcSingle, contextName: 'context1', checking: false, reachable: true } as ContextHealthState);
    return { dispose: vi.fn() };
  });
  vi.mocked(ContextHealthChecker.prototype).onStateChange = vi.fn();
  vi.mocked(ContextHealthChecker.prototype).start = vi.fn();
  vi.mocked(ContextHealthChecker.prototype).dispose = vi.fn();

  // permission results are sent for the resources of the request
  vi.mocked(ContextPermissionsChecker.prototype).onPermissionResult = vi.fn().mockImplementation(function (
    this: { request: ContextPermissionsRequest },
    f: (result: ContextPermissionResult) => void,
  ) {
    const request = this.request;
    setTimeout(() => f({ kubeConfig: kcSingle, resources: request.resources, attrs: request.attrs, permitted }));
    return { dispose: vi.fn() };
  });
  vi.mocked(ContextPermissionsChecker.prototype).start = vi.fn().mockResolvedValue(undefined);
  vi.mocked(ContextPermissionsChecker.prototype).dispose = vi.fn();
  vi.mocked(ContextPermissionsChecker.prototype).getPermissions = vi.fn().mockReturnValue([]);
});

async function startManager(): Promise<{
  manager: TestContextsManagerExperimental;
  options: CustomResourcesMonitorOptions;
}> {
  const manager = new TestContextsManagerExperimental();
  await manager.update(kubeConfig);
  await vi.waitFor(() => expect(CustomResourcesMonitor).toHaveBeenCalledOnce());
  return { manager, options: vi.mocked(CustomResourcesMonitor).mock.calls[0]![0] };
}

test('the custom resources monitor receives the CRDs', async () => {
  const { options } = await startManager();
  const monitor = vi.mocked(CustomResourcesMonitor).mock.instances[0]!;

  expect(options.kubeconfig.getKubeConfig().currentContext).toEqual('context1');
  expect(monitor.update).toHaveBeenCalledWith([]);
  expect(monitor.start).toHaveBeenCalled();

  const crdsInformer = informers.get('customresourcedefinitions')!;
  const crd = { metadata: { name: 'certificates.cert-manager.io' } };
  crdsInformer.items = [crd];
  crdsInformer.fireCacheUpdated();
  expect(monitor.update).toHaveBeenLastCalledWith([crd]);
});

test('an informer is started for instantiated custom resources when permitted', async () => {
  const { manager, options } = await startManager();
  options.onInstantiated(certificates);

  expect(ContextPermissionsChecker).toHaveBeenLastCalledWith(expect.anything(), 'context1', {
    attrs: { namespace: 'ns1', group: 'cert-manager.io', resource: 'certificates', verb: 'watch' },
    resources: ['certificates.cert-manager.io'],
  });
  await vi.waitFor(() => expect(informers.get('certificates.cert-manager.io')).toBeDefined());
  expect(GenericResourceFactory).toHaveBeenCalledWith(certificates);

  const certificate = { metadata: { name: 'cert1' } };
  informers.get('certificates.cert-manager.io')!.items = [certificate];
  expect(manager.getResources(['context1'], 'certificates.cert-manager.io')).toEqual([
    { contextName: 'context1', items: [certificate] },
  ]);
  expect(manager.getResourcesCount()).toContainEqual({
    contextName: 'context1',
    resourceName: 'certificates.cert-manager.io',
    count: 1,
  });
});

test('no informer is started for instantiated custom resources when not permitted', async () => {
  const { options } = await startManager();
  permitted = false;
  options.onInstantiated(certificates);

  await new Promise(resolve => setTimeout(resolve, 10));
  expect(informers.get('certificates.cert-manager.io')).toBeUndefined();
});

test('the informer is stopped when the custom resource type is removed', async () => {
  const { manager, options } = await startManager();
  options.onInstantiated(certificates);
  await vi.waitFor(() => expect(informers.get('certificates.cert-manager.io')).toBeDefined());
  const countListener = vi.fn();
  manager.onResourceCountUpdated(countListener);

  options.onRemoved('certificates.cert-manager.io');

  expect(informers.get('certificates.cert-manager.io')!.informer.dispose).toHaveBeenCalled();
  expect(ContextPermissionsChecker.prototype.dispose).toHaveBeenCalled();
  expect(manager.getResources(['context1'], 'certificates.cert-manager.io')).toEqual([]);
  expect(countListener).toHaveBeenCalledWith({ contextName: 'context1', resourceName: 'certificates.cert-manager.io' });
});

test('the custom resources monitor is disposed when the monitoring stops', async () => {
  const { manager } = await startManager();
  const monitor = vi.mocked(CustomResourcesMonitor).mock.instances[0]!;

  manager.stopMonitoring('context1');
  expect(monitor.dispose).toHaveBeenCalled();
});

test('the custom resources monitors are disposed with the manager', async () => {
  const { manager } = await startManager();
  const monitor = vi.mocked(CustomResourcesMonitor).mock.instances[0]!;

  manager.dispose();
  expect(monitor.dispose).toHaveBeenCalled();
});

test('getResourcesChanges returns all the resources, then the changes', async () => {
  const { manager } = await startManager();
  const crdsInformer = informers.get('customresourcedefinitions')!;
  const crd1 = { metadata: { name: 'crd1', uid: 'uid1' } };
  const crd2 = { metadata: { name: 'crd2', uid: 'uid2' } };
  crdsInformer.items = [crd1, crd2];
  crdsInformer.tracker.upsert(crd1);
  crdsInformer.tracker.upsert(crd2);

  const all = manager.getResourcesChanges('context1', 'customresourcedefinitions');
  expect(all).toEqual({
    contextName: 'context1',
    epoch: crdsInformer.tracker.epoch,
    generation: 2,
    full: true,
    items: [crd1, crd2],
    deleted: [],
  });

  crdsInformer.tracker.delete(crd1);
  crdsInformer.items = [crd2];
  const changes = manager.getResourcesChanges('context1', 'customresourcedefinitions', {
    epoch: all.epoch,
    generation: all.generation,
  });
  expect(changes).toEqual({
    contextName: 'context1',
    epoch: crdsInformer.tracker.epoch,
    generation: 3,
    full: false,
    items: [],
    deleted: ['uid1'],
  });

  // unknown version: all the resources are returned
  expect(
    manager.getResourcesChanges('context1', 'customresourcedefinitions', { epoch: 'other', generation: 1 }),
  ).toEqual(expect.objectContaining({ full: true, items: [crd2] }));
});

test('getResourcesChanges returns no resources for an unknown resource', async () => {
  const { manager } = await startManager();
  expect(manager.getResourcesChanges('context1', 'unknown')).toEqual({
    contextName: 'context1',
    epoch: '',
    generation: 0,
    full: true,
    items: [],
    deleted: [],
  });
});
