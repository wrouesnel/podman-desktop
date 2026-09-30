<script lang="ts">
import type { CoreV1Event, KubernetesObject } from '@kubernetes/client-node';
import type { IDisposable } from '@podman-desktop/core-api';
import { EmptyScreen, StatusIcon, Tab } from '@podman-desktop/ui-svelte';
import { onDestroy, onMount } from 'svelte';
import { router } from 'tinro';
import { stringify } from 'yaml';

import MonacoEditor from '/@/lib/editor/MonacoEditor.svelte';
import KubeIcon from '/@/lib/images/KubeIcon.svelte';
import KubeEditYAML from '/@/lib/kube/KubeEditYAML.svelte';
import { listenResource } from '/@/lib/kube/resource-listen';
import DetailsPage from '/@/lib/ui/DetailsPage.svelte';
import StateChange from '/@/lib/ui/StateChange.svelte';
import { getTabUrl, isTabSelected } from '/@/lib/ui/Util';
import Route from '/@/Route.svelte';
import { isKubernetesExperimentalModeStore } from '/@/stores/kubernetes-experimental';
import { kubernetesResourceDescriptors } from '/@/stores/kubernetes-resource-descriptors';

import { NO_NAMESPACE } from './kube-resource-descriptor';
import { getKubeResourceUI } from './kube-resource-utils';
import KubeResourceActions from './KubeResourceActions.svelte';
import KubeResourceDetailsSummary from './KubeResourceDetailsSummary.svelte';

interface Props {
  // the resource name of the type of the object (statefulsets, ...)
  resource: string;
  name: string;
  // NO_NAMESPACE for non-namespaced resources
  namespace: string;
}
let { resource, name, namespace }: Props = $props();

const descriptor = $derived($kubernetesResourceDescriptors.find(d => d.info.resource === resource));

let detailsPage = $state<DetailsPage | undefined>();
let kubeObject = $state<KubernetesObject | undefined>();
let events = $state<CoreV1Event[]>([]);

const resourceUI = $derived(descriptor && kubeObject ? getKubeResourceUI(descriptor, kubeObject) : undefined);

let listener: IDisposable | undefined;

onMount(async () => {
  listener = await listenResource({
    resourceName: resource,
    name,
    namespace: namespace === NO_NAMESPACE ? undefined : namespace,
    listenEvents: namespace !== NO_NAMESPACE,
    onResourceNotFound: () => {
      // the resource has been deleted
      detailsPage?.close();
    },
    onResourceUpdated: (updated: KubernetesObject) => {
      kubeObject = updated;
    },
    onEventsUpdated: (updatedEvents: CoreV1Event[]) => {
      events = updatedEvents;
    },
  });
});

onDestroy(() => {
  listener?.dispose();
});
</script>

{#if $isKubernetesExperimentalModeStore === false}
  <EmptyScreen
    icon={KubeIcon}
    title="Experimental Kubernetes mode required"
    message="Enable the experimental Kubernetes states setting to browse this resource type" />
{:else if descriptor && resourceUI}
  <DetailsPage title={resourceUI.name} subtitle={resourceUI.namespace ?? descriptor.singular} bind:this={detailsPage}>
    {#snippet iconSnippet()}
      <StatusIcon icon={KubeIcon} size={24} status={resourceUI.status} />
    {/snippet}
    {#snippet actionsSnippet()}
      <KubeResourceActions resource={resourceUI} detailed={true} />
    {/snippet}
    {#snippet detailSnippet()}
      <div class="flex py-2 w-full justify-end text-sm text-[var(--pd-content-text)]">
        <StateChange state={resourceUI.status} />
      </div>
    {/snippet}
    {#snippet tabsSnippet()}
      <Tab title="Summary" selected={isTabSelected($router.path, 'summary')} url={getTabUrl($router.path, 'summary')} />
      <Tab title="Inspect" selected={isTabSelected($router.path, 'inspect')} url={getTabUrl($router.path, 'inspect')} />
      <Tab title="Kube" selected={isTabSelected($router.path, 'kube')} url={getTabUrl($router.path, 'kube')} />
    {/snippet}
    {#snippet contentSnippet()}
      <Route path="/summary" breadcrumb="Summary" navigationHint="tab">
        <KubeResourceDetailsSummary descriptor={descriptor} object={kubeObject} events={events} />
      </Route>
      <Route path="/inspect" breadcrumb="Inspect" navigationHint="tab">
        <MonacoEditor content={JSON.stringify(kubeObject, undefined, 2)} language="json" />
      </Route>
      <Route path="/kube" breadcrumb="Kube" navigationHint="tab">
        <KubeEditYAML content={stringify(kubeObject)} />
      </Route>
    {/snippet}
  </DetailsPage>
{/if}
