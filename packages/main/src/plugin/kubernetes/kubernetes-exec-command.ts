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

import { PassThrough, type Readable, Transform, type TransformCallback, Writable } from 'node:stream';

import type { KubeConfig, V1Status } from '@kubernetes/client-node';
import { Exec } from '@kubernetes/client-node';

// the data sent to the websocket is buffered by the websocket when the network is slower than the source:
// the source is paused while more than this amount of data is waiting to be sent
const STDIN_HIGH_WATER_MARK = 4 * 1024 * 1024;
const STDIN_BUFFER_POLL_MS = 10;

export interface ExecCommandOptions {
  // data sent to the standard input of the command (its end closes the standard input)
  stdin?: Readable;
  // receives the standard output of the command (ended when the command terminates);
  // when not set, the standard output is collected and returned
  stdout?: Writable;
  // aborts the command (closes the connection)
  signal?: AbortSignal;
}

export interface ExecCommandResult {
  // the exit code of the command, undefined if the server did not report it
  exitCode: number | undefined;
  // the collected standard output, when no stdout stream is given
  stdout: string;
  stderr: string;
}

// minimal interface of the websocket returned by Exec.exec
interface ExecConnection {
  bufferedAmount: number;
  close(): void;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

// getExitCode returns the exit code reported in the status of an exec command
export function getExitCode(status: V1Status): number | undefined {
  if (status.status === 'Success') {
    return 0;
  }
  const exitCode = status.details?.causes?.find(cause => cause.reason === 'ExitCode')?.message;
  if (exitCode !== undefined && /^\d+$/.test(exitCode)) {
    return Number(exitCode);
  }
  // failure not related to the exit code of the command (e.g. the command cannot be executed)
  return status.status === 'Failure' ? -1 : undefined;
}

class CollectingWritable extends Writable {
  readonly chunks: Buffer[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get text(): string {
    return Buffer.concat(this.chunks).toString('utf-8');
  }
}

// pauses the data sent to the websocket while it is buffering too much data
class WebSocketBackpressure extends Transform {
  constructor(private readonly connection: () => ExecConnection | undefined) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const send = (): void => {
      const conn = this.connection();
      if (conn && conn.bufferedAmount > STDIN_HIGH_WATER_MARK) {
        setTimeout(send, STDIN_BUFFER_POLL_MS);
        return;
      }
      callback(null, chunk);
    };
    send();
  }
}

/**
 * Executes a (non interactive) command in a container, and resolves when the command terminates.
 * The command is given as arguments (no shell is involved). The standard input and output are binary streams.
 */
export async function execCommand(
  kubeConfig: KubeConfig,
  namespace: string,
  podName: string,
  containerName: string,
  command: string[],
  options: ExecCommandOptions = {},
): Promise<ExecCommandResult> {
  if (options.signal?.aborted) {
    throw new Error('the command has been cancelled');
  }
  const stderr = new CollectingWritable();
  const collectedStdout = options.stdout ? undefined : new CollectingWritable();
  const stdout = options.stdout ?? collectedStdout;

  const stdin = options.stdin ? new PassThrough() : undefined;
  let exitCode: number | undefined;
  let statusReceived = false;

  const exec = new Exec(kubeConfig);
  const connection = (await exec.exec(
    namespace,
    podName,
    containerName,
    command,
    stdout ?? null,
    stderr,
    stdin ?? null,
    false,
    (status: V1Status) => {
      statusReceived = true;
      exitCode = getExitCode(status);
    },
  )) as unknown as ExecConnection;

  return new Promise<ExecCommandResult>((resolve, reject) => {
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      connection.close();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let streamError: Error | undefined;
    if (options.stdin && stdin) {
      options.stdin
        .on('error', err => {
          streamError = err;
          connection.close();
        })
        .pipe(new WebSocketBackpressure(() => connection))
        .pipe(stdin);
    }

    connection.on('error', err => {
      streamError ??= err;
    });
    connection.on('close', () => {
      options.signal?.removeEventListener('abort', onAbort);
      options.stdout?.end();
      if (aborted) {
        reject(new Error('the command has been cancelled'));
      } else if (streamError) {
        reject(streamError);
      } else {
        resolve({
          exitCode: statusReceived ? exitCode : undefined,
          stdout: collectedStdout?.text ?? '',
          stderr: stderr.text,
        });
      }
    });
  });
}
