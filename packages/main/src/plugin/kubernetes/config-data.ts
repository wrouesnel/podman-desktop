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

import type { V1ConfigMap, V1Secret } from '@kubernetes/client-node';

// the maximum size of a ConfigMap or Secret (etcd limit)
export const MAX_CONFIG_DATA_SIZE = 1024 * 1024;

// decodes UTF-8 text, undefined when the bytes are not valid UTF-8
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function checkResourceVersion(
  resource: V1ConfigMap | V1Secret,
  kind: string,
  expectedResourceVersion?: string,
): void {
  if (resource.immutable) {
    throw new Error(`the ${kind} ${resource.metadata?.name} is immutable`);
  }
  if (expectedResourceVersion && resource.metadata?.resourceVersion !== expectedResourceVersion) {
    throw new Error(`the ${kind} ${resource.metadata?.name} has been modified since it was opened, reload it`);
  }
}

/**
 * Sets the value of a key of a ConfigMap: in `data` when it is UTF-8 text, in `binaryData` otherwise
 */
export function setConfigMapKey(configMap: V1ConfigMap, key: string, base64Value: string): V1ConfigMap {
  const text = decodeUtf8(Buffer.from(base64Value, 'base64'));
  const data = { ...configMap.data };
  const binaryData = { ...configMap.binaryData };
  delete data[key];
  delete binaryData[key];
  if (text === undefined) {
    binaryData[key] = base64Value;
  } else {
    data[key] = text;
  }
  return {
    ...configMap,
    data: Object.keys(data).length ? data : undefined,
    binaryData: Object.keys(binaryData).length ? binaryData : undefined,
  };
}

/**
 * Sets the value of a key of a Secret
 */
export function setSecretKey(secret: V1Secret, key: string, base64Value: string): V1Secret {
  const stringData = { ...secret.stringData };
  delete stringData[key];
  return {
    ...secret,
    data: { ...secret.data, [key]: base64Value },
    stringData: Object.keys(stringData).length ? stringData : undefined,
  };
}
