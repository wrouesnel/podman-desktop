<script context="module" lang="ts">
/* eslint-disable sonarjs/no-use-of-empty-return-value -- {@render} is valid Svelte 5 syntax */
import { Table, TableColumn, TableDurationColumn, TableRow, TableSimpleColumn } from '@podman-desktop/ui-svelte';
import { type Args, defineMeta, type StoryContext } from '@storybook/addon-svelte-csf';
import { fn } from 'storybook/test';

import RowClickActionsColumn from './table/RowClickActionsColumn.svelte';

/**
 * These are the stories for the `Table` component.
 * Allow to display a table.
 */
const { Story } = defineMeta({
  component: Table,
  render: template,
  title: 'Table',
  tags: ['autodocs'],
  args: {},
});

type Person = {
  name: string;
  duration?: number;
  selected?: boolean;
};

const people: Person[] = [
  { name: 'John', duration: new Date().getTime() - 600000, selected: false },
  { name: 'Henry', duration: new Date().getTime(), selected: false },
  { name: 'Charlie', duration: new Date().getTime() - 3600000, selected: false },
];

type Group = {
  name: string;
};

const group: Group[] = [{ name: 'Teacher' }, { name: 'Student' }];

// a large list, to show the virtualization of the rows (only the visible rows are rendered)
const manyPeople: Person[] = Array.from({ length: 5000 }, (_, index) => ({
  name: `Person ${index}`,
  duration: new Date().getTime() - index * 60000,
  selected: false,
}));

const nameCol: TableColumn<Person, string> = new TableColumn('Name', {
  renderMapping: obj => obj.name,
  renderer: TableSimpleColumn,
});

const durationCol = new TableColumn<Person, Date | undefined>('Duration', {
  renderMapping: (obj): Date | undefined => (obj.duration ? new Date(obj.duration) : undefined),
  renderer: TableDurationColumn,
});

const actionsCol = new TableColumn<Person, Person>('Actions', {
  align: 'right',
  width: '120px',
  renderMapping: (obj): Person => obj,
  renderer: RowClickActionsColumn,
  excludeFromRowClick: true,
});

const columns = [nameCol, durationCol];
const selectable = (_person: Person): boolean => true;
const row = new TableRow<Person>({
  selectable,
  disabledText: 'cannot be selected',
});

const rowClickFn = fn().mockName('rowClick');

const rowClickRow = new TableRow<Person>({
  onClick: (person, event): void => {
    rowClickFn(person.name, event.type);
  },
  clickable: (person): boolean => person.name !== 'Henry',
  selectable,
  disabledText: 'Row is not navigable',
});

const rowGroup = new TableRow<Group, Person>({
  children: (group: Group): Array<Person> => {
    switch (group.name) {
      case 'Teacher':
        return [people[0]];
      case 'Student':
        return [people[1], people[2]];
      default:
        return [];
    }
  },
});
</script>

{#snippet template({ _children, ...args }: Args<typeof Story>, _context: StoryContext<typeof Story>)}
  <Table {...args}></Table>
{/snippet}

<!-- the rows are virtualized in their scroll container, as in the pages of the application -->
{#snippet scrollableTemplate(args: Args<typeof Story>, context: StoryContext<typeof Story>)}
  <div style="height: 600px; overflow-y: auto">
    {@render template(args, context)}
  </div>
{/snippet}

<Story
  name="Basic"
  args={{
    data: people,
    columns,
    row,
  }} />

<Story
  name="Children"
  args={{
    data: group,
    columns: [nameCol],
    row: rowGroup,
  }} />

<Story
  name="Row Click"
  args={{
    kind: 'row-click-demo',
    data: people,
    columns: [nameCol, durationCol, actionsCol],
    row: rowClickRow,
  }} />

<Story
  name="Large table"
  template={scrollableTemplate}
  args={{
    kind: 'people',
    data: manyPeople,
    columns,
    row,
  }} />
