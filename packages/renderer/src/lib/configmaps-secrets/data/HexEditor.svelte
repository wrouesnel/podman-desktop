<script lang="ts">
import { tick } from 'svelte';

// A hex editor: the bytes are typed in hexadecimal (or as characters in the text column), at the position of the
// cursor (after the last byte to append); Backspace and Delete remove bytes
interface Props {
  bytes: Uint8Array;
  readOnly?: boolean;
  onChange?: (bytes: Uint8Array) => void;
}
let { bytes, readOnly = false, onChange }: Props = $props();

const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 20;
// rows rendered above and below the visible ones
const OVERSCAN = 8;

let data: Uint8Array = $state.raw(new Uint8Array());
// incremented when data is modified in place
let version = $state(0);
let cursor = $state(0);
// the second hexadecimal digit of the byte at the cursor is being typed
let lowNibble = $state(false);
let pane: 'hex' | 'text' = $state('hex');
let scrollTop = $state(0);
let viewportHeight = $state(400);
let viewport: HTMLDivElement | undefined = $state(undefined);

// a new content given by the parent
let lastBytes: Uint8Array | undefined;
$effect.pre(() => {
  if (bytes !== lastBytes) {
    lastBytes = bytes;
    // a copy: the bytes are modified in place
    data = bytes.slice();
    cursor = Math.min(cursor, bytes.length);
    lowNibble = false;
  }
});

// the last row has the position after the last byte
const rowCount = $derived(Math.floor(data.length / BYTES_PER_ROW) + 1);
const firstRow = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
const lastRow = $derived(Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN));
const rows = $derived(Array.from({ length: Math.max(0, lastRow - firstRow) }, (_, i) => firstRow + i));

function hex(value: number, digits: number): string {
  return value.toString(16).toUpperCase().padStart(digits, '0');
}

function printable(value: number): string {
  return value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : '.';
}

function getByte(index: number): number | undefined {
  // read version: re-rendered on in place modifications
  return version >= 0 && index < data.length ? data[index] : undefined;
}

function changed(newData: Uint8Array): void {
  if (newData === data) {
    version++;
  } else {
    data = newData;
  }
  lastBytes = data;
  onChange?.(data);
}

function setByte(index: number, value: number): void {
  if (index < data.length) {
    data[index] = value;
    changed(data);
  } else {
    const newData = new Uint8Array(data.length + 1);
    newData.set(data);
    newData[data.length] = value;
    changed(newData);
  }
}

function removeByte(index: number): void {
  if (index < 0 || index >= data.length) {
    return;
  }
  const newData = new Uint8Array(data.length - 1);
  newData.set(data.subarray(0, index));
  newData.set(data.subarray(index + 1), index);
  changed(newData);
}

async function moveCursor(position: number): Promise<void> {
  cursor = Math.max(0, Math.min(data.length, position));
  lowNibble = false;
  await tick();
  // keep the cursor visible
  if (viewport) {
    const top = Math.floor(cursor / BYTES_PER_ROW) * ROW_HEIGHT;
    if (top < viewport.scrollTop) {
      viewport.scrollTop = top;
    } else if (top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = top + ROW_HEIGHT - viewport.clientHeight;
    }
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const pageRows = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1);
  const moves: Record<string, number> = {
    ArrowLeft: cursor - 1,
    ArrowRight: cursor + 1,
    ArrowUp: cursor - BYTES_PER_ROW,
    ArrowDown: cursor + BYTES_PER_ROW,
    PageUp: cursor - pageRows * BYTES_PER_ROW,
    PageDown: cursor + pageRows * BYTES_PER_ROW,
    Home: cursor - (cursor % BYTES_PER_ROW),
    End: Math.min(data.length, cursor - (cursor % BYTES_PER_ROW) + BYTES_PER_ROW - 1),
  };
  const move = moves[event.key];
  if (move !== undefined) {
    event.preventDefault();
    moveCursor(move).catch(console.error);
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    pane = pane === 'hex' ? 'text' : 'hex';
    lowNibble = false;
    return;
  }
  if (readOnly) {
    return;
  }
  if (event.key === 'Backspace') {
    event.preventDefault();
    if (cursor > 0) {
      removeByte(cursor - 1);
      moveCursor(cursor - 1).catch(console.error);
    }
  } else if (event.key === 'Delete') {
    event.preventDefault();
    removeByte(cursor);
    lowNibble = false;
  } else if (pane === 'hex' && /^[0-9a-fA-F]$/.test(event.key)) {
    event.preventDefault();
    const digit = Number.parseInt(event.key, 16);
    const current = getByte(cursor) ?? 0;
    if (lowNibble) {
      setByte(cursor, (current & 0xf0) | digit);
      moveCursor(cursor + 1).catch(console.error);
    } else {
      setByte(cursor, (digit << 4) | (cursor < data.length ? current & 0x0f : 0));
      lowNibble = true;
    }
  } else if (pane === 'text' && event.key.length === 1) {
    const code = event.key.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) {
      event.preventDefault();
      setByte(cursor, code);
      moveCursor(cursor + 1).catch(console.error);
    }
  }
}

function select(index: number, selectedPane: 'hex' | 'text'): void {
  pane = selectedPane;
  cursor = Math.min(index, data.length);
  lowNibble = false;
  viewport?.focus();
}
</script>

<div class="flex flex-col h-full w-full font-mono text-sm text-[var(--pd-content-text)] bg-[var(--pd-terminal-background)]">
  <div class="flex px-3 py-1 border-b border-[var(--pd-content-divider)] text-[var(--pd-content-text-sub)] select-none">
    <span class="w-24 shrink-0">Offset</span>
    <span class="flex gap-1.5 shrink-0">
      {#each Array.from({ length: BYTES_PER_ROW }, (_, i) => i) as column (column)}
        <span class="w-[2ch]" class:ml-2={column === 8}>{hex(column, 2)}</span>
      {/each}
    </span>
    <span class="ml-6">Text</span>
  </div>
  <div
    class="grow min-h-0 overflow-auto outline-hidden focus-visible:ring-1 focus-visible:ring-[var(--pd-input-field-stroke)]"
    role="textbox"
    tabindex="0"
    aria-label="Hex editor"
    aria-readonly={readOnly}
    aria-multiline="true"
    bind:this={viewport}
    bind:clientHeight={viewportHeight}
    onscroll={(): void => {
      scrollTop = viewport?.scrollTop ?? 0;
    }}
    onkeydown={onKeyDown}>
    <div class="relative px-3" style="height: {rowCount * ROW_HEIGHT}px">
      {#each rows as row (row)}
        <div class="absolute flex left-3 right-3" style="top: {row * ROW_HEIGHT}px; height: {ROW_HEIGHT}px" role="row">
          <span class="w-24 shrink-0 text-[var(--pd-content-text-sub)] select-none">{hex(row * BYTES_PER_ROW, 8)}</span>
          <span class="flex gap-1.5 shrink-0">
            {#each Array.from({ length: BYTES_PER_ROW }, (_, i) => row * BYTES_PER_ROW + i) as index (index)}
              {@const value = getByte(index)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <span
                class="w-[2ch] cursor-text"
                class:ml-2={index % BYTES_PER_ROW === 8}
                class:bg-[var(--pd-tab-highlight)]={index === cursor && pane === 'hex'}
                class:text-[var(--pd-button-primary-text)]={index === cursor && pane === 'hex'}
                class:outline={index === cursor && pane === 'text'}
                role="gridcell"
                tabindex="-1"
                aria-label="Byte {index}"
                onclick={(): void => select(index, 'hex')}>
                {value === undefined ? (index === data.length ? '__' : '') : hex(value, 2)}
              </span>
            {/each}
          </span>
          <span class="ml-6 whitespace-pre">
            {#each Array.from({ length: BYTES_PER_ROW }, (_, i) => row * BYTES_PER_ROW + i) as index (index)}
              {@const value = getByte(index)}
              {#if value !== undefined || index === data.length}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <span
                  class="cursor-text"
                  class:bg-[var(--pd-tab-highlight)]={index === cursor && pane === 'text'}
                  class:text-[var(--pd-button-primary-text)]={index === cursor && pane === 'text'}
                  class:outline={index === cursor && pane === 'hex'}
                  role="gridcell"
                  tabindex="-1"
                  onclick={(): void => select(index, 'text')}>{value === undefined ? ' ' : printable(value)}</span>
              {/if}
            {/each}
          </span>
        </div>
      {/each}
    </div>
  </div>
  <div class="flex gap-4 px-3 py-1 border-t border-[var(--pd-content-divider)] text-[var(--pd-content-text-sub)]">
    <span aria-label="Cursor position">Offset {hex(cursor, 8)} ({cursor})</span>
    <span>{data.length} bytes</span>
    {#if !readOnly}<span>Type hexadecimal digits (or characters in the text column), Tab switches columns</span>{/if}
  </div>
</div>
