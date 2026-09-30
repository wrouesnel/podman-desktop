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

import { randomUUID } from 'node:crypto';

import type { KubernetesObject } from '@kubernetes/client-node';
import type { KubernetesResourcesVersion } from '@podman-desktop/core-api';
import { getKubernetesObjectKey } from '@podman-desktop/core-api';

// the maximum number of deleted objects remembered, before forgetting them
const DEFAULT_MAX_DELETED = 1000;

interface Change {
  generation: number;
  // undefined when the object has been deleted
  object?: KubernetesObject;
}

export interface TrackedChanges {
  items: KubernetesObject[];
  deleted: string[];
}

// ResourceChangesTracker records the changes of a set of resources, to be able to return
// the changes since a given version (epoch and generation).
//
// The last change of each object is recorded (with a reference to the latest version of the object),
// the deleted objects are remembered until `maxDeleted` deleted objects are recorded; they are then forgotten,
// and the changes since a version older than this moment cannot be computed anymore.
export class ResourceChangesTracker {
  readonly epoch: string = randomUUID();
  #generation = 0;
  // the changes since a generation older than this one cannot be computed
  #floor = 0;
  #changes = new Map<string, Change>();
  #deletedCount = 0;
  #maxDeleted: number;

  constructor(options?: { maxDeleted?: number }) {
    this.#maxDeleted = options?.maxDeleted ?? DEFAULT_MAX_DELETED;
  }

  get generation(): number {
    return this.#generation;
  }

  get version(): KubernetesResourcesVersion {
    return { epoch: this.epoch, generation: this.#generation };
  }

  upsert(object: KubernetesObject): void {
    const key = getKubernetesObjectKey(object);
    const previous = this.#changes.get(key);
    if (previous && !previous.object) {
      this.#deletedCount--;
    }
    this.#changes.set(key, { generation: ++this.#generation, object });
  }

  delete(object: KubernetesObject): void {
    const key = getKubernetesObjectKey(object);
    const previous = this.#changes.get(key);
    if (!previous || previous.object) {
      this.#deletedCount++;
    }
    this.#changes.set(key, { generation: ++this.#generation });
    if (this.#deletedCount > this.#maxDeleted) {
      this.forgetDeleted();
    }
  }

  // getChangesSince returns the changes since the given version,
  // or undefined if they cannot be computed (and all the resources must be returned instead)
  getChangesSince(since: KubernetesResourcesVersion | undefined): TrackedChanges | undefined {
    if (since?.epoch !== this.epoch || since.generation < this.#floor || since.generation > this.#generation) {
      return undefined;
    }
    const result: TrackedChanges = { items: [], deleted: [] };
    if (since.generation === this.#generation) {
      return result;
    }
    for (const [key, change] of this.#changes) {
      if (change.generation <= since.generation) {
        continue;
      }
      if (change.object) {
        result.items.push(change.object);
      } else {
        result.deleted.push(key);
      }
    }
    return result;
  }

  private forgetDeleted(): void {
    for (const [key, change] of this.#changes) {
      if (!change.object) {
        this.#changes.delete(key);
      }
    }
    this.#deletedCount = 0;
    this.#floor = this.#generation;
  }
}
