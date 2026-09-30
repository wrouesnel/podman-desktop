<script lang="ts">
import SimpleColumn from './SimpleColumn.svelte';
import { Column, Row } from './table';
import Table from './Table.svelte';
import TestRenderCounter from './TestRenderCounter.svelte';

export interface Item {
  name: string;
  value: string;
  selected?: boolean;
  children?: Item[];
}

interface Props {
  items: Item[];
}

let { items }: Props = $props();

let selectedItemsNumber: number | undefined = $state();

const columns = [
  new Column<Item, string>('Name', {
    renderMapping: (item): string => item.name,
    renderer: SimpleColumn,
    comparator: (a, b): number => a.name.localeCompare(b.name),
  }),
  new Column<Item>('Value', {
    renderer: TestRenderCounter,
  }),
];

const row = new Row<Item>({
  selectable: (item): boolean => !item.name.startsWith('locked'),
  children: (item): Item[] => item.children ?? [],
});
</script>

<Table kind="item" data={items} columns={columns} row={row} defaultSortColumn="Name" bind:selectedItemsNumber={selectedItemsNumber} />
<span aria-label="selected count">{selectedItemsNumber}</span>
