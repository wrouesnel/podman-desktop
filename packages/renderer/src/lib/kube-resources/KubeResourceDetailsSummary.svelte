<script lang="ts">
import type { CoreV1Event, KubernetesObject } from '@kubernetes/client-node';

import Cell from '/@/lib/details/DetailsCell.svelte';
import Table from '/@/lib/details/DetailsTable.svelte';
import Title from '/@/lib/details/DetailsTitle.svelte';
import ConditionsTable from '/@/lib/kube/details/ConditionsTable.svelte';
import KubeEventsArtifact from '/@/lib/kube/details/KubeEventsArtifact.svelte';
import KubeObjectMetaArtifact from '/@/lib/kube/details/KubeObjectMetaArtifact.svelte';

import { getValue, type KubeResourceDescriptor } from './kube-resource-descriptor';

interface Condition {
  type: string;
  status: string;
  lastTransitionTime?: Date;
  reason?: string;
  message?: string;
}

interface Props {
  descriptor: KubeResourceDescriptor;
  object?: KubernetesObject;
  events: CoreV1Event[];
}

let { descriptor, object, events }: Props = $props();

const details = $derived(
  object
    ? descriptor.columns
        .map(column => ({ title: column.title, value: column.value(object) }))
        .filter(detail => detail.value !== undefined && detail.value !== '')
    : [],
);

const conditions = $derived.by((): Condition[] => {
  const value = getValue(object, 'status.conditions');
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(c => typeof c?.type === 'string' && typeof c?.status === 'string')
    .map(c => ({
      ...c,
      lastTransitionTime: c.lastTransitionTime ? new Date(c.lastTransitionTime) : undefined,
    }));
});
</script>

<Table>
  {#if object}
    <KubeObjectMetaArtifact artifact={object.metadata} />
    {#if details.length > 0}
      <tr>
        <Title>Details</Title>
      </tr>
      {#each details as detail (detail.title)}
        <tr>
          <Cell>{detail.title}</Cell>
          <Cell>{detail.value}</Cell>
        </tr>
      {/each}
    {/if}
    {#if conditions.length > 0}
      <tr>
        <Title>Conditions</Title>
      </tr>
      <ConditionsTable conditions={conditions} />
    {/if}
    {#if descriptor.info.namespaced}
      <KubeEventsArtifact events={events} />
    {/if}
  {:else}
    <p class="text-[var(--pd-state-info)] font-medium">Loading...</p>
  {/if}
</Table>
