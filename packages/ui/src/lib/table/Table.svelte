<style>
.grid-table {
  display: grid;
  grid-template-columns: var(--table-grid-table-columns);
}
</style>

<script lang="ts" generics="T extends { selected?: boolean; name?: string }">
/* eslint-disable import/no-duplicates */
// https://github.com/import-js/eslint-plugin-import/issues/1479
import { onMount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

import Checkbox from '../checkbox/Checkbox.svelte';
import ChevronExpander from '../icons/ChevronExpander.svelte';
import type { ListOrganizerItem } from '../layouts/ListOrganizer';
import ListOrganizer from '../layouts/ListOrganizer.svelte';
/* eslint-enable import/no-duplicates */
import type { Column, Row } from './table';
import { collapsedStateMap, tablePersistence } from './table-persistence-store.svelte';
import { VirtualRows, VirtualSpacer } from './virtual-rows.svelte';

// above this number of rows, only the visible rows are rendered (when virtualization is 'auto')
const VIRTUALIZATION_THRESHOLD = 100;

// The rows are keyed by the identity of the objects in `data`: a row is rendered again only when its object is
// replaced by another object. To update a row, the caller must either replace its object in `data`,
// or pass reactive objects (for example items of a `$state` array), whose properties changes are tracked.
// The selection is the exception: the table sets the `selected` property of the objects, and tracks it itself.
interface Props {
  kind: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: Column<T, any>[];
  row: Row<T>;
  data: T[];
  defaultSortColumn?: string;
  collapsed?: string[];
  /**
   * To better distinct individual row, you can provide a dedicated key method
   *
   * By default, it will use the object name property
   */
  key?: (object: T) => string;
  /**
   * Specify the aria-label for a given item
   *
   * By default, it will use the object name property
   */
  label?: (object: T) => string;
  enableLayoutConfiguration?: boolean;
  // number of selected items in the list
  selectedItemsNumber?: number;
  /**
   * Render only the rows visible in the scroll container of the table:
   * 'auto' (default) when there are more than 100 rows, 'always' or 'never'
   */
  virtualization?: 'auto' | 'always' | 'never';
}

let {
  kind,
  columns,
  row,
  data,
  defaultSortColumn = undefined,
  collapsed = $bindable(collapsedStateMap.get(kind) ?? []),
  key = (item: T): string => item.name ?? String(item),
  label = (item: T): string => item.name ?? String(item),
  enableLayoutConfiguration = false,
  // written by an effect below, the rule does not know about bindable props
  // eslint-disable-next-line no-useless-assignment
  selectedItemsNumber = $bindable(),
  virtualization = 'auto',
}: Props = $props();

let columnItems: ListOrganizerItem[] = $state([]);
// a single reactive map, whose content is replaced when the ordering changes
const columnOrdering = new SvelteMap<string, number>();

function setColumnOrdering(ordering: Map<string, number>): void {
  // copy the entries first, as `ordering` can be `columnOrdering` itself
  const entries = Array.from(ordering.entries());
  columnOrdering.clear();
  entries.forEach(([id, order]) => columnOrdering.set(id, order));
}
let isInitialized = $state(false);
let isLoading = false;

// Initialize default column configuration
function getDefaultColumnItems(): ListOrganizerItem[] {
  return columns.map((col, index) => ({
    id: col.title,
    label: col.title,
    enabled: true,
    originalOrder: index,
  }));
}

// Initialize column configuration
async function initializeColumns(): Promise<void> {
  if (isInitialized || isLoading) return;

  isLoading = true;
  try {
    if (enableLayoutConfiguration) {
      const loadedItems = await loadColumnConfiguration();
      columnItems = loadedItems;
    } else {
      columnItems = getDefaultColumnItems();
    }
    isInitialized = true;
  } catch (error: unknown) {
    console.error('Failed to load column configuration:', error);
    // Fallback to default configuration
    columnItems = getDefaultColumnItems();
    isInitialized = true;
  } finally {
    isLoading = false;
  }
}

// Load configuration
async function loadColumnConfiguration(): Promise<ListOrganizerItem[]> {
  if (enableLayoutConfiguration && tablePersistence.storage) {
    const loadedItems = await tablePersistence.storage.load(
      kind,
      columns.map(col => col.title),
    );

    if (loadedItems.length > 0) {
      // Ensure loaded items have proper originalOrder from defaults if missing
      const defaultItems = getDefaultColumnItems();
      const items = loadedItems.map((item: ListOrganizerItem) => ({
        ...item,
        originalOrder: item.originalOrder ?? defaultItems.find(d => d.id === item.id)?.originalOrder ?? 0,
      }));

      // Build ordering map from loaded items
      // Check if items are in a different order than their original order
      const isReordered = items.some((item, index) => item.originalOrder !== index);
      if (isReordered) {
        setColumnOrdering(new Map(items.map((item, index) => [item.id, index])));
      } else {
        columnOrdering.clear();
      }

      return items;
    }
  }
  return getDefaultColumnItems();
}

// Save configuration
async function saveColumnConfiguration(): Promise<void> {
  if (enableLayoutConfiguration && tablePersistence.storage) {
    // Create ordered items based on current state
    const orderedItems = getOrderedColumns();
    await tablePersistence.storage.save(kind, orderedItems);
  }
}

// Get ordered columns based on current ordering
function getOrderedColumns(): ListOrganizerItem[] {
  if (columnOrdering.size === 0) {
    return columnItems.toSorted((a, b) => a.originalOrder - b.originalOrder);
  }
  return columnItems.toSorted((a, b) => {
    const aOrder = columnOrdering.get(a.id) ?? a.originalOrder;
    const bOrder = columnOrdering.get(b.id) ?? b.originalOrder;
    return aOrder - bOrder;
  });
}

// Initialize columns on mount
onMount(async () => {
  await initializeColumns();
});

// Save configuration whenever columnItems or ordering changes (after initialization)
$effect(() => {
  if (isInitialized && columnItems.length > 0) {
    // track the changes of the ordering
    Array.from(columnOrdering.entries());
    saveColumnConfiguration().catch((error: unknown) => {
      console.error('Failed to save column configuration:', error);
    });
  }
});

// Computed visible columns based on configuration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const visibleColumns: Column<T, any>[] = $derived.by(() => {
  if (columnItems.length === 0) {
    // Fallback to all columns when not yet initialized
    return columns;
  }

  const orderedColumns = getOrderedColumns();

  return orderedColumns
    .filter(item => item.enabled)
    .map(item => columns.find(col => col.title === item.id)!)
    .filter(Boolean);
});

// The table sets the `selected` property of the (possibly non reactive) objects,
// this counter is incremented on each change of the selection to update the view
let selectionVersion = $state(0);

function selectableChildren(object: T): T[] {
  return (row.info.children?.(object) ?? []).filter(child => row.info.selectable?.(child));
}

const selectableObjects: T[] = $derived(
  row.info.selectable ? data.filter(object => row.info.selectable?.(object)) : [],
);

const selectedCount: number = $derived.by(() => {
  // eslint-disable-next-line sonarjs/void-use
  void selectionVersion;
  if (!row.info.selectable) {
    return 0;
  }
  return (
    selectableObjects.filter(object => object.selected).length +
    data.reduce((previous, current) => previous + selectableChildren(current).filter(child => child.selected).length, 0)
  );
});

$effect(() => {
  selectedItemsNumber = selectedCount;
});

// are all the selectable items selected?
const selectedAllCheckboxes: boolean = $derived.by(() => {
  // eslint-disable-next-line sonarjs/void-use
  void selectionVersion;
  return (
    selectableObjects.length > 0 &&
    selectableObjects.every(object => object.selected) &&
    data.flatMap(object => selectableChildren(object)).every(child => child.selected)
  );
});

function isSelected(object: T): boolean {
  // eslint-disable-next-line sonarjs/void-use
  void selectionVersion;
  return !!object.selected;
}

function toggleAll(checked: boolean): void {
  if (!row.info.selectable) {
    return;
  }
  selectableObjects.forEach(object => (object.selected = checked));
  // toggle children
  data.forEach(object => selectableChildren(object).forEach(child => (child.selected = checked)));
  selectionVersion++;
}

function objectChecked(object: T, checked: boolean): void {
  object.selected = checked;
  // set the children to the same state
  row.info.children?.(object)?.forEach(child => (child.selected = checked));
  selectionVersion++;
}

function childChecked(child: T, checked: boolean): void {
  child.selected = checked;
  selectionVersion++;
}

let sortCol: Column<T> | undefined = $state();
let sortAscending: boolean = $state(true);

const sortedData: T[] = $derived.by(() => {
  let comparator = sortCol?.info.comparator;
  if (!comparator) {
    return data;
  }
  if (!sortAscending) {
    const ascendingComparator = comparator;
    comparator = (a, b): number => -ascendingComparator(a, b);
  }
  return data.toSorted(comparator);
});

const virtualRows = new VirtualRows<T>();

const virtualized: boolean = $derived(
  virtualization === 'always' || (virtualization === 'auto' && sortedData.length > VIRTUALIZATION_THRESHOLD),
);

// the rows to render, and the spacers taking the place of the rows not rendered when virtualized
const renderedEntries: (T | VirtualSpacer)[] = $derived(
  virtualized
    ? virtualRows
        .getEntries(sortedData)
        .map(entry => (entry instanceof VirtualSpacer ? entry : sortedData[entry.index]!))
    : sortedData,
);

function getDisplayedChildren(object: T): T[] {
  return collapsed.includes(key(object)) ? [] : (row.info.children?.(object) ?? []);
}

// the index of each row for accessibility (aria-rowindex) and the total number of rows (aria-rowcount),
// counting the header row and the displayed children rows, as not all the rows are in the DOM
// when the table is virtualized
const rowsIndexing: { indexes: Map<T, number>; count: number } = $derived.by(() => {
  // a new map is computed on each change, it is never modified afterwards
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const indexes = new Map<T, number>();
  // the header row has the index 1
  let index = 2;
  for (const object of sortedData) {
    indexes.set(object, index);
    index += 1 + getDisplayedChildren(object).length;
  }
  return { indexes, count: index - 1 };
});

function sort(column: Column<T>): void {
  if (!column?.info.comparator) {
    // column is not sortable
    return;
  }

  if (sortCol === column) {
    sortAscending = !sortAscending;
  } else {
    sortCol = column;
    sortAscending = column.info.initialOrder ? column.info.initialOrder !== 'descending' : true;
  }
}

onMount(() => {
  const column: Column<T> | undefined = columns.find(column => column.title === defaultSortColumn);
  if (column?.info.comparator) {
    sortCol = column;
    sortAscending = column.info.initialOrder ? column.info.initialOrder !== 'descending' : true;
  }
});

const gridTemplateColumns: string = $derived.by(() => {
  // section and checkbox columns
  let columnWidths: string[] = ['20px'];

  if (row.info.selectable) {
    columnWidths.push('32px');
  }

  // custom columns
  visibleColumns.map(c => c.info.width ?? '1fr').forEach(w => columnWidths.push(w));

  if (enableLayoutConfiguration && tablePersistence) {
    // Add space for settings icon in header (32px)
    columnWidths.push('32px');
  } else {
    // final spacer
    columnWidths.push('5px');
  }

  return columnWidths.join(' ');
});

function toggleChildren(name: string | undefined): void {
  if (!name) {
    return;
  }
  collapsed = collapsed.includes(name) ? collapsed.filter(item => item !== name) : [...collapsed, name];
  collapsedStateMap.set(kind, [...collapsed]);
}

// Handle column order changes from ListOrganizer
function handleColumnOrderChange(newOrdering: SvelteMap<string, number>): void {
  setColumnOrdering(newOrdering);
}

// Handle column toggle changes from ListOrganizer
function handleColumnToggle(itemId: string, enabled: boolean): void {
  columnItems = columnItems.map(item => (item.id === itemId ? { ...item, enabled } : item));
}

// Reset columns to default state and clear saved configuration
async function resetColumns(): Promise<void> {
  try {
    if (enableLayoutConfiguration && tablePersistence.storage) {
      columnItems = await tablePersistence.storage.reset(
        kind,
        columns.map(col => col.title),
      );
      columnOrdering.clear();
    } else {
      columnItems = getDefaultColumnItems();
      columnOrdering.clear();
    }
  } catch (error: unknown) {
    console.error(`Failed to reset column configuration in table ${kind}: ${error}`);
    // Fallback to default configuration
    columnItems = getDefaultColumnItems();
    columnOrdering.clear();
  }
}

const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label, [role="button"], [role="menuitem"], [role="checkbox"], [role="switch"]';

function isRowClickable(object: T): boolean {
  return !!row.info.onClick && (row.info.clickable?.(object) ?? true);
}

function eventTargetElement(event: MouseEvent): Element | undefined {
  if (event.target instanceof Element) {
    return event.target;
  }
  if (event.target instanceof Text) {
    return event.target.parentElement ?? undefined;
  }
  return undefined;
}

function isInteractiveClick(event: MouseEvent, rowElement: HTMLElement): boolean {
  const target = eventTargetElement(event);
  if (!target || !rowElement.contains(target)) {
    return false;
  }

  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

function shouldIgnoreRowClick(rowElement: HTMLElement, event: MouseEvent): boolean {
  const target = eventTargetElement(event);

  // Clicks on the row background / CSS grid gaps must navigate.
  if (!target || target === rowElement) {
    return false;
  }

  // Do not stopPropagation: Svelte 5 delegates onclick to the document, so
  // stopping at a cell prevents action buttons from receiving the click.
  if (isInteractiveClick(event, rowElement)) {
    return true;
  }

  const cell = target.closest('[role="cell"]');
  if (!cell || !rowElement.contains(cell)) {
    return true;
  }

  const cells = Array.from(rowElement.querySelectorAll(':scope > [role="cell"]'));
  const cellIndex = cells.indexOf(cell as HTMLElement);
  if (cellIndex < 0) {
    return true;
  }

  const columnIndex = cellIndex - (row.info.selectable ? 2 : 1);
  if (columnIndex < 0) {
    // Expander and checkbox columns: allow navigation unless an interactive control handled above.
    return false;
  }

  if (columnIndex >= visibleColumns.length) {
    return true;
  }

  return visibleColumns[columnIndex].info.excludeFromRowClick === true;
}

function invokeRowClick(object: T, rowElement: HTMLElement, event: Event): void {
  if (!isRowClickable(object) || !row.info.onClick) {
    return;
  }

  if (event instanceof MouseEvent && shouldIgnoreRowClick(rowElement, event)) {
    return;
  }

  row.info.onClick(object, event);
}

function handleRowClick(object: T, event: MouseEvent): void {
  invokeRowClick(object, event.currentTarget as HTMLElement, event);
}

function handleRowKeyDown(object: T, event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  const rowElement = event.currentTarget as HTMLElement;
  if (event.target !== rowElement) {
    return;
  }

  event.preventDefault();
  invokeRowClick(object, rowElement, event);
}
</script>

<div
  style="--table-grid-table-columns: {gridTemplateColumns}"
  class="w-full mx-5"
  class:hidden={data.length === 0}
  role="table"
  aria-label={kind}
  aria-rowcount={rowsIndexing.count}>
  <!-- Table header -->
  <div role="rowgroup" class="relative">
    <div
      class="grid grid-table gap-x-0.5 h-7 sticky top-0 text-[var(--pd-table-header-text)] uppercase z-2"
      role="row"
      aria-rowindex={1}>
      <div class="whitespace-nowrap justify-self-start" role="columnheader"></div>
      {#if row.info.selectable}
        <div class="whitespace-nowrap place-self-center" role="columnheader">
          <Checkbox
            title="Toggle all"
            checked={selectedAllCheckboxes}
            disabled={!row.info.selectable || selectableObjects.length === 0}
            indeterminate={selectedCount > 0 && !selectedAllCheckboxes}
            onclick={toggleAll} />
        </div>
      {/if}
      {#each visibleColumns as column, index (index)}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-interactive-supports-focus -->
        <div
          class="max-w-full overflow-hidden flex flex-row text-sm font-semibold items-center whitespace-nowrap {column
            .info.align === 'right'
            ? 'justify-self-end'
            : column.info.align === 'center'
              ? 'justify-self-center'
              : 'justify-self-start'} self-center select-none"
          class:cursor-pointer={column.info.comparator}
          onclick={(): void => sort(column)}
          role="columnheader">
          <div class="overflow-hidden text-ellipsis">
            {column.title}
          </div>
          {#if column.info.comparator}<i
              class="fas pl-0.5"
              class:fa-sort={sortCol !== column}
              class:fa-sort-up={sortCol === column && sortAscending}
              class:fa-sort-down={sortCol === column && !sortAscending}
              class:text-[var(--pd-table-header-unsorted)]={sortCol !== column}
              aria-hidden="true"></i
            >{/if}
        </div>
      {/each}
      <!-- Empty space for settings - only when layout configuration is enabled -->
      {#if enableLayoutConfiguration && tablePersistence.storage}
        <div class="whitespace-nowrap justify-self-end place-self-center" role="columnheader"></div>
      {/if}
    </div>

    <!-- Settings - only show when layout configuration is enabled -->
    {#if enableLayoutConfiguration && tablePersistence.storage}
      <div class="absolute top-0 right-0 h-7 flex items-center pr-2 z-10">
        <ListOrganizer
          items={columnItems}
          ordering={columnOrdering}
          title="Configure Columns"
          enableReorder={true}
          enableToggle={true}
          onOrderChange={handleColumnOrderChange}
          onToggle={handleColumnToggle}
          onReset={resetColumns}
          resetButtonLabel="Reset to default"
        />
      </div>
    {/if}
  </div>
  <!-- Table body -->
  <div role="rowgroup" {@attach virtualized ? virtualRows.body : undefined}>
    {#each renderedEntries as entry (entry instanceof VirtualSpacer ? entry.key : entry)}
      {#if entry instanceof VirtualSpacer}
        <div role="presentation" aria-hidden="true" style="height: {entry.height}px"></div>
      {:else}
      {@const object = entry}
      {@const children = row.info.children?.(object) ?? []}
      {@const itemKey = key(object)}
      {@const rowIndex = rowsIndexing.indexes.get(object) ?? 0}
      <div
        class="min-h-[48px] h-fit bg-[var(--pd-content-card-bg)] rounded-lg mb-2 border border-[var(--pd-content-table-border)]"
        {@attach virtualized ? virtualRows.row(object) : undefined}>
        <div
          class="grid grid-table gap-x-0.5 min-h-[48px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pd-button-focus-ring)]"
          class:group={!!row.info.onClick}
          class:hover:bg-[var(--pd-content-card-hover-bg)]={!row.info.onClick}
          class:rounded-t-lg={!collapsed.includes(itemKey) &&
            children.length > 0}
          class:rounded-lg={collapsed.includes(itemKey) ||
            children.length === 0}
          class:cursor-pointer={isRowClickable(object)}
          role="row"
          aria-rowindex={rowIndex}
          tabindex={isRowClickable(object) ? 0 : undefined}
          aria-label={label(object)}
          draggable={row.info.draggable?.(object) ? 'true' : undefined}
          data-row-key={row.info.draggable ? itemKey : undefined}
          onclick={(event): void => handleRowClick(object, event)}
          onkeydown={(event): void => handleRowKeyDown(object, event)}>
          <div
            class="whitespace-nowrap place-self-center"
            class:group-hover:bg-[var(--pd-content-card-hover-bg)]={row.info.onClick && isRowClickable(object)}
            role="cell">
            {#if children.length > 0}
              <button
                title={collapsed.includes(itemKey) ? 'Expand Row' : 'Collapse Row'}
                aria-expanded={!collapsed.includes(itemKey)}
                onclick={(): void => toggleChildren(itemKey)}
              >
                <ChevronExpander
                  expanded={!collapsed.includes(itemKey)}
                  size="0.8x"
                  class="text-[var(--pd-table-body-text)] cursor-pointer" />
              </button>
            {/if}
          </div>
          {#if row.info.selectable}
            <div class="whitespace-nowrap place-self-center" role="cell">
              <Checkbox
                title="Toggle {kind}"
                checked={isSelected(object)}
                disabled={!row.info.selectable(object)}
                disabledTooltip={row.info.disabledText}
                onclick={(checked): void => objectChecked(object, checked)} />
            </div>
          {/if}
          {#each visibleColumns as column, index (index)}
            <div
              class="whitespace-nowrap {column.info.align === 'right'
                ? 'justify-self-end'
                : column.info.align === 'center'
                  ? 'justify-self-center'
                  : 'justify-self-start'} self-center {column.info.overflow === true
                ? ''
                : 'overflow-hidden'} max-w-full py-1.5"
              class:col-span-2={index === visibleColumns.length - 1 && enableLayoutConfiguration && tablePersistence.storage}
              class:group-hover:bg-[var(--pd-content-card-hover-bg)]={row.info.onClick &&
                isRowClickable(object) &&
                !column.info.excludeFromRowClick}
              class:opacity-50={row.info.onClick && !isRowClickable(object) && !column.info.excludeFromRowClick}
              class:cursor-default={column.info.excludeFromRowClick && isRowClickable(object)}
              role="cell">
              {#if column.info.renderer}
                {@const Renderer = column.info.renderer}
                <Renderer object={column.info.renderMapping ? column.info.renderMapping(object) : object} />
              {/if}
            </div>
          {/each}
        </div>

        <!-- Child objects -->
        {#if !collapsed.includes(itemKey) && children.length > 0}
          {#each children as child, i (child)}
            <div
              class="grid grid-table gap-x-0.5 hover:bg-[var(--pd-content-card-hover-bg)]"
              class:rounded-b-lg={i === children.length - 1}
              role="row"
              aria-rowindex={rowIndex + 1 + i}
              aria-label={child.name}>
              <div class="whitespace-nowrap justify-self-start" role="cell"></div>
              {#if row.info.selectable}
                <div class="whitespace-nowrap place-self-center" role="cell">
                  <Checkbox
                    title="Toggle {kind}"
                    checked={isSelected(child)}
                    disabled={!row.info.selectable(child)}
                    disabledTooltip={row.info.disabledText}
                    onclick={(checked): void => childChecked(child, checked)} />
                </div>
              {/if}
              {#each visibleColumns as column, index (index)}
                <div
                  class="whitespace-nowrap {column.info.align === 'right'
                    ? 'justify-self-end'
                    : column.info.align === 'center'
                      ? 'justify-self-center'
                      : 'justify-self-start'} self-center {column.info.overflow === true
                    ? ''
                    : 'overflow-hidden'} max-w-full py-1.5"
                  class:col-span-2={index === visibleColumns.length - 1 && enableLayoutConfiguration && tablePersistence.storage}
                  role="cell">
                  {#if column.info.renderer}
                    {@const Renderer = column.info.renderer}
                    <Renderer object={column.info.renderMapping ? column.info.renderMapping(child) : child} />
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
      {/if}
    {/each}
  </div>
</div>
