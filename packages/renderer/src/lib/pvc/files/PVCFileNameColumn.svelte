<script lang="ts">
import { faFile, faFolder, faLink, faQuestion } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { getContext } from 'svelte';

import { PVC_FILE_BROWSER_CONTEXT, type PvcFileBrowserContext, type PvcFileRow } from './pvc-file-browser';

interface Props {
  object: PvcFileRow;
}
let { object }: Props = $props();

const browser = getContext<PvcFileBrowserContext>(PVC_FILE_BROWSER_CONTEXT);

const icon = $derived(
  object.type === 'directory'
    ? faFolder
    : object.type === 'file'
      ? faFile
      : object.type === 'symlink'
        ? faLink
        : faQuestion,
);

let newName = $state('');
const renaming = $derived(browser.renaming === object.path);
$effect(() => {
  if (renaming) {
    newName = object.name;
  }
});

function focus(input: HTMLInputElement): void {
  input.focus();
  // the extension is not selected
  const dot = object.type === 'directory' ? -1 : object.name.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : object.name.length);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    browser.rename(object, newName);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    browser.cancelRename();
  }
}
</script>

<div class="flex items-center gap-2 text-sm text-[var(--pd-table-body-text-highlight)] max-w-full">
  <Icon icon={icon} class="shrink-0 text-[var(--pd-table-body-text)]" />
  {#if renaming}
    <input
      class="px-1 rounded-sm bg-[var(--pd-input-field-focused-bg)] border border-[var(--pd-input-field-stroke)] text-[var(--pd-input-field-focused-text)] outline-hidden min-w-64"
      aria-label="New name of {object.name}"
      bind:value={newName}
      onkeydown={onKeyDown}
      onblur={(): void => browser.cancelRename()}
      onclick={(event): void => event.stopPropagation()}
      {@attach focus} />
  {:else}
    <span class="overflow-hidden text-ellipsis" title={object.name}>{object.name}</span>
  {/if}
</div>
