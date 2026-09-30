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
import { expect, test } from 'vitest';

import { ResourceChangesTracker } from './resource-changes-tracker.js';

function obj(name: string, resourceVersion = '1'): KubernetesObject {
  return { metadata: { name, namespace: 'ns1', uid: `uid-${name}`, resourceVersion } };
}

test('changes since the initial version', () => {
  const tracker = new ResourceChangesTracker();
  const initial = tracker.version;
  expect(initial.generation).toEqual(0);
  tracker.upsert(obj('a'));
  tracker.upsert(obj('b'));
  expect(tracker.getChangesSince(initial)).toEqual({ items: [obj('a'), obj('b')], deleted: [] });
});

test('only the last version of an object changed several times is returned', () => {
  const tracker = new ResourceChangesTracker();
  tracker.upsert(obj('a'));
  tracker.upsert(obj('b'));
  const version = tracker.version;
  tracker.upsert(obj('a', '2'));
  tracker.upsert(obj('a', '3'));
  expect(tracker.getChangesSince(version)).toEqual({ items: [obj('a', '3')], deleted: [] });
});

test('deleted objects', () => {
  const tracker = new ResourceChangesTracker();
  tracker.upsert(obj('a'));
  tracker.upsert(obj('b'));
  const version = tracker.version;
  tracker.delete(obj('a'));
  expect(tracker.getChangesSince(version)).toEqual({ items: [], deleted: ['uid-a'] });

  // re-created after deletion
  tracker.upsert(obj('a', '5'));
  expect(tracker.getChangesSince(version)).toEqual({ items: [obj('a', '5')], deleted: [] });
});

test('no changes since the current version', () => {
  const tracker = new ResourceChangesTracker();
  tracker.upsert(obj('a'));
  expect(tracker.getChangesSince(tracker.version)).toEqual({ items: [], deleted: [] });
});

test('changes cannot be computed without version, for another epoch or for a future generation', () => {
  const tracker = new ResourceChangesTracker();
  tracker.upsert(obj('a'));
  expect(tracker.getChangesSince(undefined)).toBeUndefined();
  expect(tracker.getChangesSince({ epoch: 'other', generation: 0 })).toBeUndefined();
  expect(tracker.getChangesSince({ epoch: tracker.epoch, generation: 5 })).toBeUndefined();
  expect(new ResourceChangesTracker().epoch).not.toEqual(tracker.epoch);
});

test('deleted objects are forgotten when too many are recorded', () => {
  const tracker = new ResourceChangesTracker({ maxDeleted: 2 });
  for (const name of ['a', 'b', 'c', 'd']) {
    tracker.upsert(obj(name));
  }
  const version = tracker.version;
  tracker.delete(obj('a'));
  tracker.delete(obj('b'));
  expect(tracker.getChangesSince(version)).toEqual({ items: [], deleted: ['uid-a', 'uid-b'] });

  // re-creating a deleted object does not count it as deleted anymore
  tracker.upsert(obj('b', '2'));
  tracker.delete(obj('c'));
  expect(tracker.getChangesSince(version)).toEqual({ items: [obj('b', '2')], deleted: ['uid-a', 'uid-c'] });

  // third deleted object: the deleted objects are forgotten
  tracker.delete(obj('d'));
  expect(tracker.getChangesSince(version)).toBeUndefined();
  const afterForget = tracker.version;
  tracker.upsert(obj('e'));
  expect(tracker.getChangesSince(afterForget)).toEqual({ items: [obj('e')], deleted: [] });
});
