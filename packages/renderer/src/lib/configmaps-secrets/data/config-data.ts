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

export type ConfigDataKind = 'ConfigMap' | 'Secret';

export interface ConfigDataKey {
  key: string;
  // the value, base64 encoded
  base64: string;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // by chunks: String.fromCharCode has a limit on its number of arguments
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// decodes UTF-8 text, undefined when the bytes are not valid UTF-8
export function bytesToText(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Does the content look binary: not valid UTF-8, a NUL character, or many control characters
 * (other than tab, line feed, carriage return, form feed, backspace and escape)
 */
export function isBinary(bytes: Uint8Array): boolean {
  const text = bytesToText(bytes);
  if (text === undefined) {
    return true;
  }
  let controls = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) {
      return true;
    }
    if ((code < 32 && ![8, 9, 10, 12, 13, 27].includes(code)) || code === 127) {
      controls++;
    }
  }
  return text.length > 0 && controls / text.length > 0.05;
}

// the keys of a ConfigMap (data and binaryData) or Secret, sorted by name
export function getConfigDataKeys(kind: ConfigDataKind, resource: V1ConfigMap | V1Secret | undefined): ConfigDataKey[] {
  if (!resource) {
    return [];
  }
  const keys: ConfigDataKey[] = [];
  if (kind === 'ConfigMap') {
    const configMap = resource as V1ConfigMap;
    for (const [key, value] of Object.entries(configMap.data ?? {})) {
      keys.push({ key, base64: bytesToBase64(textToBytes(value)) });
    }
    for (const [key, value] of Object.entries(configMap.binaryData ?? {})) {
      keys.push({ key, base64: value });
    }
  } else {
    for (const [key, value] of Object.entries((resource as V1Secret).data ?? {})) {
      keys.push({ key, base64: value });
    }
  }
  return keys.sort((a, b) => a.key.localeCompare(b.key));
}

// the language of the text editor, from the extension of the key
export function getLanguage(key: string): string {
  const extension = key.includes('.') ? key.substring(key.lastIndexOf('.') + 1).toLowerCase() : '';
  const languages: Record<string, string> = {
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'shell',
    xml: 'xml',
    html: 'html',
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    properties: 'ini',
    ini: 'ini',
    conf: 'ini',
    toml: 'ini',
    md: 'markdown',
    sql: 'sql',
    css: 'css',
  };
  return languages[extension] ?? 'plaintext';
}

export function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 / 1024).toFixed(1)} MiB`;
}

// the size of base64 encoded data
export function getBase64Size(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
