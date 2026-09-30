<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import type { KubernetesObject } from '@kubernetes/client-node';
import type { IDisposable } from '@podman-desktop/core-api';
import type { TableColumn, TableRow } from '@podman-desktop/ui-svelte';
import { Button, FilteredEmptyScreen, NavPage, Table } from '@podman-desktop/ui-svelte';
import { onDestroy, onMount, type Snippet } from 'svelte';
import { type Readable, type Unsubscriber, type Writable } from 'svelte/store';

import { withBulkConfirmation } from '/@/lib/actions/BulkActions';
import KubeActions from '/@/lib/kube/KubeActions.svelte';
import NamespaceDropdown from '/@/lib/kube/NamespaceDropdown.svelte';
import { listenResources } from '/@/lib/kube/resources-listen';
import KubernetesCurrentContextConnectionBadge from '/@/lib/ui/KubernetesCurrentContextConnectionBadge.svelte';

import type { KubernetesObjectUI } from './KubernetesObjectUI';

export interface Kind {
  resource: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformer: (o: KubernetesObject) => KubernetesObjectUI;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete: (name: string, object?: any) => Promise<void>;
  isResource: (o: KubernetesObject) => boolean;
  legacySearchPatternStore: Writable<string>;
  legacyObjectStore: Readable<KubernetesObject[]>;
}

interface Props {
  kinds: Kind[];
  searchTerm: string;
  singular: string;
  plural: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: TableColumn<any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: TableRow<any>;
  // defaults to true for nodes only
  hideNamespaceDropdown?: boolean;

  emptySnippet: Snippet;
}

let started = $state<boolean>(false);

let {
  kinds,
  singular,
  plural,
  icon,
  searchTerm,
  columns,
  row,
  hideNamespaceDropdown = kinds[0]?.resource === 'nodes',
  emptySnippet,
}: Props = $props();

// raw state: the resources are replaced on each update, and must not be deeply proxied
let resources = $state.raw<{ [key: string]: KubernetesObject[] | undefined }>({});
let resourceListeners: (IDisposable | undefined)[] = [];
let legacyUnsubscribers: Unsubscriber[] = [];

// The UI objects built during the previous update, by resource and uid.
// When a resource did not change (same resourceVersion), its UI object is reused,
// so the table does not render its row again, and the row keeps its state (selection, ...).
// The UI objects are reactive, so the changes done by the actions (status, ...) are rendered.
interface CachedUIObject {
  transformer: Kind['transformer'];
  resourceVersion: string;
  ui: KubernetesObjectUI;
}
let uiObjectsCache = new Map<string, CachedUIObject>();

function createUIObject(kind: Kind, object: KubernetesObject, previous?: KubernetesObjectUI): KubernetesObjectUI {
  const ui = kind.transformer(object);
  // keep the selection of the previous version of the object
  if (previous && 'selected' in previous && 'selected' in ui) {
    ui.selected = previous.selected;
  }
  const reactiveUI = $state(ui);
  return reactiveUI;
}

function transform(kind: Kind, object: KubernetesObject, newCache: Map<string, CachedUIObject>): KubernetesObjectUI {
  const uid = object.metadata?.uid;
  const resourceVersion = object.metadata?.resourceVersion;
  if (!uid || !resourceVersion) {
    return createUIObject(kind, object);
  }
  const key = `${kind.resource}/${uid}`;
  const cached = uiObjectsCache.get(key);
  let ui: KubernetesObjectUI;
  // objects marked as being deleted by an action are built again, so the status is reset if the deletion failed
  if (
    cached?.resourceVersion === resourceVersion &&
    cached.transformer === kind.transformer &&
    cached.ui.status !== 'DELETING'
  ) {
    ui = cached.ui;
  } else {
    ui = createUIObject(kind, object, cached?.ui);
  }
  newCache.set(key, { transformer: kind.transformer, resourceVersion, ui });
  return ui;
}

const objects = $derived.by(() => {
  const newCache = new Map<string, CachedUIObject>();
  const result = kinds.flatMap(
    kind => resources[kind.resource]?.map(object => transform(kind, object, newCache)) ?? [],
  );
  uiObjectsCache = newCache;
  return result;
});

$effect(() => {
  kinds.forEach(kind => kind.legacySearchPatternStore.set(searchTerm));
});

onMount(async () => {
  for (let kind of kinds) {
    resourceListeners.push(
      await listenResources(
        kind.resource,
        {
          searchTermStore: kind.legacySearchPatternStore,
        },
        (updatedResources: KubernetesObject[]) => {
          started = true;
          resources = { ...resources, [kind.resource]: updatedResources };
        },
      ),
    );

    legacyUnsubscribers.push(
      kind.legacyObjectStore.subscribe(o => {
        if (o === undefined) {
          return;
        }
        started = true;
        resources = { ...resources, [kind.resource]: o };
      }),
    );
  }
});

onDestroy(() => {
  for (let resourceListener of resourceListeners) {
    resourceListener?.dispose();
  }
  for (let legacyUnsubscriber of legacyUnsubscribers) {
    legacyUnsubscriber?.();
  }
});

// delete the items selected in the list
let bulkDeleteInProgress = $state<boolean>(false);
async function deleteSelectedObjects(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedObjects = objects.filter((object: any) => object?.selected);
  if (selectedObjects.length === 0) {
    return;
  }

  // mark objects for deletion
  bulkDeleteInProgress = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedObjects.forEach((image: any) => (image.status = 'DELETING'));

  await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selectedObjects.map(async (object: any) => {
      try {
        await kinds.find(kind => kind.isResource(object))?.delete(object.name, object);
      } catch (e) {
        console.error(`error while deleting ${singular}`, e);
      }
    }),
  );
  bulkDeleteInProgress = false;
}

let selectedItemsNumber = $state<number>(0);
</script>

<NavPage bind:searchTerm={searchTerm} title={plural}>
  {#snippet additionalActions()}
    <KubeActions />
  {/snippet}

  {#snippet bottomAdditionalActions()}
    {#if !hideNamespaceDropdown}
      <NamespaceDropdown/>
    {/if}
    {#if selectedItemsNumber > 0}
      <Button
        on:click={(): void =>
          withBulkConfirmation(
            deleteSelectedObjects,
            `delete ${selectedItemsNumber} ${selectedItemsNumber > 1 ? plural : singular}`,
            { title: `Delete ${plural.charAt(0).toUpperCase() + plural.slice(1)}?`, variant:'delete' }
          )}
        title="Delete {selectedItemsNumber} selected items"
        inProgress={bulkDeleteInProgress}
        icon={faTrash} />
      <span>On {selectedItemsNumber} selected items.</span>
    {/if}
    <div class="flex grow justify-end">
      <KubernetesCurrentContextConnectionBadge />
    </div>
  {/snippet}

  {#snippet content()}
  <div class="flex min-w-full grow">
    <Table
      kind={singular}
      bind:selectedItemsNumber={selectedItemsNumber}
      data={objects}
      columns={columns}
      row={row}
      defaultSortColumn="Name">
    </Table>

    {#if started && objects.length === 0}
      {#if searchTerm}
        <FilteredEmptyScreen
          icon={icon}
          kind={plural}
          searchTerm={searchTerm}
          on:resetFilter={(): string => (searchTerm = '')} />
      {:else}
        {@render emptySnippet()}
      {/if}
    {/if}
  </div>
  {/snippet}
</NavPage>
