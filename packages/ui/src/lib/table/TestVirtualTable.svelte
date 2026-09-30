<script lang="ts">
import SimpleColumn from './SimpleColumn.svelte';
import { Column, Row } from './table';
import Table from './Table.svelte';

interface Item {
  name: string;
  selected?: boolean;
}

interface Props {
  items: Item[];
  virtualization?: 'auto' | 'always' | 'never';
}

let { items, virtualization }: Props = $props();

let selectedItemsNumber: number | undefined = $state();

const columns = [
  new Column<Item, string>('Name', {
    renderMapping: (item): string => item.name,
    renderer: SimpleColumn,
  }),
];

const row = new Row<Item>({ selectable: (): boolean => true });
</script>

<div aria-label="scroller" style="overflow-y: auto; height: 580px">
  <Table kind="item" data={items} columns={columns} row={row} virtualization={virtualization} bind:selectedItemsNumber={selectedItemsNumber} />
</div>
<span aria-label="selected count">{selectedItemsNumber}</span>
