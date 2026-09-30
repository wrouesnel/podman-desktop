/**********************************************************************
 * Copyright (C) 2024 Red Hat, Inc.
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
  ContextHealth,
  ContextPermission,
  IDisposable,
  KubernetesContextResources,
  KubernetesResourcesChanges,
  KubernetesResourcesVersion,
  KubernetesTroubleshootingInformation,
  ResourceCount,
} from '@podman-desktop/core-api';
import type { ApiSenderType } from '@podman-desktop/core-api/api-sender';

import type { ContextHealthState } from './context-health-checker.js';
import type { ContextPermissionResult } from './context-permissions-checker.js';
import { resourcesNotificationThrottle } from './contexts-constants.js';
import type { DispatcherEvent } from './contexts-dispatcher.js';
import type { ContextsManagerExperimental } from './contexts-manager-experimental.js';

export class ContextsStatesDispatcher implements IDisposable {
  #disposables: IDisposable[] = [];
  // pending notifications, by channel
  #throttleTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private manager: ContextsManagerExperimental,
    private apiSender: ApiSenderType,
  ) {}

  init(): void {
    this.#disposables.push(
      this.manager.onContextHealthStateChange((_state: ContextHealthState) => this.updateHealthStates()),
    );
    this.#disposables.push(
      this.manager.onOfflineChange(() => {
        this.updateHealthStates();
        this.updateResourcesCount();
        this.updateActiveResourcesCount();
      }),
    );
    this.#disposables.push(
      this.manager.onContextPermissionResult((_permissions: ContextPermissionResult) => this.updatePermissions()),
    );
    this.#disposables.push(
      this.manager.onContextDelete((_state: DispatcherEvent) => {
        this.updateHealthStates();
        this.updatePermissions();
      }),
    );
    this.#disposables.push(this.manager.onResourceCountUpdated(() => this.updateResourcesCount()));
    this.#disposables.push(
      this.manager.onResourceUpdated(event => {
        this.updateResource(event.resourceName);
        this.updateActiveResourcesCount();
      }),
    );
  }

  updateHealthStates(): void {
    this.apiSender.send('kubernetes-contexts-healths');
  }

  getContextsHealths(): ContextHealth[] {
    const value: ContextHealth[] = [];
    for (const [contextName, health] of this.manager.getHealthCheckersStates()) {
      value.push({
        contextName,
        checking: health.checking,
        reachable: health.reachable,
        offline: this.manager.isContextOffline(contextName),
        errorMessage: health.errorMessage,
      });
    }
    return value;
  }

  updatePermissions(): void {
    this.apiSender.send('kubernetes-contexts-permissions');
  }

  getContextsPermissions(): ContextPermission[] {
    return this.manager.getPermissions();
  }

  updateResourcesCount(): void {
    this.sendThrottled(`kubernetes-resources-count`);
  }

  updateActiveResourcesCount(): void {
    this.sendThrottled(`kubernetes-active-resources-count`);
  }

  getResourcesCount(): ResourceCount[] {
    return this.manager.getResourcesCount();
  }

  getActiveResourcesCount(): ResourceCount[] {
    return this.manager.getActiveResourcesCount();
  }

  updateResource(resourceName: string): void {
    this.sendThrottled(`kubernetes-update-${resourceName}`);
  }

  // sendThrottled sends a notification on the channel after a delay, if no notification is already pending
  // on this channel. As the notifications do not contain data (the renderer fetches the data when receiving
  // the notification), this groups the bursts of updates (informers send one update per resource when
  // listing resources) in a single notification, while ensuring a notification is sent at a regular rate
  // when updates are received continuously.
  private sendThrottled(channel: string): void {
    if (this.#throttleTimers.has(channel)) {
      return;
    }
    this.#throttleTimers.set(
      channel,
      setTimeout(() => {
        this.#throttleTimers.delete(channel);
        this.apiSender.send(channel);
      }, resourcesNotificationThrottle),
    );
  }

  getResources(contextNames: string[], resourceName: string): KubernetesContextResources[] {
    return this.manager.getResources(contextNames, resourceName);
  }

  getResourcesChanges(
    contextName: string,
    resourceName: string,
    since?: KubernetesResourcesVersion,
  ): KubernetesResourcesChanges {
    return this.manager.getResourcesChanges(contextName, resourceName, since);
  }

  getTroubleshootingInformation(): KubernetesTroubleshootingInformation {
    return this.manager.getTroubleshootingInformation();
  }

  dispose(): void {
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#disposables = [];
    for (const timer of this.#throttleTimers.values()) {
      clearTimeout(timer);
    }
    this.#throttleTimers.clear();
  }
}
