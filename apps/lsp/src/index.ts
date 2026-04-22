#!/usr/bin/env node

import { diagnosticsRuntimeSetOverrides } from '@codepol/core';
import { workspaceTypeAwareBridgeProviderCreate } from '@codepol/type-aware-provider';
import type { WorkspaceService } from '@codepol/workspace-service/contracts';
import { codepolLspEditorTypeAwareProviderCreate } from './editorTypeAwareProvider';
import { CodepolLspServer } from './server';
import {
  lspWorkspaceServiceResolve,
  type LspWorkspaceServiceResolvedInfo,
} from './serviceFactory';

// The LSP uses stdout for the JSON-RPC protocol itself, so the structured
// stdout sink would corrupt it. Force the console sink (which writes to
// stderr) before any diagnostics are emitted by this process.
diagnosticsRuntimeSetOverrides({ sinks: ['console'] });

function frameWrite(payload: unknown): void {
  const json = JSON.stringify(payload);
  const content = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${content.length}\r\n\r\n`, 'utf8');
  process.stdout.write(Buffer.concat([header, content]));
}

function workspaceServiceModeLog(info: LspWorkspaceServiceResolvedInfo): void {
  if (info.mode === 'daemon') {
    const daemonState = info.launched ? 'launched' : 'connected';
    process.stderr.write(`[codepol-lsp] workspace service mode: daemon (${daemonState})\n`);
    return;
  }

  if (info.mode === 'in_process_fallback') {
    process.stderr.write(
      `[codepol-lsp] workspace service mode: in_process (daemon fallback: ${info.error.message})\n`,
    );
    return;
  }

  process.stderr.write('[codepol-lsp] workspace service mode: in_process\n');
}

const clientInstanceId = `codepol-lsp-${process.pid}`;
let server: CodepolLspServer;
const serviceFactory = async (): Promise<WorkspaceService> =>
  await lspWorkspaceServiceResolve({
    clientInstanceId,
    onResolved: workspaceServiceModeLog,
    typeAwareBridgeProvider: await workspaceTypeAwareBridgeProviderCreate({
      env: process.env,
      editorBackend: {
        backendId: 'lsp-client-editor',
        runtimeCreate: async () =>
          codepolLspEditorTypeAwareProviderCreate({
            clientRequest: (method, params) => server.requestClient(method, params),
          }),
      },
    }),
  });
server = new CodepolLspServer({
  clientInstanceId,
  serviceFactory,
  sendMessage: frameWrite,
});

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const separator = buffer.indexOf('\r\n\r\n');
    if (separator === -1) {
      return;
    }

    const header = buffer.subarray(0, separator).toString('utf8');
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = Buffer.alloc(0);
      return;
    }

    const contentLength = Number(lengthMatch[1]);
    const bodyStart = separator + 4;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) {
      return;
    }

    const payload = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
    buffer = buffer.subarray(bodyEnd);

    void server.handleMessage(JSON.parse(payload) as never).catch((error: unknown) => {
      const message = error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
      process.stderr.write(`[codepol-lsp] unhandled message error: ${message}\n`);
    });
  }
});

process.stdin.resume();
