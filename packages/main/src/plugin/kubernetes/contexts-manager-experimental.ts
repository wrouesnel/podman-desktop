/**********************************************************************
 * Copyright (C) 2024 - 2025 Red Hat, Inc.
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

import type { KubeConfig, KubernetesObject, ObjectCache } from '@kubernetes/client-node';
import type {
  ContextGeneralState,
  ContextPermission,
  Event,
  KubernetesContextResources,
  KubernetesResourcesChanges,
  KubernetesResourcesVersion,
  KubernetesResourceTypeInfo,
  KubernetesTroubleshootingInformation,
  ResourceCount,
  ResourceName,
} from '@podman-desktop/core-api';
import { CUSTOM_RESOURCE_DEFINITIONS_RESOURCE, GENERIC_KUBERNETES_RESOURCE_TYPES } from '@podman-desktop/core-api';

import { Emitter } from '/@/plugin/events/emitter.js';

import { ConfigmapsResourceFactory } from './configmaps-resource-factory.js';
import type { ContextHealthState } from './context-health-checker.js';
import { ContextHealthChecker } from './context-health-checker.js';
import type { ContextPermissionResult } from './context-permissions-checker.js';
import { ContextPermissionsChecker } from './context-permissions-checker.js';
import { ContextResourceRegistry } from './context-resource-registry.js';
import type { CurrentChangeEvent, DispatcherEvent } from './contexts-dispatcher.js';
import { ContextsDispatcher } from './contexts-dispatcher.js';
import { CronjobsResourceFactory } from './cronjobs-resource-factory.js';
import { CustomResourcesMonitor } from './custom-resources-monitor.js';
import { DeploymentsResourceFactory } from './deployments-resource-factory.js';
import { EventsResourceFactory } from './events-resource-factory.js';
import { GenericResourceFactory } from './generic-resource-factory.js';
import { IngressesResourceFactory } from './ingresses-resource-factory.js';
import { JobsResourceFactory } from './jobs-resource-factory.js';
import type { KubeConfigSingleContext } from './kubeconfig-single-context.js';
import { NodesResourceFactory } from './nodes-resource-factory.js';
import { PodsResourceFactory } from './pods-resource-factory.js';
import { PVCsResourceFactory } from './pvcs-resource-factory.js';
import type { ResourceFactory } from './resource-factory.js';
import { ResourceFactoryHandler } from './resource-factory-handler.js';
import type { CacheUpdatedEvent, OfflineEvent, ResourceInformer } from './resource-informer.js';
import { RoutesResourceFactory } from './routes-resource-factory.js';
import { SecretsResourceFactory } from './secrets-resource-factory.js';
import { ServicesResourceFactory } from './services-resource-factory.js';

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * ContextsManagerExperimental receives new KubeConfig updates
 * and manages the monitoring for each context of the KubeConfig.
 *
 * ContextsManagerExperimental fire events when a context is deleted, and to forward the states of the health checkers, permission checkers and informers.
 *
 * ContextsManagerExperimental exposes the current state of the health checkers, permission checkers and informers.
 */
export class ContextsManagerExperimental {
  #resourceFactoryHandler: ResourceFactoryHandler;
  #dispatcher: ContextsDispatcher;
  #healthCheckers: Map<string, ContextHealthChecker>;
  #permissionsCheckers: ContextPermissionsChecker[];
  #informers: ContextResourceRegistry<ResourceInformer<KubernetesObject>>;
  #objectCaches: ContextResourceRegistry<ObjectCache<KubernetesObject>>;
  // monitors of the custom resource types having instances, by context
  #customResourcesMonitors: Map<string, CustomResourcesMonitor>;
  // permissions checkers for the custom resource types
  #customResourcesPermissionsCheckers: ContextResourceRegistry<ContextPermissionsChecker>;

  #onContextHealthStateChange = new Emitter<ContextHealthState>();
  onContextHealthStateChange: Event<ContextHealthState> = this.#onContextHealthStateChange.event;

  #onOfflineChange = new Emitter<void>();
  onOfflineChange: Event<void> = this.#onOfflineChange.event;

  #onContextPermissionResult = new Emitter<ContextPermissionResult>();
  onContextPermissionResult: Event<ContextPermissionResult> = this.#onContextPermissionResult.event;

  #onContextDelete = new Emitter<DispatcherEvent>();
  onContextDelete: Event<DispatcherEvent> = this.#onContextDelete.event;

  #onResourceUpdated = new Emitter<{ contextName: string; resourceName: string }>();
  onResourceUpdated: Event<{ contextName: string; resourceName: string }> = this.#onResourceUpdated.event;

  #onResourceCountUpdated = new Emitter<{ contextName: string; resourceName: string }>();
  onResourceCountUpdated: Event<{ contextName: string; resourceName: string }> = this.#onResourceCountUpdated.event;

  constructor() {
    this.#resourceFactoryHandler = new ResourceFactoryHandler();
    for (const resourceFactory of this.getResourceFactories()) {
      this.#resourceFactoryHandler.add(resourceFactory);
    }
    // Add more resources here
    this.#healthCheckers = new Map<string, ContextHealthChecker>();
    this.#permissionsCheckers = [];
    this.#informers = new ContextResourceRegistry<ResourceInformer<KubernetesObject>>();
    this.#objectCaches = new ContextResourceRegistry<ObjectCache<KubernetesObject>>();
    this.#customResourcesMonitors = new Map<string, CustomResourcesMonitor>();
    this.#customResourcesPermissionsCheckers = new ContextResourceRegistry<ContextPermissionsChecker>();
    this.#dispatcher = new ContextsDispatcher();
    this.#dispatcher.onUpdate(this.onUpdate.bind(this));
    this.#dispatcher.onDelete(this.onDelete.bind(this));
    this.#dispatcher.onDelete((state: DispatcherEvent) => this.#onContextDelete.fire(state));
    this.#dispatcher.onCurrentChange(this.onCurrentChange.bind(this));
  }

  protected getResourceFactories(): ResourceFactory[] {
    return [
      new ConfigmapsResourceFactory(),
      new CronjobsResourceFactory(),
      new JobsResourceFactory(),
      new DeploymentsResourceFactory(),
      new EventsResourceFactory(),
      new IngressesResourceFactory(),
      new NodesResourceFactory(),
      new PodsResourceFactory(),
      new PVCsResourceFactory(),
      new RoutesResourceFactory(),
      new SecretsResourceFactory(),
      new ServicesResourceFactory(),
      ...GENERIC_KUBERNETES_RESOURCE_TYPES.map(info => new GenericResourceFactory(info)),
    ];
  }

  async update(kubeconfig: KubeConfig): Promise<void> {
    this.#dispatcher.update(kubeconfig);
  }

  private async onUpdate(event: DispatcherEvent): Promise<void> {
    if (this.isMonitored(event.contextName)) {
      // we don't try to update the checkers, we recreate them
      return this.startMonitoring(event.config, event.contextName);
    }
  }

  private onDelete(state: DispatcherEvent): void {
    if (this.isMonitored(state.contextName)) {
      this.stopMonitoring(state.contextName);
    }
  }

  private async onCurrentChange(state: CurrentChangeEvent): Promise<void> {
    if (state.previous && this.isMonitored(state.previous)) {
      this.stopMonitoring(state.previous);
    }
    if (state.current && state.currentConfig) {
      await this.startMonitoring(state.currentConfig, state.current);
    }
  }

  private onStateChange(state: ContextHealthState): void {
    this.#onContextHealthStateChange.fire(state);
  }

  private onPermissionResult(event: ContextPermissionResult): void {
    this.#onContextPermissionResult.fire(event);
  }

  /* getHealthCheckersStates returns the current state of the health checkers */
  getHealthCheckersStates(): Map<string, ContextHealthState> {
    const result = new Map<string, ContextHealthState>();
    for (const [contextName, hc] of this.#healthCheckers.entries()) {
      result.set(contextName, hc.getState());
    }
    return result;
  }

  /* getPermissions returns the current permissions */
  getPermissions(): ContextPermission[] {
    return this.#permissionsCheckers.flatMap(permissionsChecker => permissionsChecker.getPermissions());
  }

  getResourcesCount(): ResourceCount[] {
    return this.#objectCaches.getAll().map(informer => ({
      contextName: informer.contextName,
      resourceName: informer.resourceName,
      count: informer.value.list().length,
    }));
  }

  // getActiveResourcesCount returns the count of filtered resources for each context/resource
  // when isActive is declared for a resource, and filtered with isActive
  getActiveResourcesCount(): ResourceCount[] {
    return this.#objectCaches
      .getAll()
      .map(informer => {
        const isActive = this.#resourceFactoryHandler.getResourceFactoryByResourceName(informer.resourceName)?.isActive;
        return isActive
          ? {
              contextName: informer.contextName,
              resourceName: informer.resourceName,
              count: informer.value.list().filter(isActive).length,
            }
          : undefined;
      })
      .filter(f => !!f);
  }

  getResources(contextNames: string[], resourceName: string): KubernetesContextResources[] {
    return this.#objectCaches.getForContextsAndResource(contextNames, resourceName).map(({ contextName, value }) => {
      return {
        contextName,
        items: value.list(),
      };
    });
  }

  // getResourcesChanges returns the changes of the resources of a context since the given version,
  // or all the resources if the changes cannot be computed
  getResourcesChanges(
    contextName: string,
    resourceName: string,
    since?: KubernetesResourcesVersion,
  ): KubernetesResourcesChanges {
    const cache = this.#objectCaches.get(contextName, resourceName);
    const informer = this.#informers.get(contextName, resourceName);
    if (!cache || !informer) {
      return { contextName, epoch: '', generation: 0, full: true, items: [], deleted: [] };
    }
    const tracker = informer.changesTracker;
    const changes = tracker.getChangesSince(since);
    if (changes) {
      return { contextName, ...tracker.version, full: false, ...changes };
    }
    return { contextName, ...tracker.version, full: true, items: cache.list(), deleted: [] };
  }

  getContextsGeneralState(): Map<string, ContextGeneralState> {
    return new Map<string, ContextGeneralState>();
  }

  getCurrentContextGeneralState(): ContextGeneralState {
    return {
      reachable: false,
      resources: {
        pods: 0,
        deployments: 0,
      },
    };
  }

  registerGetCurrentContextResources(_resourceName: ResourceName): KubernetesObject[] {
    return [];
  }

  unregisterGetCurrentContextResources(_resourceName: ResourceName): KubernetesObject[] {
    return [];
  }

  /* dispose all disposable resources created by the instance */
  dispose(): void {
    this.disposeAllHealthChecks();
    this.disposeAllPermissionsCheckers();
    this.disposeAllInformers();
    this.disposeAllCustomResourcesMonitors();
    this.#onContextHealthStateChange.dispose();
    this.#onContextDelete.dispose();
  }

  async refreshContextState(contextName: string): Promise<void> {
    try {
      const config = this.#dispatcher.getKubeConfigSingleContext(contextName);
      await this.startMonitoring(config, contextName);
    } catch (e: unknown) {
      console.warn(`unable to refresh context ${contextName}`, String(e));
    }
  }

  // disposeAllHealthChecks disposes all health checks and removes them from registry
  private disposeAllHealthChecks(): void {
    for (const [contextName, healthChecker] of this.#healthCheckers.entries()) {
      healthChecker.dispose();
      this.#healthCheckers.delete(contextName);
    }
  }

  // disposeAllPermissionsCheckers disposes all permissions checkers and removes them from registry
  private disposeAllPermissionsCheckers(): void {
    for (const permissionChecker of this.#permissionsCheckers) {
      permissionChecker.dispose();
    }
    this.#permissionsCheckers = [];
  }

  // disposeAllInformers disposes all informers and removes them from registry
  private disposeAllInformers(): void {
    for (const informer of this.#informers.getAll()) {
      informer.value.dispose();
    }
  }

  // disposeAllCustomResourcesMonitors disposes all custom resources monitors and removes them from registry
  private disposeAllCustomResourcesMonitors(): void {
    for (const monitor of this.#customResourcesMonitors.values()) {
      monitor.dispose();
    }
    this.#customResourcesMonitors.clear();
  }

  getTroubleshootingInformation(): KubernetesTroubleshootingInformation {
    return {
      healthCheckers: Array.from(this.#healthCheckers.values())
        .map(healthChecker => healthChecker.getState())
        .map(state => ({
          contextName: state.contextName,
          checking: state.checking,
          reachable: state.reachable,
        })),
      permissionCheckers: this.#permissionsCheckers.flatMap(permissionChecker => permissionChecker.getPermissions()),
      informers: this.#informers.getAll().map(informer => ({
        contextName: informer.contextName,
        resourceName: informer.resourceName,
        isOffline: informer.value.isOffline(),
        objectsCount: this.#objectCaches.get(informer.contextName, informer.resourceName)?.list().length,
      })),
    };
  }

  private isMonitored(contextName: string): boolean {
    return this.#healthCheckers.has(contextName);
  }

  protected async startMonitoring(config: KubeConfigSingleContext, contextName: string): Promise<void> {
    this.stopMonitoring(contextName);

    // register and start health checker
    const newHealthChecker = new ContextHealthChecker(config);
    this.#healthCheckers.set(contextName, newHealthChecker);
    newHealthChecker.onStateChange(this.onStateChange.bind(this));

    newHealthChecker.onReachable(async (state: ContextHealthState) => {
      // register and start permissions checker
      const previousPermissionsCheckers = this.#permissionsCheckers.filter(
        permissionChecker => permissionChecker.contextName === state.contextName,
      );
      for (const checker of previousPermissionsCheckers) {
        checker.dispose();
      }

      const namespace = state.kubeConfig.getNamespace();
      const permissionRequests = this.#resourceFactoryHandler.getPermissionsRequests(namespace);
      for (const permissionRequest of permissionRequests) {
        const newPermissionChecker = new ContextPermissionsChecker(
          state.kubeConfig,
          state.contextName,
          permissionRequest,
        );
        this.#permissionsCheckers.push(newPermissionChecker);
        newPermissionChecker.onPermissionResult(this.onPermissionResult.bind(this));

        newPermissionChecker.onPermissionResult((event: ContextPermissionResult) => {
          if (!event.permitted) {
            // if the user does not have watch permission, do not try to start informers on these resources
            return;
          }
          for (const resource of event.resources) {
            const contextName = event.kubeConfig.getKubeConfig().currentContext;
            const factory = this.#resourceFactoryHandler.getResourceFactoryByResourceName(resource);
            if (!factory) {
              throw new Error(
                `a permission for resource ${resource} has been received but no factory is handling it, this should not happen`,
              );
            }
            this.startInformer(event.kubeConfig, contextName, factory);
          }
        });
        await newPermissionChecker.start();
      }
    });
    await newHealthChecker.start({ timeout: HEALTH_CHECK_TIMEOUT_MS });
  }

  private startInformer(kubeConfig: KubeConfigSingleContext, contextName: string, factory: ResourceFactory): void {
    if (!factory.informer) {
      // no informer for this factory, skipping
      // (we may want to check permissions on some resource, without having to start an informer)
      return;
    }
    const resource = factory.resource;
    const informer = factory.informer.createInformer(kubeConfig);
    this.#informers.set(contextName, resource, informer);
    informer.onCacheUpdated((e: CacheUpdatedEvent) => {
      this.#onResourceUpdated.fire({
        contextName: e.kubeconfig.getKubeConfig().currentContext,
        resourceName: e.resourceName,
      });
      if (e.countChanged) {
        this.#onResourceCountUpdated.fire({
          contextName: e.kubeconfig.getKubeConfig().currentContext,
          resourceName: e.resourceName,
        });
      }
    });
    informer.onOffline((e: OfflineEvent) => {
      this.#onOfflineChange.fire();
      this.#objectCaches.removeForContext(e.kubeconfig.getKubeConfig().currentContext);
    });
    const cache = informer.start();
    this.#objectCaches.set(contextName, resource, cache);

    if (resource === CUSTOM_RESOURCE_DEFINITIONS_RESOURCE) {
      this.startCustomResourcesMonitor(kubeConfig, contextName, informer, cache);
    }
  }

  // startCustomResourcesMonitor starts watching the custom resources of the types having instances,
  // based on the CRDs received by the informer
  private startCustomResourcesMonitor(
    kubeConfig: KubeConfigSingleContext,
    contextName: string,
    crdsInformer: ResourceInformer<KubernetesObject>,
    crdsCache: ObjectCache<KubernetesObject>,
  ): void {
    this.#customResourcesMonitors.get(contextName)?.dispose();
    const monitor = new CustomResourcesMonitor({
      kubeconfig: kubeConfig,
      onInstantiated: (info: KubernetesResourceTypeInfo): void =>
        this.startCustomResourceInformer(kubeConfig, contextName, info),
      onRemoved: (resource: string): void => this.stopCustomResourceInformer(contextName, resource),
    });
    this.#customResourcesMonitors.set(contextName, monitor);
    crdsInformer.onCacheUpdated(() => monitor.update(crdsCache.list()));
    monitor.update(crdsCache.list());
    monitor.start();
  }

  private startCustomResourceInformer(
    kubeConfig: KubeConfigSingleContext,
    contextName: string,
    info: KubernetesResourceTypeInfo,
  ): void {
    const factory = new GenericResourceFactory(info);
    const permissionChecker = new ContextPermissionsChecker(kubeConfig, contextName, {
      attrs: {
        namespace: info.namespaced ? kubeConfig.getNamespace() : undefined,
        group: info.group,
        resource: info.plural,
        verb: 'watch',
      },
      resources: [info.resource],
    });
    this.#permissionsCheckers.push(permissionChecker);
    this.#customResourcesPermissionsCheckers.set(contextName, info.resource, permissionChecker);
    permissionChecker.onPermissionResult(this.onPermissionResult.bind(this));
    permissionChecker.onPermissionResult((event: ContextPermissionResult) => {
      if (event.permitted) {
        this.startInformer(kubeConfig, contextName, factory);
      }
    });
    permissionChecker.start().catch((err: unknown) => {
      console.warn(`unable to check permissions for ${info.resource} on context ${contextName}`, String(err));
    });
  }

  private stopCustomResourceInformer(contextName: string, resource: string): void {
    const permissionChecker = this.#customResourcesPermissionsCheckers.get(contextName, resource);
    if (permissionChecker) {
      permissionChecker.dispose();
      this.#permissionsCheckers = this.#permissionsCheckers.filter(checker => checker !== permissionChecker);
      this.#customResourcesPermissionsCheckers.remove(contextName, resource);
    }
    this.#informers.get(contextName, resource)?.dispose();
    this.#informers.remove(contextName, resource);
    this.#objectCaches.remove(contextName, resource);
    this.#onResourceCountUpdated.fire({ contextName, resourceName: resource });
  }

  protected stopMonitoring(contextName: string): void {
    const healthChecker = this.#healthCheckers.get(contextName);
    healthChecker?.dispose();
    this.#healthCheckers.delete(contextName);
    const permissionsCheckers = this.#permissionsCheckers.filter(
      permissionChecker => permissionChecker.contextName === contextName,
    );
    for (const checker of permissionsCheckers) {
      checker.dispose();
    }
    this.#permissionsCheckers = this.#permissionsCheckers.filter(
      permissionChecker => permissionChecker.contextName !== contextName,
    );

    const contextInformers = this.#informers.getForContext(contextName);
    for (const informer of contextInformers) {
      informer.dispose();
    }
    this.#informers.removeForContext(contextName);
    this.#objectCaches.removeForContext(contextName);

    this.#customResourcesMonitors.get(contextName)?.dispose();
    this.#customResourcesMonitors.delete(contextName);
    this.#customResourcesPermissionsCheckers.removeForContext(contextName);
  }

  // returns true if at least one informer for the context is 'offline'
  // meaning that it has lost connection with the cluster (after being connected)
  isContextOffline(contextName: string): boolean {
    const informers = this.#informers.getForContext(contextName);
    return informers.some(informer => informer.isOffline());
  }
}
