<script lang="ts">
import type { KubernetesObject } from '@kubernetes/client-node';
import { EmptyScreen, TableColumn, TableDurationColumn, TableRow, TableSimpleColumn } from '@podman-desktop/ui-svelte';
import moment from 'moment';
import { readable, writable } from 'svelte/store';

import KubeIcon from '/@/lib/images/KubeIcon.svelte';
import StatusColumn from '/@/lib/kube/column/Status.svelte';
import KubernetesEmptyScreen from '/@/lib/kube/KubernetesEmptyScreen.svelte';
import KubernetesObjectsList from '/@/lib/objects/KubernetesObjectsList.svelte';
import { isKubernetesExperimentalModeStore } from '/@/stores/kubernetes-experimental';
import { kubernetesResourceDescriptors } from '/@/stores/kubernetes-resource-descriptors';

import ActionsColumn from './columns/Actions.svelte';
import NameColumn from './columns/Name.svelte';
import type { KubeResourceDescriptor } from './kube-resource-descriptor';
import { deleteKubeResource, getKubeResourceUI } from './kube-resource-utils';
import type { KubeResourceUI } from './KubeResourceUI';

interface Props {
  // the resource name of the type to list (statefulsets, ...)
  resource: string;
  searchTerm?: string;
}
let { resource, searchTerm = '' }: Props = $props();

const descriptor = $derived($kubernetesResourceDescriptors.find(d => d.info.resource === resource));

type KubeResourceColumn =
  | TableColumn<KubeResourceUI>
  | TableColumn<KubeResourceUI, string>
  | TableColumn<KubeResourceUI, Date | undefined>;

function getColumns(descriptor: KubeResourceDescriptor): KubeResourceColumn[] {
  return [
    new TableColumn<KubeResourceUI>('Status', {
      align: 'center',
      width: '70px',
      renderer: StatusColumn,
      comparator: (a, b): number => a.status.localeCompare(b.status),
    }),
    new TableColumn<KubeResourceUI>('Name', {
      width: '1.3fr',
      renderer: NameColumn,
      comparator: (a, b): number => a.name.localeCompare(b.name),
    }),
    ...descriptor.columns.map(
      (column, index) =>
        new TableColumn<KubeResourceUI, string>(column.title, {
          renderMapping: (object): string => object.values[index] ?? '',
          renderer: TableSimpleColumn,
          comparator: (a, b): number =>
            (a.values[index] ?? '').localeCompare(b.values[index] ?? '', undefined, { numeric: true }),
        }),
    ),
    new TableColumn<KubeResourceUI, Date | undefined>('Age', {
      renderMapping: (object): Date | undefined => object.created,
      renderer: TableDurationColumn,
      comparator: (a, b): number => moment(b.created).diff(moment(a.created)),
    }),
    new TableColumn<KubeResourceUI>('Actions', { align: 'right', renderer: ActionsColumn }),
  ];
}

const row = new TableRow<KubeResourceUI>({ selectable: (_object): boolean => true });
</script>

{#if $isKubernetesExperimentalModeStore === false}
  <EmptyScreen
    icon={KubeIcon}
    title="Experimental Kubernetes mode required"
    message="Enable the experimental Kubernetes states setting to browse this resource type" />
{:else if descriptor}
  {#key descriptor.info.resource}
    <KubernetesObjectsList
      kinds={[{
        resource: descriptor.info.resource,
        transformer: (object: KubernetesObject): KubeResourceUI => getKubeResourceUI(descriptor, object),
        delete: (_name: string, object?: KubeResourceUI): Promise<void> =>
          object ? deleteKubeResource(object) : Promise.resolve(),
        isResource: (): boolean => true,
        legacySearchPatternStore: writable(''),
        legacyObjectStore: readable<KubernetesObject[]>(),
      }]}
      singular={descriptor.singular}
      plural={descriptor.label}
      icon={KubeIcon}
      searchTerm={searchTerm}
      columns={getColumns(descriptor)}
      row={row}
      hideNamespaceDropdown={!descriptor.info.namespaced}>
      <!-- eslint-disable-next-line sonarjs/no-unused-vars -->
      {#snippet emptySnippet()}
        <KubernetesEmptyScreen
          icon={KubeIcon}
          resources={[descriptor.info.resource]}
          titleEmpty="No {descriptor.label}"
          titleNotPermitted="{descriptor.label} not accessible"
          message={descriptor.info.namespaced ? 'Try switching to a different context or namespace' : 'Try switching to a different context'} />
      {/snippet}
    </KubernetesObjectsList>
  {/key}
{/if}
