<script lang="ts">
import {
  faArrowUp,
  faDownload,
  faFolderPlus,
  faLock,
  faRotateRight,
  faTrash,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import type { PvcBrowserSessionInfo, PvcFileEntry } from '@podman-desktop/core-api';
import {
  Button,
  EmptyScreen,
  ErrorMessage,
  Spinner,
  Table,
  TableColumn,
  TableRow,
  TableSimpleColumn,
} from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { filesize } from 'filesize';
import { onDestroy, onMount, setContext } from 'svelte';

import PVCIcon from '/@/lib/images/PVCIcon.svelte';

import {
  compareByName,
  describeAccess,
  getDragKey,
  getParentPath,
  getPathSegments,
  PVC_FILE_BROWSER_CONTEXT,
  type PvcFileBrowserContext,
  type PvcFileRow,
} from './pvc-file-browser';
import PVCFileActionsColumn from './PVCFileActionsColumn.svelte';
import PVCFileNameColumn from './PVCFileNameColumn.svelte';

// The files of a PersistentVolumeClaim: browse, upload (drop files from the desktop), download (drag files to the
// desktop), create folders, rename and delete
interface Props {
  name: string;
  namespace: string;
}
let { name, namespace }: Props = $props();

let session = $state<PvcBrowserSessionInfo>();
let opening = $state(false);
let openError: string | undefined = $state(undefined);
let dir = $state('');
let entries: PvcFileRow[] = $state([]);
let loading = $state(false);
let listError: string | undefined = $state(undefined);
let actionError: string | undefined = $state(undefined);
let renaming: string | undefined = $state(undefined);
let newFolderName: string | undefined = $state(undefined);
// the directory where dropped files are uploaded, while files are dragged over the list
let dropTarget: string | undefined = $state(undefined);
let dragHint: string | undefined = $state(undefined);
let selectedItemsNumber = $state(0);
let listElement: HTMLDivElement | undefined = $state(undefined);
let destroyed = false;

// the files downloaded to be dragged out (Electron needs local files when the drag starts)
interface DragOut {
  key: string;
  status: 'pending' | 'ready' | 'error';
  localPaths?: string[];
  error?: string;
}
let dragOut: DragOut | undefined;

const readOnly = $derived(session?.readOnly ?? true);
const segments = $derived(getPathSegments(dir));
const selectedEntries = $derived(selectedItemsNumber ? entries.filter(entry => entry.selected) : []);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const context: PvcFileBrowserContext = {
  get readOnly(): boolean {
    return readOnly;
  },
  get renaming(): string | undefined {
    return renaming;
  },
  open: (entry: PvcFileEntry): void => {
    if (entry.type === 'directory') {
      navigate(entry.path);
    }
  },
  download: (list: PvcFileEntry[]): void => {
    download(list).catch((error: unknown) => (actionError = errorMessage(error)));
  },
  startRename: (entry: PvcFileEntry): void => {
    renaming = entry.path;
  },
  rename: (entry: PvcFileEntry, newName: string): void => {
    renaming = undefined;
    if (!newName || newName === entry.name) {
      return;
    }
    modify(() => window.kubernetesPvcBrowserRename(getSessionId(), entry.path, newName));
  },
  cancelRename: (): void => {
    renaming = undefined;
  },
  delete: (list: PvcFileEntry[]): void => {
    deleteEntries(list).catch((error: unknown) => (actionError = errorMessage(error)));
  },
};
setContext(PVC_FILE_BROWSER_CONTEXT, context);

onMount(() => {
  openSession().catch((error: unknown) => console.error('Error opening the volume', error));
});

onDestroy(() => {
  destroyed = true;
  if (session) {
    window
      .kubernetesPvcBrowserClose(session.sessionId)
      .catch((error: unknown) => console.error('Error closing the volume', error));
  }
});

function getSessionId(): string {
  if (!session) {
    throw new Error('the volume is not opened');
  }
  return session.sessionId;
}

async function openSession(): Promise<void> {
  opening = true;
  openError = undefined;
  try {
    const info = await window.kubernetesPvcBrowserOpen(namespace, name);
    if (destroyed) {
      await window.kubernetesPvcBrowserClose(info.sessionId);
      return;
    }
    session = info;
    await refresh();
  } catch (error: unknown) {
    openError = errorMessage(error);
  } finally {
    opening = false;
  }
}

async function refresh(): Promise<void> {
  if (!session) {
    return;
  }
  loading = true;
  listError = undefined;
  dragOut = undefined;
  const listedDir = dir;
  try {
    const list = await window.kubernetesPvcBrowserList(session.sessionId, listedDir);
    if (listedDir === dir) {
      entries = list.toSorted(compareByName);
    }
  } catch (error: unknown) {
    entries = [];
    listError = errorMessage(error);
  } finally {
    loading = false;
  }
}

function navigate(path: string): void {
  dir = path;
  renaming = undefined;
  newFolderName = undefined;
  entries = [];
  refresh().catch((error: unknown) => console.error('Error listing the files', error));
}

// runs a modification, then refreshes the list
function modify(action: () => Promise<void>): void {
  actionError = undefined;
  action()
    .catch((error: unknown) => (actionError = errorMessage(error)))
    .finally(() => refresh())
    .catch((error: unknown) => console.error('Error listing the files', error));
}

async function download(list: PvcFileEntry[]): Promise<void> {
  if (!list.length) {
    return;
  }
  const result = await window.openDialog({
    title: 'Select the folder where to download',
    selectors: ['openDirectory'],
  });
  const localDir = result?.[0];
  if (!localDir) {
    return;
  }
  const tokenId = await window.getCancellableTokenSource();
  await window.kubernetesPvcBrowserDownload(
    getSessionId(),
    list.map(entry => entry.path),
    localDir,
    tokenId,
  );
}

async function upload(localPaths: string[], targetDir: string): Promise<void> {
  if (!localPaths.length) {
    return;
  }
  actionError = undefined;
  const tokenId = await window.getCancellableTokenSource();
  try {
    await window.kubernetesPvcBrowserUpload(getSessionId(), localPaths, targetDir, tokenId);
  } finally {
    if (targetDir === dir) {
      await refresh();
    }
  }
}

async function uploadFromDialog(): Promise<void> {
  const result = await window.openDialog({
    title: 'Select the files to upload',
    selectors: ['openFile', 'multiSelections'],
  });
  await upload(result ?? [], dir);
}

async function deleteEntries(list: PvcFileEntry[]): Promise<void> {
  if (!list.length) {
    return;
  }
  const what = list.length === 1 ? (list[0]?.name ?? '') : `${list.length} items`;
  const result = await window.showMessageBox({
    title: 'Delete?',
    type: 'danger',
    message: `Delete ${what} from the volume ${name}? This can not be undone.`,
    buttons: ['Delete', 'Cancel'],
  });
  if (result?.response !== 'Delete') {
    return;
  }
  modify(() =>
    window.kubernetesPvcBrowserDelete(
      getSessionId(),
      list.map(entry => entry.path),
    ),
  );
}

function createFolder(): void {
  const folderName = newFolderName?.trim();
  newFolderName = undefined;
  if (folderName) {
    modify(() => window.kubernetesPvcBrowserMkdir(getSessionId(), dir, folderName));
  }
}

function onNewFolderKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    createFolder();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    newFolderName = undefined;
  }
}

function focus(input: HTMLInputElement): void {
  input.focus();
}

// the entry of the row containing the target of an event
function getEventEntry(event: Event): PvcFileRow | undefined {
  const rowElement = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-row-key]');
  const key = rowElement?.dataset.rowKey;
  return key === undefined ? undefined : entries.find(entry => entry.path === key);
}

// the entries dragged from a row: the selection if the row is selected
function getDraggedEntries(entry: PvcFileRow): PvcFileRow[] {
  return entry.selected ? entries.filter(item => item.selected) : [entry];
}

function prepareDragOut(list: PvcFileEntry[]): void {
  const paths = list.map(entry => entry.path);
  const key = getDragKey(paths);
  if (!session || (dragOut?.key === key && dragOut.status !== 'error')) {
    return;
  }
  const current: DragOut = { key, status: 'pending' };
  dragOut = current;
  window
    .kubernetesPvcBrowserPrepareDragOut(session.sessionId, paths)
    .then(localPaths => {
      current.status = 'ready';
      current.localPaths = localPaths;
      if (dragOut === current && dragWaiting) {
        dragWaiting = false;
        dragHint = undefined;
        window.kubernetesPvcBrowserStartDragOut(localPaths);
      }
    })
    .catch((error: unknown) => {
      current.status = 'error';
      current.error = errorMessage(error);
      if (dragOut === current && dragWaiting) {
        dragWaiting = false;
        dragHint = current.error;
      }
    });
}

// a drag started before its files were ready: it is started when they are, if the button is still pressed
let dragWaiting = false;
// a directory pressed: it is downloaded only if the pointer moves (a click opens it)
let pressedDirectory: { entry: PvcFileRow; x: number; y: number } | undefined;

// a drag may start: the files are downloaded in advance
function onPointerDown(event: PointerEvent): void {
  dragHint = undefined;
  if (event.button !== 0 || (event.target as HTMLElement | null)?.closest?.('button, input, [role="checkbox"]')) {
    return;
  }
  const entry = getEventEntry(event);
  if (!entry) {
    return;
  }
  if (entry.type === 'directory' && !entry.selected) {
    pressedDirectory = { entry, x: event.clientX, y: event.clientY };
  } else {
    prepareDragOut(getDraggedEntries(entry));
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!pressedDirectory) {
    return;
  }
  if (!(event.buttons & 1)) {
    pressedDirectory = undefined;
  } else if (Math.abs(event.clientX - pressedDirectory.x) + Math.abs(event.clientY - pressedDirectory.y) > 2) {
    prepareDragOut([pressedDirectory.entry]);
    pressedDirectory = undefined;
  }
}

function onPointerUp(): void {
  pressedDirectory = undefined;
  if (dragWaiting) {
    dragWaiting = false;
    dragHint = undefined;
  }
}

function onDragStart(event: DragEvent): void {
  const entry = getEventEntry(event);
  if (!entry) {
    return;
  }
  // the drag is handled by Electron, with the local files
  event.preventDefault();
  pressedDirectory = undefined;
  const list = getDraggedEntries(entry);
  const key = getDragKey(list.map(item => item.path));
  if (dragOut?.key === key && dragOut.status === 'ready' && dragOut.localPaths) {
    dragHint = undefined;
    window.kubernetesPvcBrowserStartDragOut(dragOut.localPaths);
  } else if (dragOut?.key === key && dragOut.status === 'error') {
    dragHint = dragOut.error;
  } else {
    dragWaiting = true;
    dragHint = 'Preparing the files to drag, keep the button pressed...';
    prepareDragOut(list);
  }
}

function isFileDrag(event: DragEvent): boolean {
  return !!event.dataTransfer?.types.includes('Files');
}

function onDragOver(event: DragEvent): void {
  if (!session || readOnly || !isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  const entry = getEventEntry(event);
  dropTarget = entry?.type === 'directory' ? entry.path : dir;
}

function onDragLeave(event: DragEvent): void {
  if (!listElement?.contains(event.relatedTarget as Node | null)) {
    dropTarget = undefined;
  }
}

function onDrop(event: DragEvent): void {
  if (!session || readOnly || !isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  const target = dropTarget ?? dir;
  dropTarget = undefined;
  // the files dragged out of the list and dropped back are ignored
  const ownFiles = new Set(dragOut?.localPaths ?? []);
  const localPaths = Array.from(event.dataTransfer?.files ?? [])
    .map(file => window.getPathForFile(file))
    .filter(path => !!path && !ownFiles.has(path));
  upload(localPaths, target).catch((error: unknown) => (actionError = errorMessage(error)));
}

const columns = [
  new TableColumn<PvcFileRow>('Name', {
    width: '3fr',
    renderer: PVCFileNameColumn,
    comparator: compareByName,
  }),
  new TableColumn<PvcFileRow, string>('Size', {
    align: 'right',
    renderMapping: (entry): string => (entry.type === 'directory' ? '' : filesize(entry.size)),
    renderer: TableSimpleColumn,
    comparator: (a, b): number => a.size - b.size,
    initialOrder: 'descending',
  }),
  new TableColumn<PvcFileRow, string>('Modified', {
    width: '1.5fr',
    renderMapping: (entry): string => new Date(entry.modified).toLocaleString(),
    renderer: TableSimpleColumn,
    comparator: (a, b): number => a.modified - b.modified,
    initialOrder: 'descending',
  }),
  new TableColumn<PvcFileRow, string>('Permissions', {
    renderMapping: (entry): string => entry.permissions,
    renderer: TableSimpleColumn,
  }),
  new TableColumn<PvcFileRow>('Actions', {
    align: 'right',
    renderer: PVCFileActionsColumn,
    overflow: true,
    excludeFromRowClick: true,
  }),
];

const row = new TableRow<PvcFileRow>({
  selectable: (): boolean => true,
  onClick: (entry): void => context.open(entry),
  clickable: (entry): boolean => entry.type === 'directory',
  draggable: (): boolean => true,
});
</script>

<svelte:window onpointerup={onPointerUp} />

<div class="flex flex-col h-full w-full text-sm text-[var(--pd-content-text)]">
  {#if opening}
    <div class="flex items-center justify-center gap-2 h-full">
      <Spinner size="1.5em" />
      <span>Opening the volume {name}...</span>
    </div>
  {:else if openError}
    <EmptyScreen icon={PVCIcon} title="Unable to browse the volume" message={openError}>
      <Button onclick={openSession}>Retry</Button>
    </EmptyScreen>
  {:else if session}
    <div class="flex items-center gap-2 px-5 pt-3 text-[var(--pd-content-text-sub)]">
      <span aria-label="Volume access">{describeAccess(session)}</span>
      {#if readOnly}
        <span class="flex items-center gap-1" title="The volume is mounted read only">
          <Icon icon={faLock} />Read only
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-2 px-5 py-2">
      <Button
        type="secondary"
        icon={faArrowUp}
        title="Parent folder"
        aria-label="Parent folder"
        disabled={!dir}
        onclick={(): void => navigate(getParentPath(dir))} />
      <Button
        type="secondary"
        icon={faRotateRight}
        title="Refresh"
        aria-label="Refresh"
        inProgress={loading}
        onclick={(): void => {
          refresh().catch((error: unknown) => console.error('Error listing the files', error));
        }} />
      <nav class="flex items-center gap-1 grow min-w-0 overflow-hidden" aria-label="Path">
        {#each segments as segment, index (segment.path)}
          {#if index > 1}<span>/</span>{/if}
          {#if index === segments.length - 1}
            <span class="font-semibold text-[var(--pd-content-header)]" aria-current="page">{segment.name}</span>
          {:else}
            <Button type="link" padding="px-1" onclick={(): void => navigate(segment.path)}>{segment.name}</Button>
          {/if}
        {/each}
      </nav>
      {#if newFolderName !== undefined}
        <input
          class="px-2 py-1 rounded-sm bg-[var(--pd-input-field-focused-bg)] border border-[var(--pd-input-field-stroke)] text-[var(--pd-input-field-focused-text)] outline-hidden"
          placeholder="Folder name"
          aria-label="New folder name"
          bind:value={newFolderName}
          onkeydown={onNewFolderKeyDown}
          onblur={(): void => {
            newFolderName = undefined;
          }}
          {@attach focus} />
      {:else}
        <Button
          type="secondary"
          icon={faFolderPlus}
          title="New folder"
          disabled={readOnly}
          onclick={(): void => {
            newFolderName = '';
          }}>New folder</Button>
      {/if}
      <Button
        type="secondary"
        icon={faUpload}
        title="Upload files (or drop files and folders in the list)"
        disabled={readOnly}
        onclick={(): void => {
          uploadFromDialog().catch((error: unknown) => (actionError = errorMessage(error)));
        }}>Upload</Button>
      <Button
        type="secondary"
        icon={faDownload}
        title="Download the selected items"
        disabled={!selectedEntries.length}
        onclick={(): void => context.download(selectedEntries)}>Download</Button>
      <Button
        type="secondary"
        icon={faTrash}
        title="Delete the selected items"
        disabled={readOnly || !selectedEntries.length}
        onclick={(): void => context.delete(selectedEntries)}>Delete</Button>
    </div>
    {#if actionError ?? listError ?? dragHint}
      <div class="px-5 pb-2">
        {#if actionError}<ErrorMessage error={actionError} />{/if}
        {#if listError}<ErrorMessage error={listError} />{/if}
        {#if dragHint}<div class="text-[var(--pd-content-text-sub)]" role="status">{dragHint}</div>{/if}
      </div>
    {/if}
    <div
      class="relative flex flex-col grow min-h-0 overflow-auto"
      role="region"
      aria-label="Files"
      bind:this={listElement}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      ondragstart={onDragStart}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}>
      {#if entries.length}
        <Table
          kind="pvc files"
          data={entries}
          columns={columns}
          row={row}
          defaultSortColumn="Name"
          key={(entry): string => entry.path}
          label={(entry): string => entry.name}
          bind:selectedItemsNumber={selectedItemsNumber} />
      {:else if !loading && !listError}
        <EmptyScreen
          icon={PVCIcon}
          title="Empty folder"
          message={readOnly ? 'This folder is empty' : 'Drop files or folders here to upload them'} />
      {/if}
      {#if dropTarget !== undefined}
        <div
          class="absolute inset-0 pointer-events-none flex items-end justify-center pb-4 border-2 border-dashed rounded-lg border-[var(--pd-tab-highlight)] bg-[color-mix(in_srgb,var(--pd-tab-highlight)_10%,transparent)]">
          <span class="px-3 py-1 rounded-sm bg-[var(--pd-content-card-bg)]" role="status">
            Drop to upload to /{dropTarget}
          </span>
        </div>
      {/if}
    </div>
  {/if}
</div>
