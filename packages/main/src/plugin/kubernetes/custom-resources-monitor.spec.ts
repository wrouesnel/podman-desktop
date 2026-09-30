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

import type { CustomObjectsApi, V1CustomResourceDefinition } from '@kubernetes/client-node';
import { KubeConfig } from '@kubernetes/client-node';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { CustomResourcesMonitor } from './custom-resources-monitor.js';
import { KubeConfigSingleContext } from './kubeconfig-single-context.js';

const listNamespacedCustomObject = vi.fn();
const listClusterCustomObject = vi.fn();
const onInstantiated = vi.fn();
const onRemoved = vi.fn();

let kubeconfig: KubeConfigSingleContext;
let monitor: CustomResourcesMonitor;

function buildCRD(plural: string, options?: { scope?: string; version?: string }): V1CustomResourceDefinition {
  return {
    metadata: { name: `${plural}.example.com` },
    spec: {
      group: 'example.com',
      names: { kind: plural, plural },
      scope: options?.scope ?? 'Namespaced',
      versions: [{ name: options?.version ?? 'v1', served: true, storage: true }],
    },
    status: {
      acceptedNames: { kind: plural, plural },
      storedVersions: [options?.version ?? 'v1'],
      conditions: [{ type: 'Established', status: 'True' }],
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  const config = new KubeConfig();
  config.loadFromOptions({
    clusters: [{ name: 'cluster1', server: 'https://server1' }],
    users: [{ name: 'user1' }],
    contexts: [{ name: 'context1', cluster: 'cluster1', user: 'user1', namespace: 'ns1' }],
    currentContext: 'context1',
  });
  kubeconfig = new KubeConfigSingleContext(config, config.contexts[0]!);
  vi.spyOn(KubeConfig.prototype, 'makeApiClient').mockReturnValue({
    listNamespacedCustomObject,
    listClusterCustomObject,
  } as unknown as CustomObjectsApi);
  listNamespacedCustomObject.mockResolvedValue({ items: [] });
  listClusterCustomObject.mockResolvedValue({ items: [] });
  monitor = new CustomResourcesMonitor({ kubeconfig, onInstantiated, onRemoved, probeIntervalMs: 1000 });
});

afterEach(() => {
  monitor.dispose();
  vi.useRealTimers();
});

test('new types are probed and reported when instantiated', async () => {
  listNamespacedCustomObject.mockResolvedValue({ items: [{}] });
  monitor.update([buildCRD('widgets'), buildCRD('gadgets', { scope: 'Cluster' })]);

  await vi.waitFor(() => expect(onInstantiated).toHaveBeenCalledOnce());
  expect(listNamespacedCustomObject).toHaveBeenCalledWith({
    group: 'example.com',
    version: 'v1',
    namespace: 'ns1',
    plural: 'widgets',
    limit: 1,
  });
  expect(listClusterCustomObject).toHaveBeenCalledWith({
    group: 'example.com',
    version: 'v1',
    plural: 'gadgets',
    limit: 1,
  });
  expect(onInstantiated).toHaveBeenCalledWith(
    expect.objectContaining({ resource: 'widgets.example.com', namespaced: true }),
  );
});

test('types without instances are probed again periodically', async () => {
  monitor.start();
  monitor.update([buildCRD('widgets')]);
  await vi.waitFor(() => expect(listNamespacedCustomObject).toHaveBeenCalledOnce());
  expect(onInstantiated).not.toHaveBeenCalled();

  listNamespacedCustomObject.mockResolvedValue({ items: [{}] });
  await vi.advanceTimersByTimeAsync(1000);
  await vi.waitFor(() => expect(onInstantiated).toHaveBeenCalledOnce());

  // instantiated types are not probed anymore
  await vi.advanceTimersByTimeAsync(5000);
  expect(listNamespacedCustomObject).toHaveBeenCalledTimes(2);
});

test('probe errors are ignored', async () => {
  listNamespacedCustomObject.mockRejectedValue(new Error('forbidden'));
  monitor.update([buildCRD('widgets')]);
  await vi.waitFor(() => expect(listNamespacedCustomObject).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(0);
  expect(onInstantiated).not.toHaveBeenCalled();
});

test('the number of concurrent probes is limited', async () => {
  const resolvers: (() => void)[] = [];
  // each probe waits for its own resolver
  listNamespacedCustomObject.mockImplementation(async () => {
    await new Promise<void>(resolve => resolvers.push(resolve));
    return { items: [] };
  });
  monitor.update(Array.from({ length: 10 }, (_, i) => buildCRD(`type${i}`)));
  expect(listNamespacedCustomObject).toHaveBeenCalledTimes(4);

  resolvers.shift()?.();
  await vi.waitFor(() => expect(listNamespacedCustomObject).toHaveBeenCalledTimes(5));
});

test('a type updated multiple times is probed once', async () => {
  monitor.update([buildCRD('widgets')]);
  monitor.update([buildCRD('widgets')]);
  await vi.advanceTimersByTimeAsync(0);
  expect(listNamespacedCustomObject).toHaveBeenCalledOnce();
});

test('removed and changed instantiated types are reported', async () => {
  listNamespacedCustomObject.mockResolvedValue({ items: [{}] });
  monitor.update([buildCRD('widgets'), buildCRD('gadgets')]);
  await vi.waitFor(() => expect(onInstantiated).toHaveBeenCalledTimes(2));

  // gadgets is removed, widgets changes version
  monitor.update([buildCRD('widgets', { version: 'v2' })]);
  expect(onRemoved).toHaveBeenCalledWith('gadgets.example.com');
  expect(onRemoved).toHaveBeenCalledWith('widgets.example.com');

  // the new version is probed and reported
  await vi.waitFor(() => expect(onInstantiated).toHaveBeenCalledTimes(3));
  expect(onInstantiated).toHaveBeenLastCalledWith(expect.objectContaining({ version: 'v2' }));
});

test('removed types not instantiated are not reported', async () => {
  monitor.update([buildCRD('widgets')]);
  await vi.advanceTimersByTimeAsync(0);
  monitor.update([]);
  expect(onRemoved).not.toHaveBeenCalled();
});

test('a type removed during the probe is not reported', async () => {
  let resolve: (value: unknown) => void = () => {};
  listNamespacedCustomObject.mockReturnValue(new Promise(r => (resolve = r)));
  monitor.update([buildCRD('widgets')]);
  monitor.update([]);
  resolve({ items: [{}] });
  await vi.advanceTimersByTimeAsync(0);
  expect(onInstantiated).not.toHaveBeenCalled();
});

test('nothing is reported after dispose', async () => {
  let resolve: (value: unknown) => void = () => {};
  listNamespacedCustomObject.mockReturnValue(new Promise(r => (resolve = r)));
  monitor.start();
  monitor.update([buildCRD('widgets')]);
  monitor.dispose();
  resolve({ items: [{}] });
  await vi.advanceTimersByTimeAsync(5000);
  expect(onInstantiated).not.toHaveBeenCalled();
  expect(listNamespacedCustomObject).toHaveBeenCalledOnce();
});
