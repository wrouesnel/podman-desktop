<script lang="ts">
import { faFileImport, faFloppyDisk, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import type { V1ConfigMap, V1Secret } from '@kubernetes/client-node';
import { Button, EmptyScreen, ErrorMessage } from '@podman-desktop/ui-svelte';
import { untrack } from 'svelte';

import MonacoEditor from '/@/lib/editor/MonacoEditor.svelte';
import ConfigMapSecretIcon from '/@/lib/images/ConfigMapSecretIcon.svelte';

import {
  base64ToBytes,
  bytesToBase64,
  bytesToText,
  type ConfigDataKind,
  formatSize,
  getBase64Size,
  getConfigDataKeys,
  getLanguage,
  isBinary,
  textToBytes,
} from './config-data';
import HexEditor from './HexEditor.svelte';

// The values of the keys of a ConfigMap or Secret (decoded): edited as text, or in a hex editor when they look binary;
// a value can be replaced by the content of a local file (file dialog or drop)
interface Props {
  kind: ConfigDataKind;
  resource?: V1ConfigMap | V1Secret;
}
let { kind, resource }: Props = $props();

const keys = $derived(getConfigDataKeys(kind, resource));
const readOnly = $derived(!!resource?.immutable);

let selectedKey: string | undefined = $state(undefined);
// the value of the selected key when it was loaded, and the resource version at that time
let original: Uint8Array = $state.raw(new Uint8Array());
let loadedBase64: string | undefined;
let loadedVersion: string | undefined;
// the modified value, undefined when not modified
let edited: Uint8Array | undefined = $state.raw(undefined);
let mode: 'text' | 'hex' = $state('text');
// the content given to the text editor (set when a value is loaded or replaced, not on each change)
let textContent = $state('');
// incremented to recreate the text editor with a new content
let textEditorGeneration = $state(0);
let saving = $state(false);
let error: string | undefined = $state(undefined);
let info: string | undefined = $state(undefined);
// the resource has been modified on the cluster while the value was modified
let outdated = $state(false);
let dropping = $state(false);

const current = $derived(edited ?? original);
const modified = $derived(edited !== undefined && !sameBytes(edited, original));
const currentText = $derived(bytesToText(current));

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function load(key: string | undefined): void {
  selectedKey = key;
  const value = keys.find(item => item.key === key);
  loadedBase64 = value?.base64;
  loadedVersion = resource?.metadata?.resourceVersion;
  original = value ? base64ToBytes(value.base64) : new Uint8Array();
  edited = undefined;
  outdated = false;
  error = undefined;
  info = undefined;
  showContent(original);
}

// shows a content in the editor matching its type
function showContent(bytes: Uint8Array): void {
  mode = isBinary(bytes) ? 'hex' : 'text';
  textContent = bytesToText(bytes) ?? '';
  textEditorGeneration++;
}

// the resource has been updated
$effect(() => {
  const version = resource?.metadata?.resourceVersion;
  const value = keys.find(item => item.key === selectedKey);
  untrack(() => {
    if (!value) {
      if (!modified) {
        load(keys[0]?.key);
      }
    } else if (value.base64 === loadedBase64) {
      loadedVersion = version;
    } else if (modified) {
      outdated = true;
    } else {
      load(selectedKey);
    }
  });
});

function select(key: string): void {
  if (key === selectedKey) {
    return;
  }
  if (modified) {
    window
      .showMessageBox({
        title: 'Discard the changes?',
        message: `The value of ${selectedKey} has been modified. Discard the changes?`,
        buttons: ['Discard', 'Cancel'],
        type: 'warning',
      })
      .then(result => {
        if (result?.response === 'Discard') {
          load(key);
        }
      })
      .catch((err: unknown) => console.error('Error asking to discard the changes', err));
  } else {
    load(key);
  }
}

function switchMode(newMode: 'text' | 'hex'): void {
  if (newMode === mode || (newMode === 'text' && currentText === undefined)) {
    return;
  }
  if (newMode === 'text') {
    textContent = currentText ?? '';
    textEditorGeneration++;
  }
  mode = newMode;
}

function onTextChange(event: CustomEvent<string>): void {
  edited = textToBytes(event.detail);
}

function onHexChange(bytes: Uint8Array): void {
  edited = bytes;
}

async function save(): Promise<void> {
  if (!resource?.metadata?.name || !resource.metadata.namespace || !selectedKey) {
    return;
  }
  saving = true;
  error = undefined;
  info = undefined;
  const value = current;
  const base64 = bytesToBase64(value);
  try {
    const update = kind === 'Secret' ? window.kubernetesUpdateSecretKey : window.kubernetesUpdateConfigMapKey;
    const updated = await update(
      resource.metadata.name,
      resource.metadata.namespace,
      selectedKey,
      base64,
      loadedVersion,
    );
    original = value;
    edited = undefined;
    loadedBase64 = base64;
    loadedVersion = updated?.metadata?.resourceVersion;
    outdated = false;
    info = `${selectedKey} saved`;
  } catch (err: unknown) {
    error = errorMessage(err);
  } finally {
    saving = false;
  }
}

function revert(): void {
  load(selectedKey);
}

async function replaceFromFile(filePath: string): Promise<void> {
  error = undefined;
  info = undefined;
  try {
    const bytes = base64ToBytes(await window.kubernetesReadConfigDataFile(filePath));
    edited = bytes;
    showContent(bytes);
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    info = `The value has been replaced by the content of ${fileName}: save to apply`;
  } catch (err: unknown) {
    error = errorMessage(err);
  }
}

async function selectFile(): Promise<void> {
  const result = await window.openDialog({
    title: `Select the file replacing the value of ${selectedKey}`,
    selectors: ['openFile'],
  });
  const filePath = result?.[0];
  if (filePath) {
    await replaceFromFile(filePath);
  }
}

function isFileDrag(event: DragEvent): boolean {
  return !!event.dataTransfer?.types.includes('Files');
}

function onDragOver(event: DragEvent): void {
  if (readOnly || !selectedKey || !isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  dropping = true;
}

function onDragLeave(event: DragEvent): void {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    dropping = false;
  }
}

function onDrop(event: DragEvent): void {
  if (readOnly || !selectedKey || !isFileDrag(event)) {
    return;
  }
  // the editor does not receive the file as text
  event.preventDefault();
  event.stopPropagation();
  dropping = false;
  const file = event.dataTransfer?.files[0];
  const filePath = file ? window.getPathForFile(file) : '';
  if (filePath) {
    replaceFromFile(filePath).catch((err: unknown) => console.error('Error replacing the value', err));
  }
}
</script>

{#if !resource}
  <p class="p-5 text-[var(--pd-state-info)] font-medium">Loading...</p>
{:else if !keys.length}
  <EmptyScreen icon={ConfigMapSecretIcon} title="No data" message="The {kind} {resource.metadata?.name} has no keys" />
{:else}
  <div class="flex h-full w-full min-h-0 text-sm text-[var(--pd-content-text)]">
    <div class="flex flex-col w-64 shrink-0 overflow-auto border-r border-[var(--pd-content-divider)]" role="navigation" aria-label="Keys">
      {#each keys as item (item.key)}
        <button
          class="flex flex-col items-start px-4 py-2 text-left hover:bg-[var(--pd-content-card-hover-bg)]"
          class:bg-[var(--pd-content-card-bg)]={item.key === selectedKey}
          class:font-semibold={item.key === selectedKey}
          aria-current={item.key === selectedKey}
          aria-label={item.key}
          onclick={(): void => select(item.key)}>
          <span class="max-w-full overflow-hidden text-ellipsis whitespace-nowrap" title={item.key}>{item.key}</span>
          <span class="text-xs text-[var(--pd-content-text-sub)]">{formatSize(getBase64Size(item.base64))}</span>
        </button>
      {/each}
    </div>
    <div class="flex flex-col grow min-w-0">
      <div class="flex items-center gap-2 px-3 py-2">
        <span class="font-semibold text-[var(--pd-content-header)] overflow-hidden text-ellipsis whitespace-nowrap" aria-label="Selected key">
          {selectedKey}{modified ? ' (modified)' : ''}
        </span>
        <span class="text-[var(--pd-content-text-sub)]">{formatSize(current.length)}</span>
        <span class="grow"></span>
        <Button
          type="tab"
          selected={mode === 'text'}
          disabled={currentText === undefined}
          title={currentText === undefined ? 'The value is not valid UTF-8 text' : 'Edit as text'}
          onclick={(): void => switchMode('text')}>Text</Button>
        <Button type="tab" selected={mode === 'hex'} title="Edit in hexadecimal" onclick={(): void => switchMode('hex')}
          >Hex</Button>
        <Button
          type="secondary"
          icon={faFileImport}
          title="Replace the value by the content of a file (or drop a file on the editor)"
          disabled={readOnly}
          onclick={(): void => {
            selectFile().catch((err: unknown) => (error = errorMessage(err)));
          }}>Replace from file</Button>
        <Button type="secondary" icon={faRotateLeft} disabled={!modified} onclick={revert}>Revert</Button>
        <Button
          icon={faFloppyDisk}
          disabled={!modified || readOnly}
          inProgress={saving}
          onclick={(): void => {
            save().catch((err: unknown) => (error = errorMessage(err)));
          }}>Save</Button>
      </div>
      {#if error !== undefined || info !== undefined || outdated || readOnly}
        <div class="px-3 pb-2 flex flex-col gap-1">
          {#if readOnly}<span class="text-[var(--pd-content-text-sub)]">The {kind} is immutable: its values can't be modified</span>{/if}
          {#if outdated}
            <span class="text-[var(--pd-state-warning)]" role="alert">
              The value has been modified on the cluster. <Button type="link" padding="px-1" onclick={revert}
                >Reload (discard your changes)</Button>
            </span>
          {/if}
          {#if error}<ErrorMessage error={error} />{/if}
          {#if info}<span class="text-[var(--pd-content-text-sub)]" role="status">{info}</span>{/if}
        </div>
      {/if}
      <div
        class="relative grow min-h-0"
        role="region"
        aria-label="Value of {selectedKey}"
        ondragleave={onDragLeave}
        ondragovercapture={onDragOver}
        ondropcapture={onDrop}>
        {#if mode === 'text'}
          {#key `${selectedKey}/${textEditorGeneration}`}
            <MonacoEditor
              content={textContent}
              language={getLanguage(selectedKey ?? '')}
              readOnly={readOnly}
              on:contentChange={onTextChange} />
          {/key}
        {:else}
          <HexEditor bytes={current} readOnly={readOnly} onChange={onHexChange} />
        {/if}
        {#if dropping}
          <div
            class="absolute inset-0 pointer-events-none flex items-center justify-center border-2 border-dashed rounded-lg border-[var(--pd-tab-highlight)] bg-[color-mix(in_srgb,var(--pd-tab-highlight)_10%,transparent)]">
            <span class="px-3 py-1 rounded-sm bg-[var(--pd-content-card-bg)]" role="status">
              Drop a file to replace the value of {selectedKey}
            </span>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
