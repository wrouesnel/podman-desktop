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

import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import HexEditor from './HexEditor.svelte';

function byteText(index: number): string {
  return screen.getByLabelText(`Byte ${index}`).textContent?.trim() ?? '';
}

test('displays the bytes in hexadecimal and as text', () => {
  render(HexEditor, { bytes: new Uint8Array([0x41, 0x00, 0xff]) });
  expect(byteText(0)).toBe('41');
  expect(byteText(1)).toBe('00');
  expect(byteText(2)).toBe('FF');
  // the position after the last byte
  expect(byteText(3)).toBe('__');
  expect(screen.getByText('3 bytes')).toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(1);
});

test('typing hexadecimal digits overwrites and appends bytes', async () => {
  const onChange = vi.fn();
  render(HexEditor, { bytes: new Uint8Array([0x41, 0x42]), onChange });

  await userEvent.click(screen.getByLabelText('Byte 1'));
  await userEvent.keyboard('7a');
  expect(onChange).toHaveBeenLastCalledWith(new Uint8Array([0x41, 0x7a]));
  // the cursor is after the last byte: appends
  await userEvent.keyboard('0F');
  expect(onChange).toHaveBeenLastCalledWith(new Uint8Array([0x41, 0x7a, 0x0f]));
  expect(screen.getByLabelText('Cursor position')).toHaveTextContent('(3)');
});

test('Backspace and Delete remove bytes, characters are typed in the text column', async () => {
  const onChange = vi.fn();
  render(HexEditor, { bytes: new Uint8Array([1, 2, 3, 4]), onChange });

  await userEvent.click(screen.getByLabelText('Byte 2'));
  await userEvent.keyboard('{Backspace}');
  expect(onChange).toHaveBeenLastCalledWith(new Uint8Array([1, 3, 4]));
  await userEvent.keyboard('{Delete}');
  expect(onChange).toHaveBeenLastCalledWith(new Uint8Array([1, 4]));

  await userEvent.keyboard('{Tab}hi');
  expect(onChange).toHaveBeenLastCalledWith(new Uint8Array([1, 0x68, 0x69]));
});

test('the arrows move the cursor, a read only editor is not modified', async () => {
  const onChange = vi.fn();
  render(HexEditor, { bytes: new Uint8Array(40), readOnly: true, onChange });

  await userEvent.click(screen.getByLabelText('Byte 0'));
  await userEvent.keyboard('{ArrowDown}{ArrowRight}{ArrowRight}');
  expect(screen.getByLabelText('Cursor position')).toHaveTextContent('(18)');
  await userEvent.keyboard('{End}');
  expect(screen.getByLabelText('Cursor position')).toHaveTextContent('(31)');
  await userEvent.keyboard('ff{Backspace}');
  expect(onChange).not.toHaveBeenCalled();
});

test('the bytes given are not modified', async () => {
  const bytes = new Uint8Array([1, 2]);
  render(HexEditor, { bytes });
  await userEvent.click(screen.getByLabelText('Byte 0'));
  await userEvent.keyboard('ff');
  expect(bytes).toEqual(new Uint8Array([1, 2]));
});
