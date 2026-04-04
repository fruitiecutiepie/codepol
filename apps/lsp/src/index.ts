#!/usr/bin/env node

import { CodepolLspServer } from './server';

function frameWrite(payload: unknown): void {
  const json = JSON.stringify(payload);
  const content = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${content.length}\r\n\r\n`, 'utf8');
  process.stdout.write(Buffer.concat([header, content]));
}

const server = new CodepolLspServer({
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

    void server.handleMessage(JSON.parse(payload) as never);
  }
});

process.stdin.resume();
