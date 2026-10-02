<script lang="ts">
import '@xterm/xterm/css/xterm.css';

import { TerminalSettings } from '@podman-desktop/core-api/terminal';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { type IDisposable, Terminal } from '@xterm/xterm';
import { onDestroy, onMount } from 'svelte';

import { getTerminalTheme } from '/@/lib/terminal/terminal-theme';
import { terminalStates } from '/@/stores/kubernetes-terminal-state-store';

// A shell session in a container: `sessionKey` identifies the session, which is kept open when the component
// is destroyed (its output is saved and restored when a component is created again for the same session)
interface Props {
  sessionKey: string;
  namespace?: string;
  podName: string;
  containerName: string;
}

let { sessionKey, namespace, podName, containerName }: Props = $props();

interface State {
  terminal: string;
}

let terminalXtermDiv: HTMLElement;
let shellTerminal: Terminal | undefined;
let serializeAddon: SerializeAddon | undefined;
let fitAddon: FitAddon | undefined;
let resizeObserver: ResizeObserver | undefined;
let id: number | undefined;
let onDataDisposable: IDisposable | undefined;
let destroyed = false;

onMount(async () => {
  const savedState = getSavedTerminalState(sessionKey);
  await initializeNewTerminal();

  // If there is a saved state with information in the terminal, we will write it to the terminal (it was serialized into a string before using the SerializeAddon)
  if (savedState?.terminal) {
    shellTerminal?.write(savedState.terminal);
    shellTerminal?.focus();
  }
});

onDestroy(() => {
  destroyed = true;
  resizeObserver?.disconnect();
  if (serializeAddon) {
    saveTerminalState(sessionKey, { terminal: serializeAddon.serialize() });
    serializeAddon.dispose();
  }
  // the session is kept open, but its output is not sent to this component anymore
  if (id !== undefined) {
    window.kubernetesExecDetach(id).catch((err: unknown) => console.error('Error detaching from the session', err));
  }
  onDataDisposable?.dispose();
  shellTerminal?.dispose();
});

async function exec(): Promise<number> {
  return window.kubernetesExec(
    sessionKey,
    namespace,
    podName,
    containerName,
    (data: Buffer) => {
      shellTerminal?.write(data);
    },
    (data: Buffer) => {
      shellTerminal?.write(data);
    },
    reconnect,
  );
}

function listenInput(terminal: Terminal): void {
  onDataDisposable?.dispose();
  onDataDisposable = terminal.onData(data => {
    if (id !== undefined) {
      window.kubernetesExecSend(id, data).catch((err: unknown) => console.error('Error sending data', err));
    }
  });
}

// the shell exited (or the connection has been closed): a new shell is started
function reconnect(): void {
  if (destroyed) {
    return;
  }
  exec()
    .then(execId => {
      id = execId;
      shellTerminal?.clear();
      if (shellTerminal) {
        listenInput(shellTerminal);
      }
      resize().catch(console.error);
    })
    .catch((err: unknown) => console.error(`Error executing pod ${podName} container ${containerName}`, err));
}

async function resize(): Promise<void> {
  if (!shellTerminal || !fitAddon || !terminalXtermDiv.clientWidth || !terminalXtermDiv.clientHeight) {
    return;
  }
  fitAddon.fit();
  if (id !== undefined) {
    await window.kubernetesExecResize(id, shellTerminal.cols, shellTerminal.rows);
  }
}

async function initializeNewTerminal(): Promise<void> {
  const fontSize = await window.getConfigurationValue<number>(
    TerminalSettings.SectionName + '.' + TerminalSettings.FontSize,
  );
  const lineHeight = await window.getConfigurationValue<number>(
    TerminalSettings.SectionName + '.' + TerminalSettings.LineHeight,
  );
  const scrollback = await window.getConfigurationValue<number>(
    TerminalSettings.SectionName + '.' + TerminalSettings.Scrollback,
  );

  const terminal = new Terminal({
    fontSize,
    lineHeight,
    screenReaderMode: true,
    theme: getTerminalTheme(),
    scrollback,
  });
  shellTerminal = terminal;

  id = await exec();
  listenInput(terminal);

  fitAddon = new FitAddon();
  serializeAddon = new SerializeAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);
  terminal.open(terminalXtermDiv);

  // the terminal is resized with its pane (window resize, split, sash moves, ...)
  let resizeFrame: number | undefined;
  resizeObserver = new ResizeObserver(() => {
    if (resizeFrame !== undefined) {
      cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      resize().catch(console.error);
    });
  });
  resizeObserver.observe(terminalXtermDiv);
  await resize();
}

function getSavedTerminalState(key: string): State | undefined {
  let state;
  terminalStates.subscribe(states => {
    state = states.get(key);
  })();
  return state ? (state as unknown as State) : undefined;
}

function saveTerminalState(key: string, state: State): void {
  terminalStates.update(states => {
    states.set(key, state);
    return states;
  });
}
</script>

<div
  class="h-full w-full p-[5px] pr-0 bg-[var(--pd-terminal-background)]"
  aria-label="Terminal of {containerName}"
  bind:this={terminalXtermDiv}>
</div>
