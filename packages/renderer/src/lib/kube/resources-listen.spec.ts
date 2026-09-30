/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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
import type { KubernetesContextResources } from '@podman-desktop/core-api';
import { writable } from 'svelte/store';
import { beforeAll, expect, type Mock, test, vi } from 'vitest';

import * as contexts from '/@/stores/kubernetes-contexts';

import { listenResources } from './resources-listen';

const callbacks = new Map<string, () => void>();

vi.mock(import('/@/stores/kubernetes-contexts'));

const eventEmitter = {
  receive: (message: string, callback: () => void): void => {
    callbacks.set(message, callback);
  },
};

beforeAll(() => {
  Object.defineProperty(window, 'events', {
    value: {
      receive: (message: string, callback: () => void) => {
        eventEmitter.receive(message, callback);
        return {
          dispose: (): void => {},
        };
      },
    },
  });
});

test('listenResources is undefined in non experimental mode', async () => {
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(false);
  const result = await listenResources('resource1', {}, (): void => {});
  expect(result).toBeUndefined();
});

test('listenResources is undefined in non experimental mode (getConfigurationValue fails)', async () => {
  vi.mocked(window.isExperimentalConfigurationEnabled).mockRejectedValue(undefined);
  const result = await listenResources('resource1', {}, (): void => {});
  expect(result).toBeUndefined();
});

test('non filtered resources', async () => {
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(true);
  vi.mocked(contexts).kubernetesContexts = writable([
    {
      currentContext: true,
      name: 'ctx1',
      cluster: 'cluster1',
      user: 'user1',
    },
  ]);
  const resource1: KubernetesObject = {
    metadata: {
      name: 'res1',
    },
  };
  const contextResource: KubernetesContextResources = {
    contextName: 'ctx1',
    items: [resource1],
  };

  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  vi.mocked(window.kubernetesGetResources).mockResolvedValue([contextResource]);

  const listener = await listenResources('resource1', {}, callbackSpy);
  expect(listener).not.toBeUndefined();

  expect(window.kubernetesGetResources).toHaveBeenCalledWith(['ctx1'], 'resource1');

  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([resource1]);
  });
});

test('updated resources without filter', async () => {
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(true);
  vi.mocked(contexts).kubernetesContexts = writable([
    {
      currentContext: true,
      name: 'ctx1',
      cluster: 'cluster1',
      user: 'user1',
    },
  ]);
  const resource1: KubernetesObject = {
    metadata: {
      name: 'res1',
    },
  };
  const contextResource: KubernetesContextResources = {
    contextName: 'ctx1',
    items: [resource1],
  };

  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  vi.mocked(window.kubernetesGetResources).mockResolvedValue([contextResource]);
  const listener = await listenResources('resource1', {}, callbackSpy);
  expect(listener).not.toBeUndefined();

  expect(window.kubernetesGetResources).toHaveBeenCalledWith(['ctx1'], 'resource1');

  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([resource1]);
  });

  // now update the resources and send an event
  const newResource: KubernetesObject = {
    metadata: {
      name: 'res2',
    },
  };
  contextResource.items = [resource1, newResource];
  const callback = callbacks.get('kubernetes-update-resource1');
  expect(callback).toBeDefined();
  callbackSpy.mockClear();
  callback!();
  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([resource1, newResource]);
  });
});

test('filtered resources', async () => {
  const searchTermStore = writable<string>('');
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(true);
  vi.mocked(contexts).kubernetesContexts = writable([
    {
      currentContext: true,
      name: 'ctx1',
      cluster: 'cluster1',
      user: 'user1',
    },
  ]);
  const resource1: KubernetesObject = {
    metadata: {
      name: 'res1',
    },
  };
  const resource2: KubernetesObject = {
    metadata: {
      name: 'res2',
    },
  };
  const contextResource: KubernetesContextResources = {
    contextName: 'ctx1',
    items: [resource1, resource2],
  };

  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  vi.mocked(window.kubernetesGetResources).mockResolvedValue([contextResource]);

  const listener = await listenResources(
    'resource1',
    {
      searchTermStore,
    },
    callbackSpy,
  );
  expect(listener).not.toBeUndefined();

  expect(window.kubernetesGetResources).toHaveBeenCalledWith(['ctx1'], 'resource1');

  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([resource1, resource2]);
  });

  // now set a search term matching no resource
  callbackSpy.mockClear();
  searchTermStore.set('notfound');
  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([]);
  });

  // now set a search term matching one resource
  callbackSpy.mockClear();
  searchTermStore.set('res1');
  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([resource1]);
  });
});

test('updated resources with filter', async () => {
  const searchTermStore = writable<string>('');
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(true);
  vi.mocked(contexts).kubernetesContexts = writable([
    {
      currentContext: true,
      name: 'ctx1',
      cluster: 'cluster1',
      user: 'user1',
    },
  ]);
  const resource1: KubernetesObject = {
    metadata: {
      name: 'res1',
    },
  };
  const resource2: KubernetesObject = {
    metadata: {
      name: 'res2',
    },
  };
  const contextResource: KubernetesContextResources = {
    contextName: 'ctx1',
    items: [resource1, resource2],
  };

  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  vi.mocked(window.kubernetesGetResources).mockResolvedValue([contextResource]);

  const listener = await listenResources(
    'resource1',
    {
      searchTermStore,
    },
    callbackSpy,
  );
  expect(listener).not.toBeUndefined();

  expect(window.kubernetesGetResources).toHaveBeenCalledWith(['ctx1'], 'resource1');

  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([resource1, resource2]);
  });

  // now set a search term matching no resource
  callbackSpy.mockClear();
  searchTermStore.set('res3');
  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([]);
  });

  // now update the resources and send an event
  const newResource: KubernetesObject = {
    metadata: {
      name: 'res3',
    },
  };
  contextResource.items = [resource1, resource2, newResource];
  const callback = callbacks.get('kubernetes-update-resource1');
  expect(callback).toBeDefined();
  callbackSpy.mockClear();
  callback!();
  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([newResource]);
  });
});

test('updates received while fetching are grouped in a single fetch', async () => {
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(true);
  vi.mocked(window.kubernetesGetResources).mockReset();
  vi.mocked(contexts).kubernetesContexts = writable([
    { currentContext: true, name: 'ctx1', cluster: 'cluster1', user: 'user1' },
  ]);
  const resolvers: ((value: KubernetesContextResources[]) => void)[] = [];
  vi.mocked(window.kubernetesGetResources).mockImplementation(async () => {
    return new Promise(resolve => resolvers.push(resolve));
  });
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();

  const listener = await listenResources('resource2', {}, callbackSpy);
  expect(window.kubernetesGetResources).toHaveBeenCalledTimes(1);

  // a burst of updates while the first fetch is running
  for (let i = 0; i < 100; i++) {
    callbacks.get('kubernetes-update-resource2')?.();
  }
  expect(window.kubernetesGetResources).toHaveBeenCalledTimes(1);

  const resource1 = { metadata: { name: 'res1' } };
  resolvers[0]!([{ contextName: 'ctx1', items: [resource1] }]);
  // a single fetch is done for the burst of updates
  await vi.waitFor(() => expect(window.kubernetesGetResources).toHaveBeenCalledTimes(2));
  expect(callbackSpy).toHaveBeenCalledWith([resource1]);

  const resource2 = { metadata: { name: 'res2' } };
  resolvers[1]!([{ contextName: 'ctx1', items: [resource1, resource2] }]);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenLastCalledWith([resource1, resource2]));
  expect(window.kubernetesGetResources).toHaveBeenCalledTimes(2);
  listener?.dispose();
});

test('changing the search term does not fetch the resources again', async () => {
  const searchTermStore = writable<string>('');
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(true);
  vi.mocked(window.kubernetesGetResources).mockReset();
  vi.mocked(contexts).kubernetesContexts = writable([
    { currentContext: true, name: 'ctx1', cluster: 'cluster1', user: 'user1' },
  ]);
  const resource1 = { metadata: { name: 'res1' } };
  const resource2 = { metadata: { name: 'res2' } };
  vi.mocked(window.kubernetesGetResources).mockResolvedValue([{ contextName: 'ctx1', items: [resource1, resource2] }]);
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();

  const listener = await listenResources('resource3', { searchTermStore }, callbackSpy);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledWith([resource1, resource2]));

  searchTermStore.set('res2');
  expect(callbackSpy).toHaveBeenLastCalledWith([resource2]);
  expect(window.kubernetesGetResources).toHaveBeenCalledTimes(1);
  listener?.dispose();
});

test('resources fetched for a previous context are ignored', async () => {
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(true);
  vi.mocked(window.kubernetesGetResources).mockReset();
  const contextsStore = writable([{ currentContext: true, name: 'ctx1', cluster: 'cluster1', user: 'user1' }]);
  vi.mocked(contexts).kubernetesContexts = contextsStore;
  const resolvers: ((value: KubernetesContextResources[]) => void)[] = [];
  vi.mocked(window.kubernetesGetResources).mockImplementation(async () => {
    return new Promise(resolve => resolvers.push(resolve));
  });
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();

  const listener = await listenResources('resource4', {}, callbackSpy);
  // the context changes while fetching the resources of ctx1
  contextsStore.set([
    { currentContext: false, name: 'ctx1', cluster: 'cluster1', user: 'user1' },
    { currentContext: true, name: 'ctx2', cluster: 'cluster1', user: 'user1' },
  ]);

  resolvers[0]!([{ contextName: 'ctx1', items: [{ metadata: { name: 'res-ctx1' } }] }]);
  await vi.waitFor(() => expect(window.kubernetesGetResources).toHaveBeenLastCalledWith(['ctx2'], 'resource4'));
  expect(callbackSpy).not.toHaveBeenCalled();

  const resourceCtx2 = { metadata: { name: 'res-ctx2' } };
  resolvers[1]!([{ contextName: 'ctx2', items: [resourceCtx2] }]);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledWith([resourceCtx2]));
  listener?.dispose();
});
