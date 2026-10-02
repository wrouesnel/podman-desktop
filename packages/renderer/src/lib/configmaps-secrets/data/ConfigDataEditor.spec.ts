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

import '@testing-library/jest-dom/vitest';

import type { V1ConfigMap, V1Secret } from '@kubernetes/client-node';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import ConfigDataEditor from './ConfigDataEditor.svelte';

vi.mock(import('/@/lib/editor/MonacoEditor.svelte'), async () => {
  const stub = await import('./TestMonacoStub.svelte');
  return { default: stub.default } as never;
});

const b64 = (value: string | number[]): string =>
  btoa(typeof value === 'string' ? value : String.fromCharCode(...value));

function secret(data: Record<string, string>, resourceVersion = '1', immutable = false): V1Secret {
  return { metadata: { name: 's1', namespace: 'ns1', resourceVersion }, data, immutable };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.kubernetesUpdateSecretKey).mockImplementation(async (_n, _ns, key, value) =>
    secret({ [key]: value }, '2'),
  );
  vi.mocked(window.kubernetesUpdateConfigMapKey).mockResolvedValue({ metadata: { resourceVersion: '2' } });
});

function textEditor(): HTMLTextAreaElement {
  return screen.getByLabelText('Text editor') as HTMLTextAreaElement;
}

test('shows the decoded value of a Secret key as text, and saves it encoded', async () => {
  render(ConfigDataEditor, { kind: 'Secret', resource: secret({ 'config.json': b64('{"a":1}'), token: b64('t') }) });

  expect(screen.getByRole('button', { name: 'config.json' })).toHaveAttribute('aria-current', 'true');
  expect(textEditor()).toHaveValue('{"a":1}');
  expect(textEditor()).toHaveAttribute('data-language', 'json');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await fireEvent.input(textEditor(), { target: { value: '{"a":2}' } });
  expect(screen.getByLabelText('Selected key')).toHaveTextContent('config.json (modified)');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(window.kubernetesUpdateSecretKey).toHaveBeenCalledWith('s1', 'ns1', 'config.json', b64('{"a":2}'), '1');
  await screen.findByText('config.json saved');
  expect(screen.getByLabelText('Selected key')).toHaveTextContent(/^config.json$/);
});

test('a binary value is opened in the hex editor', async () => {
  render(ConfigDataEditor, { kind: 'Secret', resource: secret({ 'key.der': b64([0x30, 0x82, 0, 0xff]) }) });

  expect(screen.getByLabelText('Hex editor')).toBeInTheDocument();
  expect(screen.queryByLabelText('Text editor')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Text' })).toBeDisabled();

  await userEvent.click(screen.getByLabelText('Byte 4'));
  await userEvent.keyboard('0a');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(window.kubernetesUpdateSecretKey).toHaveBeenCalledWith(
    's1',
    'ns1',
    'key.der',
    b64([0x30, 0x82, 0, 0xff, 0x0a]),
    '1',
  );
});

test('a text value can be edited in hexadecimal', async () => {
  render(ConfigDataEditor, { kind: 'Secret', resource: secret({ a: b64('AB') }) });

  await userEvent.click(screen.getByRole('button', { name: 'Hex' }));
  expect(screen.getByLabelText('Byte 0')).toHaveTextContent('41');
  await userEvent.click(screen.getByRole('button', { name: 'Text' }));
  expect(textEditor()).toHaveValue('AB');
});

test('ConfigMap keys (data and binaryData) are listed and saved', async () => {
  const configMap: V1ConfigMap = {
    metadata: { name: 'cm1', namespace: 'ns1', resourceVersion: '5' },
    data: { 'b.yaml': 'x: 1' },
    binaryData: { 'a.bin': b64([0, 1]) },
  };
  render(ConfigDataEditor, { kind: 'ConfigMap', resource: configMap });

  expect(screen.getByLabelText('Hex editor')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'b.yaml' }));
  expect(textEditor()).toHaveValue('x: 1');
  await fireEvent.input(textEditor(), { target: { value: 'x: 2' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(window.kubernetesUpdateConfigMapKey).toHaveBeenCalledWith('cm1', 'ns1', 'b.yaml', b64('x: 2'), '5');
});

test('switching key with changes asks to discard them', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 'Cancel' } as never);
  render(ConfigDataEditor, { kind: 'Secret', resource: secret({ a: b64('1'), b: b64('2') }) });

  await fireEvent.input(textEditor(), { target: { value: 'changed' } });
  await userEvent.click(screen.getByRole('button', { name: 'b' }));
  expect(window.showMessageBox).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-current', 'true');

  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 'Discard' } as never);
  await userEvent.click(screen.getByRole('button', { name: 'b' }));
  await vi.waitFor(() => expect(textEditor()).toHaveValue('2'));
});

test('the value is replaced by the content of a file selected or dropped', async () => {
  vi.mocked(window.openDialog).mockResolvedValue(['/home/user/cert.pem']);
  vi.mocked(window.kubernetesReadConfigDataFile).mockResolvedValueOnce(b64('-----BEGIN-----'));
  render(ConfigDataEditor, { kind: 'Secret', resource: secret({ 'tls.crt': b64('old') }) });

  await userEvent.click(screen.getByRole('button', { name: 'Replace from file' }));
  await vi.waitFor(() => expect(textEditor()).toHaveValue('-----BEGIN-----'));
  expect(window.kubernetesReadConfigDataFile).toHaveBeenCalledWith('/home/user/cert.pem');
  expect(screen.getByRole('status')).toHaveTextContent('replaced by the content of cert.pem: save to apply');

  // a binary file dropped
  vi.mocked(window.getPathForFile).mockReturnValue('/home/user/image.png');
  vi.mocked(window.kubernetesReadConfigDataFile).mockResolvedValueOnce(b64([0x89, 0x50, 0x4e, 0x47, 0, 0]));
  const region = screen.getByRole('region', { name: 'Value of tls.crt' });
  const dataTransfer = { types: ['Files'], files: [new File([''], 'image.png')] };
  await fireEvent.dragOver(region, { dataTransfer });
  expect(screen.getByText('Drop a file to replace the value of tls.crt')).toBeInTheDocument();
  await fireEvent.drop(region, { dataTransfer });

  await screen.findByLabelText('Hex editor');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(window.kubernetesUpdateSecretKey).toHaveBeenCalledWith(
    's1',
    'ns1',
    'tls.crt',
    b64([0x89, 0x50, 0x4e, 0x47, 0, 0]),
    '1',
  );
});

test('errors reading the file and saving are displayed', async () => {
  vi.mocked(window.openDialog).mockResolvedValue(['/big']);
  vi.mocked(window.kubernetesReadConfigDataFile).mockRejectedValue(new Error('big is too large'));
  vi.mocked(window.kubernetesUpdateSecretKey).mockRejectedValue(new Error('has been modified since it was opened'));
  render(ConfigDataEditor, { kind: 'Secret', resource: secret({ a: b64('1') }) });

  await userEvent.click(screen.getByRole('button', { name: 'Replace from file' }));
  await screen.findByText('big is too large');

  await fireEvent.input(textEditor(), { target: { value: '2' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('has been modified since it was opened');
});

test('a value modified on the cluster is reloaded, or reported when it was modified locally', async () => {
  const { rerender } = render(ConfigDataEditor, { kind: 'Secret', resource: secret({ a: b64('1') }) });

  await rerender({ kind: 'Secret', resource: secret({ a: b64('2') }, '2') });
  expect(textEditor()).toHaveValue('2');

  await fireEvent.input(textEditor(), { target: { value: 'local' } });
  await rerender({ kind: 'Secret', resource: secret({ a: b64('3') }, '3') });
  expect(screen.getByRole('alert')).toHaveTextContent('The value has been modified on the cluster');
  // the local changes are kept
  expect(screen.getByLabelText('Selected key')).toHaveTextContent('a (modified)');

  await userEvent.click(screen.getByRole('button', { name: 'Reload (discard your changes)' }));
  expect(textEditor()).toHaveValue('3');
});

test('an immutable Secret can not be modified', async () => {
  render(ConfigDataEditor, { kind: 'Secret', resource: secret({ a: b64('1') }, '1', true) });

  expect(screen.getByText(/is immutable/)).toBeInTheDocument();
  expect(textEditor()).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'Replace from file' })).toBeDisabled();
  const region = screen.getByRole('region', { name: 'Value of a' });
  await fireEvent.dragOver(region, { dataTransfer: { types: ['Files'], files: [] } });
  expect(screen.queryByText(/Drop a file/)).not.toBeInTheDocument();
});

test('a resource without keys', () => {
  render(ConfigDataEditor, { kind: 'ConfigMap', resource: { metadata: { name: 'empty' } } });
  expect(screen.getByText('The ConfigMap empty has no keys')).toBeInTheDocument();
});
