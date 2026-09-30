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

// A minimal JSONPath evaluator, supporting the expressions used by the additionalPrinterColumns of CRDs
// (https://kubernetes.io/docs/reference/kubectl/jsonpath/):
//   .field, ['field'], [index], [*], [?(@.path == value)], [?(@.path != value)], [?(@.path)]

type Segment =
  | { type: 'key'; key: string }
  | { type: 'index'; index: number }
  | { type: 'wildcard' }
  | { type: 'filter'; path: Segment[]; op?: '==' | '!='; value?: unknown };

const IDENTIFIER = /^[\w-]+/;

function parseLiteral(literal: string): unknown {
  const trimmed = literal.trim();
  const quoted = /^'(.*)'$/.exec(trimmed) ?? /^"(.*)"$/.exec(trimmed);
  if (quoted) {
    return quoted[1];
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function parseFilter(expression: string): Segment {
  const match = /^@(.*?)\s*(==|!=)\s*(.*)$/.exec(expression.trim());
  if (match) {
    return {
      type: 'filter',
      path: parseJsonPath(match[1] ?? ''),
      op: match[2] as '==' | '!=',
      value: parseLiteral(match[3] ?? ''),
    };
  }
  return { type: 'filter', path: parseJsonPath(expression.trim().replace(/^@/, '')) };
}

// returns the index of the closing bracket matching the opening bracket at `start`, ignoring brackets in quotes
function findClosingBracket(path: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = start; i < path.length; i++) {
    const char = path[i];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
    } else if (char === '"' || char === `'`) {
      quote = char;
    } else if (char === '[') {
      depth++;
    } else if (char === ']') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error(`unbalanced brackets in JSONPath ${path}`);
}

export function parseJsonPath(expression: string): Segment[] {
  // accept the kubectl template form {.spec.field} and a leading $
  const path = expression
    .trim()
    .replace(/^\{(.*)\}$/, '$1')
    .replace(/^\$/, '');
  const segments: Segment[] = [];
  let i = 0;
  while (i < path.length) {
    const char = path[i];
    if (char === '.') {
      const identifier = IDENTIFIER.exec(path.slice(i + 1))?.[0];
      if (identifier) {
        segments.push({ type: 'key', key: identifier });
        i += identifier.length + 1;
      } else {
        i++;
      }
    } else if (char === '[') {
      const end = findClosingBracket(path, i);
      const content = path.slice(i + 1, end).trim();
      if (content === '*') {
        segments.push({ type: 'wildcard' });
      } else if (content.startsWith('?(') && content.endsWith(')')) {
        segments.push(parseFilter(content.slice(2, -1)));
      } else if (/^-?\d+$/.test(content)) {
        segments.push({ type: 'index', index: Number(content) });
      } else {
        segments.push({ type: 'key', key: String(parseLiteral(content)) });
      }
      i = end + 1;
    } else {
      const identifier = IDENTIFIER.exec(path.slice(i))?.[0];
      if (!identifier) {
        throw new Error(`unexpected character '${char}' in JSONPath ${expression}`);
      }
      segments.push({ type: 'key', key: identifier });
      i += identifier.length;
    }
  }
  return segments;
}

function evaluateSegments(nodes: unknown[], segments: Segment[]): unknown[] {
  let current = nodes;
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const node of current) {
      if (node === null || typeof node !== 'object') {
        continue;
      }
      switch (segment.type) {
        case 'key': {
          const value = (node as Record<string, unknown>)[segment.key];
          if (value !== undefined) {
            next.push(value);
          }
          break;
        }
        case 'index':
          if (Array.isArray(node)) {
            const value = node.at(segment.index);
            if (value !== undefined) {
              next.push(value);
            }
          }
          break;
        case 'wildcard':
          next.push(...(Array.isArray(node) ? node : Object.values(node)));
          break;
        case 'filter':
          for (const item of Array.isArray(node) ? node : Object.values(node)) {
            const values = evaluateSegments([item], segment.path);
            const matches =
              segment.op === '=='
                ? values.some(value => value === segment.value)
                : segment.op === '!='
                  ? values.every(value => value !== segment.value)
                  : values.length > 0;
            if (matches) {
              next.push(item);
            }
          }
          break;
      }
    }
    current = next;
  }
  return current;
}

// evaluateJsonPath returns all the values matching the JSONPath expression, or an empty array
// if the expression is invalid
export function evaluateJsonPath(object: unknown, expression: string): unknown[] {
  try {
    return evaluateSegments([object], parseJsonPath(expression));
  } catch {
    return [];
  }
}
