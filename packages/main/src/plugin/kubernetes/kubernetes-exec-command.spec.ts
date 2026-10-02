/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { PassThrough, Readable, Writable } from 'node:stream';

import type { V1Status } from '@kubernetes/client-node';
import { Exec, KubeConfig } from '@kubernetes/client-node';
import { beforeEach, expect, test, vi } from 'vitest';

import { execCommand, getExitCode } from './kubernetes-exec-command.js';

vi.mock(import('@kubernetes/client-node'), async importOriginal => {
  const original = await importOriginal();
  return { ...original, Exec: vi.fn() };
});

interface FakeExec {
  stdout: Writable | null;
  stderr: Writable | null;
  stdin: Readable | null;
  tty: boolean;
  command: string | string[];
  status: (status: V1Status) => void;
  conn: { bufferedAmount: number; close: () => void; on: (event: string, listener: () => void) => void };
  closeListeners: (() => void)[];
  stdinData: Buffer[];
}

let fake: FakeExec;
const kubeConfig = new KubeConfig();

beforeEach(() => {
  vi.resetAllMocks();
  // a class: Exec is instantiated with new
  const execFn = vi.fn(
    async (
      _ns: string,
      _pod: string,
      _container: string,
      command: string | string[],
      stdout: Writable | null,
      stderr: Writable | null,
      stdin: Readable | null,
      tty: boolean,
      status: (status: V1Status) => void,
    ) => {
      const closeListeners: (() => void)[] = [];
      fake = {
        stdout,
        stderr,
        stdin,
        tty,
        command,
        status,
        closeListeners,
        stdinData: [],
        conn: {
          bufferedAmount: 0,
          close: vi.fn(() => closeListeners.forEach(listener => listener())),
          on: (event: string, listener: () => void): void => {
            if (event === 'close') closeListeners.push(listener);
          },
        },
      };
      stdin?.on('data', (chunk: Buffer) => fake.stdinData.push(chunk));
      return fake.conn;
    },
  );
  vi.mocked(Exec).mockImplementation(
    class {
      exec = execFn;
    } as unknown as typeof Exec,
  );
});

// simulates the end of the command: status then websocket close
function terminate(status: V1Status): void {
  fake.status(status);
  fake.closeListeners.forEach(listener => listener());
}

test('getExitCode', () => {
  expect(getExitCode({ status: 'Success' })).toBe(0);
  expect(
    getExitCode({
      status: 'Failure',
      reason: 'NonZeroExitCode',
      details: { causes: [{ reason: 'ExitCode', message: '2' }] },
    }),
  ).toBe(2);
  expect(getExitCode({ status: 'Failure', message: 'executable file not found' })).toBe(-1);
  expect(getExitCode({})).toBeUndefined();
});

test('collects the output, and reports the exit code', async () => {
  const promise = execCommand(kubeConfig, 'ns1', 'pod1', 'container1', ['ls', '-la']);
  await vi.waitFor(() => expect(fake).toBeDefined());
  expect(fake.tty).toBe(false);
  expect(fake.command).toEqual(['ls', '-la']);
  expect(fake.stdin).toBeNull();
  fake.stdout?.write('out1 ');
  fake.stdout?.write('out2');
  fake.stderr?.write('err');
  terminate({ status: 'Success' });

  await expect(promise).resolves.toEqual({ exitCode: 0, stdout: 'out1 out2', stderr: 'err' });
});

test('reports a non zero exit code, and an unknown exit code when no status is received', async () => {
  const failing = execCommand(kubeConfig, 'ns1', 'pod1', 'container1', ['false']);
  await vi.waitFor(() => expect(fake).toBeDefined());
  terminate({ status: 'Failure', details: { causes: [{ reason: 'ExitCode', message: '1' }] } });
  await expect(failing).resolves.toEqual(expect.objectContaining({ exitCode: 1 }));

  const noStatus = execCommand(kubeConfig, 'ns1', 'pod1', 'container1', ['true']);
  await vi.waitFor(() => expect(fake.command).toEqual(['true']));
  fake.closeListeners.forEach(listener => listener());
  await expect(noStatus).resolves.toEqual(expect.objectContaining({ exitCode: undefined }));
});

test('sends the standard input, and writes the standard output to the given stream (ended at the end)', async () => {
  const output: Buffer[] = [];
  const stdout = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      output.push(chunk);
      callback();
    },
  });
  const finished = new Promise(resolve => stdout.on('finish', resolve));
  const promise = execCommand(kubeConfig, 'ns1', 'pod1', 'container1', ['tar', '-xf', '-'], {
    stdin: Readable.from([Buffer.from('chunk1'), Buffer.from('chunk2')]),
    stdout,
  });
  await vi.waitFor(() => expect(Buffer.concat(fake?.stdinData ?? []).toString()).toBe('chunk1chunk2'));
  fake.stdout?.write(Buffer.from([0, 1, 2]));
  terminate({ status: 'Success' });

  await expect(promise).resolves.toEqual({ exitCode: 0, stdout: '', stderr: '' });
  await finished;
  expect(Buffer.concat(output)).toEqual(Buffer.from([0, 1, 2]));
});

test('the standard input is paused while the websocket buffers too much data', async () => {
  const source = new PassThrough();
  const promise = execCommand(kubeConfig, 'ns1', 'pod1', 'container1', ['cat'], { stdin: source });
  await vi.waitFor(() => expect(fake).toBeDefined());
  fake.conn.bufferedAmount = 10 * 1024 * 1024;
  source.write(Buffer.from('waiting'));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(fake.stdinData).toHaveLength(0);

  fake.conn.bufferedAmount = 0;
  await vi.waitFor(() => expect(Buffer.concat(fake.stdinData).toString()).toBe('waiting'));
  source.end();
  terminate({ status: 'Success' });
  await promise;
});

test('aborting closes the connection and rejects', async () => {
  const controller = new AbortController();
  const promise = execCommand(kubeConfig, 'ns1', 'pod1', 'container1', ['sleep', '100'], {
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(fake).toBeDefined());
  controller.abort();

  await expect(promise).rejects.toThrow('the command has been cancelled');
  expect(fake.conn.close).toHaveBeenCalled();
});

test('an aborted signal rejects without executing the command', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    execCommand(kubeConfig, 'ns1', 'pod1', 'container1', ['ls'], { signal: controller.signal }),
  ).rejects.toThrow('the command has been cancelled');
  expect(Exec).not.toHaveBeenCalled();
});
