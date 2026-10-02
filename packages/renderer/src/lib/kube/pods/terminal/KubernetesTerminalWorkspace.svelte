<style>
/* dockview theme using the colors of Podman Desktop */
:global(.dockview-theme-podman-desktop) {
  --dv-paneview-active-outline-color: var(--pd-tab-highlight);
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 32px;
  --dv-drag-over-background-color: color-mix(in srgb, var(--pd-tab-highlight) 25%, transparent);
  --dv-drag-over-border-color: var(--pd-tab-highlight);
  --dv-tabs-container-scrollbar-color: var(--pd-content-divider);
  --dv-icon-hover-background-color: var(--pd-content-card-hover-bg);
  --dv-group-view-background-color: var(--pd-terminal-background);
  --dv-tabs-and-actions-container-background-color: var(--pd-content-card-bg);
  --dv-activegroup-visiblepanel-tab-background-color: var(--pd-terminal-background);
  --dv-activegroup-hiddenpanel-tab-background-color: var(--pd-content-card-bg);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(--pd-terminal-background);
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(--pd-content-card-bg);
  --dv-activegroup-visiblepanel-tab-color: var(--pd-tab-text-highlight);
  --dv-activegroup-hiddenpanel-tab-color: var(--pd-tab-text);
  --dv-inactivegroup-visiblepanel-tab-color: var(--pd-tab-text);
  --dv-inactivegroup-hiddenpanel-tab-color: var(--pd-tab-text);
  --dv-tab-divider-color: var(--pd-content-divider);
  --dv-separator-border: var(--pd-content-divider);
  --dv-paneview-header-border-color: var(--pd-content-divider);
  --dv-sash-color: transparent;
  --dv-active-sash-color: var(--pd-tab-highlight);
}
</style>

<script lang="ts">
import 'dockview-core/dist/styles/dockview.css';

import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, Dropdown, EmptyScreen } from '@podman-desktop/ui-svelte';
import {
  createDockview,
  type DockviewApi,
  type DockviewTheme,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
} from 'dockview-core';
import { mount, onDestroy, onMount, unmount } from 'svelte';
import { get } from 'svelte/store';

import type { PodUI } from '/@/lib/kube/pods/PodUI';
import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { terminalStates } from '/@/stores/kubernetes-terminal-state-store';
import {
  getTerminalWorkspaceKey,
  terminalWorkspaces,
  type TerminalWorkspaceState,
} from '/@/stores/kubernetes-terminal-workspace-store';

import KubernetesTerminal from './KubernetesTerminal.svelte';
import { getPanelTitle, getRunningContainers, getSessionKey, type TerminalPanelParams } from './terminal-workspace';

// The terminals of a pod: one tab per shell, the tabs can be dragged to split the view in several panes
interface Props {
  pod: PodUI;
}
let { pod }: Props = $props();

const theme: DockviewTheme = { name: 'podman-desktop', className: 'dockview-theme-podman-desktop' };

let dockviewElement: HTMLDivElement;
let api: DockviewApi | undefined;
// set while the workspace is being destroyed: the panels removed by dockview keep their session
let disposing = false;
let panelCount = $state(0);

// the namespace and name of the pod when the workspace was created (the props can change before onDestroy)
const namespace = pod.namespace;
const podName = pod.name;
const workspaceKey = getTerminalWorkspaceKey(namespace, podName);
let workspace: TerminalWorkspaceState = { sessionKeys: [], shellCounters: {} };

const runningContainers = $derived(getRunningContainers(pod.containers));
let selectedContainer = $state('');
$effect(() => {
  if (!runningContainers.includes(selectedContainer)) {
    selectedContainer = runningContainers[0] ?? '';
  }
});

// a dockview panel rendering a terminal
class TerminalPanel implements IContentRenderer {
  readonly element = document.createElement('div');
  #component: ReturnType<typeof mount> | undefined;

  init(parameters: GroupPanelPartInitParameters): void {
    this.element.className = 'h-full w-full';
    const params = parameters.params as unknown as TerminalPanelParams;
    this.#component = mount(KubernetesTerminal, { target: this.element, props: params });
  }

  dispose(): void {
    if (this.#component) {
      unmount(this.#component).catch((err: unknown) => console.error('Error unmounting the terminal', err));
    }
  }
}

export function openShell(containerName: string): void {
  if (!api) {
    return;
  }
  const shellNumber = (workspace.shellCounters[containerName] ?? 0) + 1;
  workspace.shellCounters[containerName] = shellNumber;
  const sessionKey = getSessionKey(namespace, podName, containerName, shellNumber);
  workspace.sessionKeys.push(sessionKey);
  const params: TerminalPanelParams = { sessionKey, namespace, podName, containerName };
  api.addPanel({
    id: sessionKey,
    component: 'terminal',
    title: getPanelTitle(containerName, shellNumber),
    params: params as unknown as Record<string, unknown>,
  });
}

// the user closed a tab: its session is closed
function onPanelRemoved(params: TerminalPanelParams | undefined): void {
  if (disposing || !params) {
    return;
  }
  workspace.sessionKeys = workspace.sessionKeys.filter(key => key !== params.sessionKey);
  window
    .kubernetesExecClose(params.sessionKey)
    .catch((err: unknown) => console.error(`Error closing the session ${params.sessionKey}`, err));
  terminalStates.update(states => {
    states.delete(params.sessionKey);
    return states;
  });
}

onMount(() => {
  api = createDockview(dockviewElement, {
    theme,
    disableFloatingGroups: true,
    createComponent: (): IContentRenderer => new TerminalPanel(),
  });
  api.onDidAddPanel(() => (panelCount = api?.panels.length ?? 0));
  api.onDidRemovePanel(panel => {
    panelCount = api?.panels.length ?? 0;
    onPanelRemoved(panel.params as unknown as TerminalPanelParams | undefined);
  });

  const saved = get(terminalWorkspaces).get(workspaceKey);
  if (saved?.layout && saved.sessionKeys.length > 0) {
    workspace = { ...saved, sessionKeys: [...saved.sessionKeys], shellCounters: { ...saved.shellCounters } };
    try {
      api.fromJSON(saved.layout);
      panelCount = api.panels.length;
      return;
    } catch (err: unknown) {
      console.error('Error restoring the terminal layout', err);
      api.clear();
    }
  }
  // new workspace: one shell per running container
  workspace = { sessionKeys: [], shellCounters: {} };
  runningContainers.forEach(openShell);
});

onDestroy(() => {
  if (!api) {
    return;
  }
  disposing = true;
  const layout = api.toJSON();
  terminalWorkspaces.update(workspaces => {
    workspaces.set(workspaceKey, { ...workspace, layout });
    return workspaces;
  });
  api.dispose();
});
</script>

<div class="flex flex-col h-full w-full">
  <div class="flex items-center gap-2 py-2 px-2 h-[44px] text-sm text-[var(--pd-content-text)]">
    <span class="whitespace-nowrap">New shell in</span>
    {#if runningContainers.length > 1}
      <Dropdown
        class="w-48"
        ariaLabel="Container"
        value={selectedContainer}
        onChange={(value: string): string => (selectedContainer = value)}
        options={runningContainers.map(container => ({ label: container, value: container }))} />
    {:else}
      <span class="font-bold" aria-label="Container">{selectedContainer || 'no running container'}</span>
    {/if}
    <Button
      icon={faPlus}
      title="Open a new shell in {selectedContainer}"
      aria-label="Open shell"
      disabled={!selectedContainer}
      onclick={(): void => openShell(selectedContainer)}>Open</Button>
    <span class="grow"></span>
    <span class="text-[var(--pd-content-text-sub)]">Drag a tab to an edge to split the view</span>
  </div>
  <div class="relative flex grow w-full min-h-0">
    <div class="absolute inset-0" bind:this={dockviewElement}></div>
    {#if panelCount === 0}
      <div class="absolute inset-0">
        <EmptyScreen
          icon={NoLogIcon}
          title="No Terminal"
          message={runningContainers.length ? 'Open a shell in a container' : 'No container is running'} />
      </div>
    {/if}
  </div>
</div>
