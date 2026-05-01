#!/usr/bin/env node

import { diagnosticsRuntimeGet, diagnosticsRuntimeSetOverrides } from '@codepol/core';
import { CodepolLspServer } from './server';
import {
  lspWorkspaceServiceResolve,
  type LspWorkspaceServiceResolvedInfo,
} from './serviceFactoryBundled';

diagnosticsRuntimeSetOverrides({ sinks: ['console'] });
diagnosticsRuntimeGet().getDiagnostics('lsp.process').info('lsp.process.boot', {
  pid: process.pid,
  entry: 'indexBundled',
});

function frameWrite(payload: unknown): void {
  const json = JSON.stringify(payload);
  const content = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${content.length}\r\n\r\n`, 'utf8');
  process.stdout.write(Buffer.concat([header, content]));
}

function workspaceServiceModeLog(info: LspWorkspaceServiceResolvedInfo): void {
  const daemonState = info.launched ? 'launched' : 'connected';
  process.stderr.write(`[codepol-lsp] workspace service mode: daemon (${daemonState})\n`);
}

const clientInstanceId = `codepol-lsp-${process.pid}`;
const server = new CodepolLspServer({
  clientInstanceId,
  serviceFactory: () =>
    lspWorkspaceServiceResolve({
      clientInstanceId,
      onResolved: workspaceServiceModeLog,
    }),
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
      diagnosticsRuntimeGet()
        .getDiagnostics('lsp.transport')
        .warn('lsp.stdin.bad_content_length_header', { headerPreview: header.slice(0, 200) });
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

    void server.handleMessage(JSON.parse(payload) as never).catch((error) => {
      const message = error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
      process.stderr.write(`[codepol-lsp] unhandled message error: ${message}\n`);
    });
  }
});

process.stdin.resume();
