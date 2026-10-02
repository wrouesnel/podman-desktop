/**********************************************************************
 * Copyright (C) 2024-2025 Red Hat, Inc.
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

import type { PvcBrowserSessionInfo, PvcFileEntry } from '@podman-desktop/core-api';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { compareByName, describeAccess, getDragKey, getParentPath, getPathSegments } from './pvc-file-browser';
import PVCFileBrowser from './PVCFileBrowser.svelte';

const session: PvcBrowserSessionInfo = {
  sessionId: 's1',
  namespace: 'ns1',
  pvcName: 'data',
  mode: 'helper',
  podName: 'pd-pvc-browser-abcdef',
  containerName: 'browser',
  root: '/pvc',
  readOnly: false,
  helperImage: 'busybox:1.37',
};

function entry(name: string, type: PvcFileEntry['type'], dir = ''): PvcFileEntry {
  return {
    name,
    path: dir ? `${dir}/${name}` : name,
    type,
    size: 2048,
    modified: 1700000000000,
    permissions: type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.kubernetesPvcBrowserOpen).mockResolvedValue(session);
  vi.mocked(window.kubernetesPvcBrowserClose).mockResolvedValue(undefined);
  vi.mocked(window.kubernetesPvcBrowserList).mockImplementation(async (_id: string, dir: string) =>
    dir === '' ? [entry('b.txt', 'file'), entry('dir', 'directory')] : [entry('c.txt', 'file', dir)],
  );
  vi.mocked(window.kubernetesPvcBrowserMkdir).mockResolvedValue(undefined);
  vi.mocked(window.kubernetesPvcBrowserRename).mockResolvedValue(undefined);
  vi.mocked(window.kubernetesPvcBrowserDelete).mockResolvedValue(undefined);
  vi.mocked(window.kubernetesPvcBrowserDownload).mockResolvedValue(undefined);
  vi.mocked(window.kubernetesPvcBrowserUpload).mockResolvedValue(undefined);
  vi.mocked(window.getCancellableTokenSource).mockResolvedValue(7);
  vi.mocked(window.kubernetesPvcBrowserPrepareDragOut).mockResolvedValue([]);
});

async function renderBrowser(): Promise<{ unmount: () => void }> {
  const result = render(PVCFileBrowser, { name: 'data', namespace: 'ns1' });
  await screen.findByRole('row', { name: 'b.txt' });
  return result;
}

describe('helpers', () => {
  test('getPathSegments and getParentPath', () => {
    expect(getPathSegments('')).toEqual([{ name: '/', path: '' }]);
    expect(getPathSegments('a/b')).toEqual([
      { name: '/', path: '' },
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
    ]);
    expect(getParentPath('a/b')).toBe('a');
    expect(getParentPath('a')).toBe('');
  });

  test('compareByName lists the directories first', () => {
    const sorted = [entry('b', 'file'), entry('z', 'directory'), entry('a', 'file')].sort(compareByName);
    expect(sorted.map(item => item.name)).toEqual(['z', 'a', 'b']);
  });

  test('describeAccess and getDragKey', () => {
    expect(describeAccess(session)).toBe('Browsing through the temporary pod pd-pvc-browser-abcdef (busybox:1.37)');
    expect(describeAccess({ ...session, mode: 'pod', podName: 'app', containerName: 'c', root: '/data' })).toBe(
      'Browsing through the pod app (container c, mounted at /data)',
    );
    expect(getDragKey(['b', 'a'])).toBe(getDragKey(['a', 'b']));
  });
});

test('opens the volume, lists the root, and closes the volume when destroyed', async () => {
  const { unmount } = await renderBrowser();

  expect(window.kubernetesPvcBrowserOpen).toHaveBeenCalledWith('ns1', 'data');
  expect(window.kubernetesPvcBrowserList).toHaveBeenCalledWith('s1', '');
  expect(screen.getByLabelText('Volume access')).toHaveTextContent('temporary pod pd-pvc-browser-abcdef');
  // the directories first
  const names = screen.getAllByRole('row').map(row => row.getAttribute('aria-label'));
  expect(names.filter(name => name === 'dir' || name === 'b.txt')).toEqual(['dir', 'b.txt']);

  unmount();
  expect(window.kubernetesPvcBrowserClose).toHaveBeenCalledWith('s1');
});

test('an error opening the volume can be retried', async () => {
  vi.mocked(window.kubernetesPvcBrowserOpen).mockRejectedValueOnce(new Error('ImagePullBackOff'));
  render(PVCFileBrowser, { name: 'data', namespace: 'ns1' });

  await screen.findByText('ImagePullBackOff');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

  await screen.findByRole('row', { name: 'b.txt' });
  expect(window.kubernetesPvcBrowserOpen).toHaveBeenCalledTimes(2);
});

test('navigates into a directory and back', async () => {
  await renderBrowser();

  await userEvent.click(screen.getByRole('row', { name: 'dir' }));
  await screen.findByRole('row', { name: 'c.txt' });
  expect(window.kubernetesPvcBrowserList).toHaveBeenLastCalledWith('s1', 'dir');
  expect(within(screen.getByLabelText('Path')).getByText('dir')).toHaveAttribute('aria-current', 'page');

  await userEvent.click(screen.getByRole('button', { name: 'Parent folder' }));
  await screen.findByRole('row', { name: 'b.txt' });
  expect(window.kubernetesPvcBrowserList).toHaveBeenLastCalledWith('s1', '');
});

test('creates a folder', async () => {
  await renderBrowser();

  await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
  await userEvent.type(screen.getByLabelText('New folder name'), 'new one{Enter}');

  await vi.waitFor(() => expect(window.kubernetesPvcBrowserMkdir).toHaveBeenCalledWith('s1', '', 'new one'));
  await vi.waitFor(() => expect(window.kubernetesPvcBrowserList).toHaveBeenCalledTimes(2));
});

test('renames an entry', async () => {
  await renderBrowser();

  await userEvent.click(screen.getByRole('button', { name: 'Rename b.txt' }));
  const input = screen.getByLabelText('New name of b.txt');
  await userEvent.clear(input);
  await userEvent.type(input, 'renamed.txt{Enter}');

  await vi.waitFor(() => expect(window.kubernetesPvcBrowserRename).toHaveBeenCalledWith('s1', 'b.txt', 'renamed.txt'));
});

test('deletes an entry after confirmation, and reports errors', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 'Delete' } as never);
  vi.mocked(window.kubernetesPvcBrowserDelete).mockRejectedValue(new Error('Permission denied'));
  await renderBrowser();

  await userEvent.click(screen.getByRole('button', { name: 'Delete b.txt' }));

  await vi.waitFor(() => expect(window.kubernetesPvcBrowserDelete).toHaveBeenCalledWith('s1', ['b.txt']));
  await screen.findByText('Permission denied');
});

test('downloads an entry to the selected folder', async () => {
  vi.mocked(window.openDialog).mockResolvedValue(['/home/user/Downloads']);
  await renderBrowser();

  await userEvent.click(screen.getByRole('button', { name: 'Download dir' }));

  await vi.waitFor(() =>
    expect(window.kubernetesPvcBrowserDownload).toHaveBeenCalledWith('s1', ['dir'], '/home/user/Downloads', 7),
  );
});

test('a read only volume can not be modified', async () => {
  vi.mocked(window.kubernetesPvcBrowserOpen).mockResolvedValue({ ...session, readOnly: true });
  await renderBrowser();

  expect(screen.getByText('Read only')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();

  const files = screen.getByRole('region', { name: 'Files' });
  await fireEvent.dragOver(files, { dataTransfer: { types: ['Files'], files: [] } });
  expect(screen.queryByText(/Drop to upload/)).not.toBeInTheDocument();
});

test('files dropped on a directory are uploaded into it', async () => {
  vi.mocked(window.getPathForFile).mockImplementation((file: File) => `/home/user/${file.name}`);
  await renderBrowser();
  const file = new File(['content'], 'local.txt');
  const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };

  const dirRow = screen.getByRole('row', { name: 'dir' });
  await fireEvent.dragOver(dirRow, { dataTransfer });
  expect(screen.getByText('Drop to upload to /dir')).toBeInTheDocument();
  await fireEvent.drop(dirRow, { dataTransfer });

  expect(screen.queryByText(/Drop to upload/)).not.toBeInTheDocument();
  await vi.waitFor(() =>
    expect(window.kubernetesPvcBrowserUpload).toHaveBeenCalledWith('s1', ['/home/user/local.txt'], 'dir', 7),
  );
});

test('files dropped on the list are uploaded to the current directory', async () => {
  vi.mocked(window.getPathForFile).mockReturnValue('/home/user/x');
  await renderBrowser();
  const dataTransfer = { types: ['Files'], files: [new File([''], 'x')] };

  const files = screen.getByRole('region', { name: 'Files' });
  await fireEvent.dragOver(files, { dataTransfer });
  expect(screen.getByText('Drop to upload to /')).toBeInTheDocument();
  await fireEvent.drop(files, { dataTransfer });

  await vi.waitFor(() => expect(window.kubernetesPvcBrowserUpload).toHaveBeenCalledWith('s1', ['/home/user/x'], '', 7));
  // the list is refreshed
  await vi.waitFor(() => expect(window.kubernetesPvcBrowserList).toHaveBeenCalledTimes(2));
});

test('dragging a file out starts a drag of the files downloaded when the pointer is pressed', async () => {
  vi.mocked(window.kubernetesPvcBrowserPrepareDragOut).mockResolvedValue(['/tmp/pd-pvc-1/drag-1/b.txt']);
  await renderBrowser();
  const row = screen.getByRole('row', { name: 'b.txt' });
  expect(row).toHaveAttribute('draggable', 'true');

  await fireEvent.pointerDown(row, { button: 0 });
  expect(window.kubernetesPvcBrowserPrepareDragOut).toHaveBeenCalledWith('s1', ['b.txt']);
  await vi.waitFor(() => expect(window.kubernetesPvcBrowserPrepareDragOut).toHaveReturned());
  await new Promise(resolve => setTimeout(resolve, 0));

  await fireEvent.dragStart(row);
  expect(window.kubernetesPvcBrowserStartDragOut).toHaveBeenCalledWith(['/tmp/pd-pvc-1/drag-1/b.txt']);
  // the files are downloaded once
  await fireEvent.pointerDown(row, { button: 0 });
  expect(window.kubernetesPvcBrowserPrepareDragOut).toHaveBeenCalledTimes(1);

  // dropped back in the list: ignored
  vi.mocked(window.getPathForFile).mockReturnValue('/tmp/pd-pvc-1/drag-1/b.txt');
  const dataTransfer = { types: ['Files'], files: [new File([''], 'b.txt')] };
  await fireEvent.dragOver(row, { dataTransfer });
  await fireEvent.drop(row, { dataTransfer });
  expect(window.kubernetesPvcBrowserUpload).not.toHaveBeenCalled();
});

test('a directory is downloaded when the pointer moves, not when it is clicked', async () => {
  await renderBrowser();
  await userEvent.click(screen.getByRole('row', { name: 'dir' }));
  await screen.findByRole('row', { name: 'c.txt' });
  expect(window.kubernetesPvcBrowserPrepareDragOut).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Parent folder' }));
  const row = await screen.findByRole('row', { name: 'dir' });
  await fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
  await fireEvent.pointerMove(row, { buttons: 1, clientX: 20, clientY: 10 });
  expect(window.kubernetesPvcBrowserPrepareDragOut).toHaveBeenCalledWith('s1', ['dir']);
});

test('a drag started before the files are ready starts when they are, if the button is still pressed', async () => {
  const first = Promise.withResolvers<string[]>();
  const second = Promise.withResolvers<string[]>();
  vi.mocked(window.kubernetesPvcBrowserPrepareDragOut)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await renderBrowser();
  const row = screen.getByRole('row', { name: 'b.txt' });

  await fireEvent.pointerDown(row, { button: 0 });
  await fireEvent.dragStart(row);
  expect(screen.getByText(/keep the button pressed/)).toBeInTheDocument();
  first.resolve(['/tmp/b.txt']);
  await vi.waitFor(() => expect(window.kubernetesPvcBrowserStartDragOut).toHaveBeenCalledWith(['/tmp/b.txt']));
  expect(screen.queryByText(/keep the button pressed/)).not.toBeInTheDocument();

  // released before the files are ready: no drag
  vi.mocked(window.kubernetesPvcBrowserStartDragOut).mockClear();
  await fireEvent.pointerDown(screen.getByRole('row', { name: 'dir' }), { button: 0 });
  await fireEvent.dragStart(screen.getByRole('row', { name: 'dir' }));
  await fireEvent.pointerUp(window);
  second.resolve(['/tmp/dir']);
  await second.promise;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(window.kubernetesPvcBrowserStartDragOut).not.toHaveBeenCalled();
});

test('a selection too large to be dragged shows the error', async () => {
  vi.mocked(window.kubernetesPvcBrowserPrepareDragOut).mockRejectedValue(new Error('too large: use Download'));
  await renderBrowser();
  const row = screen.getByRole('row', { name: 'b.txt' });

  await fireEvent.dragStart(row);

  await screen.findByText('too large: use Download');
  expect(window.kubernetesPvcBrowserStartDragOut).not.toHaveBeenCalled();
});
