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
import type { KubeContext, KubernetesResourcesChanges } from '@podman-desktop/core-api';
import { writable } from 'svelte/store';
import { beforeAll, beforeEach, expect, type Mock, test, vi } from 'vitest';

import * as contexts from '/@/stores/kubernetes-contexts';

import { listenResources } from './resources-listen';

const callbacks = new Map<string, () => void>();

vi.mock(import('/@/stores/kubernetes-contexts'));

beforeAll(() => {
  Object.defineProperty(window, 'events', {
    value: {
      receive: (message: string, callback: () => void) => {
        callbacks.set(message, callback);
        return {
          dispose: (): void => {},
        };
      },
    },
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  callbacks.clear();
  vi.mocked(window.isExperimentalConfigurationEnabled).mockResolvedValue(true);
  vi.mocked(contexts).kubernetesContexts = writable([context('ctx1', true)]);
});

function context(name: string, currentContext: boolean): KubeContext {
  return { currentContext, name, cluster: 'cluster1', user: 'user1' };
}

function res(name: string, resourceVersion = '1'): KubernetesObject {
  return { metadata: { name, uid: `uid-${name}`, resourceVersion } };
}

function changes(
  generation: number,
  items: KubernetesObject[],
  options?: { full?: boolean; deleted?: string[]; contextName?: string; epoch?: string },
): KubernetesResourcesChanges {
  return {
    contextName: options?.contextName ?? 'ctx1',
    epoch: options?.epoch ?? 'epoch1',
    generation,
    full: options?.full ?? false,
    items,
    deleted: options?.deleted ?? [],
  };
}

function fireUpdate(resourceName: string): void {
  callbacks.get(`kubernetes-update-${resourceName}`)?.();
}

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

test('all the resources are fetched initially', async () => {
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValue(changes(1, [res('res1')], { full: true }));
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();

  const listener = await listenResources('resource1', {}, callbackSpy);
  expect(listener).not.toBeUndefined();
  expect(window.kubernetesGetResourcesChanges).toHaveBeenCalledWith('ctx1', 'resource1', undefined);
  await vi.waitFor(() => {
    expect(callbackSpy).toHaveBeenCalledWith([res('res1')]);
  });
});

test('only the changes since the last version are fetched and applied', async () => {
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(
    changes(3, [res('res1'), res('res2'), res('res3')], { full: true }),
  );
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  await listenResources('resource1', {}, callbackSpy);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledWith([res('res1'), res('res2'), res('res3')]));

  // res2 is updated, res3 is deleted, res4 is added
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(
    changes(6, [res('res2', '2'), res('res4')], { deleted: ['uid-res3'] }),
  );
  fireUpdate('resource1');
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenLastCalledWith([res('res1'), res('res2', '2'), res('res4')]));
  expect(window.kubernetesGetResourcesChanges).toHaveBeenLastCalledWith('ctx1', 'resource1', {
    epoch: 'epoch1',
    generation: 3,
  });

  // the next request is done since the new version
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(changes(6, []));
  fireUpdate('resource1');
  await vi.waitFor(() =>
    expect(window.kubernetesGetResourcesChanges).toHaveBeenLastCalledWith('ctx1', 'resource1', {
      epoch: 'epoch1',
      generation: 6,
    }),
  );
});

test('unchanged objects keep their identity', async () => {
  const res1 = res('res1');
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(changes(1, [res1], { full: true }));
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  await listenResources('resource1', {}, callbackSpy);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledOnce());

  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(changes(2, [res('res2')]));
  fireUpdate('resource1');
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledTimes(2));
  expect(callbackSpy.mock.calls[1]![0][0]).toBe(res1);
});

test('the callback is not called when nothing changed', async () => {
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(changes(1, [res('res1')], { full: true }));
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  await listenResources('resource1', {}, callbackSpy);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledOnce());

  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(changes(1, []));
  fireUpdate('resource1');
  await vi.waitFor(() => expect(window.kubernetesGetResourcesChanges).toHaveBeenCalledTimes(2));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(callbackSpy).toHaveBeenCalledOnce();
});

test('a full response replaces all the known resources', async () => {
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(
    changes(2, [res('res1'), res('res2')], { full: true }),
  );
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  await listenResources('resource1', {}, callbackSpy);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledOnce());

  // the informer has been restarted: new epoch
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(
    changes(1, [res('res3')], { full: true, epoch: 'epoch2' }),
  );
  fireUpdate('resource1');
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenLastCalledWith([res('res3')]));
});

test('filtered resources', async () => {
  const searchTermStore = writable<string>('');
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValue(
    changes(2, [res('res1'), res('res2')], { full: true }),
  );
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();

  await listenResources('resource1', { searchTermStore }, callbackSpy);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledWith([res('res1'), res('res2')]));

  searchTermStore.set('notfound');
  expect(callbackSpy).toHaveBeenLastCalledWith([]);

  searchTermStore.set('res1');
  expect(callbackSpy).toHaveBeenLastCalledWith([res('res1')]);

  // changing the search term does not fetch the resources again
  expect(window.kubernetesGetResourcesChanges).toHaveBeenCalledOnce();
});

test('updated resources with filter', async () => {
  const searchTermStore = writable<string>('res1');
  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(
    changes(2, [res('res1'), res('res2')], { full: true }),
  );
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  await listenResources('resource1', { searchTermStore }, callbackSpy);
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledWith([res('res1')]));

  vi.mocked(window.kubernetesGetResourcesChanges).mockResolvedValueOnce(changes(3, [res('res1b')]));
  fireUpdate('resource1');
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenLastCalledWith([res('res1'), res('res1b')]));
});

test('updates received while fetching are grouped in a single fetch', async () => {
  const resolvers: ((value: KubernetesResourcesChanges) => void)[] = [];
  vi.mocked(window.kubernetesGetResourcesChanges).mockImplementation(async () => {
    return new Promise(resolve => resolvers.push(resolve));
  });
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();

  const listener = await listenResources('resource2', {}, callbackSpy);
  expect(window.kubernetesGetResourcesChanges).toHaveBeenCalledTimes(1);

  // a burst of updates while the first fetch is running
  for (let i = 0; i < 100; i++) {
    fireUpdate('resource2');
  }
  expect(window.kubernetesGetResourcesChanges).toHaveBeenCalledTimes(1);

  resolvers[0]!(changes(1, [res('res1')], { full: true }));
  // a single fetch is done for the burst of updates
  await vi.waitFor(() => expect(window.kubernetesGetResourcesChanges).toHaveBeenCalledTimes(2));
  expect(callbackSpy).toHaveBeenCalledWith([res('res1')]);

  resolvers[1]!(changes(2, [res('res2')]));
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenLastCalledWith([res('res1'), res('res2')]));
  expect(window.kubernetesGetResourcesChanges).toHaveBeenCalledTimes(2);
  listener?.dispose();
});

test('resources fetched for a previous context are ignored', async () => {
  const contextsStore = writable([context('ctx1', true)]);
  vi.mocked(contexts).kubernetesContexts = contextsStore;
  const resolvers: ((value: KubernetesResourcesChanges) => void)[] = [];
  vi.mocked(window.kubernetesGetResourcesChanges).mockImplementation(async () => {
    return new Promise(resolve => resolvers.push(resolve));
  });
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();

  const listener = await listenResources('resource4', {}, callbackSpy);
  // the context changes while fetching the resources of ctx1
  contextsStore.set([context('ctx1', false), context('ctx2', true)]);

  resolvers[0]!(changes(1, [res('res-ctx1')], { full: true }));
  // the resources of the new context are fetched from scratch
  await vi.waitFor(() =>
    expect(window.kubernetesGetResourcesChanges).toHaveBeenLastCalledWith('ctx2', 'resource4', undefined),
  );
  expect(callbackSpy).not.toHaveBeenCalled();

  resolvers[1]!(changes(1, [res('res-ctx2')], { full: true, contextName: 'ctx2' }));
  await vi.waitFor(() => expect(callbackSpy).toHaveBeenCalledWith([res('res-ctx2')]));
  listener?.dispose();
});

test('no current context', async () => {
  vi.mocked(contexts).kubernetesContexts = writable([context('ctx1', false)]);
  const callbackSpy: Mock<(resoures: KubernetesObject[]) => void> = vi.fn();
  await listenResources('resource1', {}, callbackSpy);
  fireUpdate('resource1');
  expect(window.kubernetesGetResourcesChanges).not.toHaveBeenCalled();
  expect(callbackSpy).not.toHaveBeenCalled();
});
