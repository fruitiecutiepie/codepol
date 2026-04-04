import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CodepolLspServer } from '../apps/lsp/src/server';

function tempWorkspaceCreate(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function noInterfaceConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["src"]
`;
}

describe('CodepolLspServer', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('publishes diagnostics across open, change, and close', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const messages: any[] = [];
    const server = new CodepolLspServer({
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fs.readFileSync(filePath, 'utf8'),
        },
      },
    });

    const firstPublish = messages.find((message) => message.method === 'textDocument/publishDiagnostics');
    expect(firstPublish?.params.diagnostics).toHaveLength(1);

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'export type User = {\n  name: string;\n};\n' }],
      },
    });

    const publishMessages = messages.filter((message) => message.method === 'textDocument/publishDiagnostics');
    expect(publishMessages[1]?.params.diagnostics).toEqual([]);

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didClose',
      params: {
        textDocument: { uri },
      },
    });

    const finalPublish = messages.filter((message) => message.method === 'textDocument/publishDiagnostics')[2];
    expect(finalPublish?.params.diagnostics).toHaveLength(1);
  });

  it('returns code actions and applies edit plans through workspace/applyEdit', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const messages: any[] = [];
    const server = new CodepolLspServer({
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fs.readFileSync(filePath, 'utf8'),
        },
      },
    });

    const publish = messages.find((message) => message.method === 'textDocument/publishDiagnostics');
    const diagnostic = publish?.params.diagnostics[0];
    expect(diagnostic).toBeDefined();

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri },
        context: {
          diagnostics: [diagnostic],
        },
      },
    });

    const codeActionResponse = messages.find((message) => message.id === 2);
    expect(codeActionResponse?.result).toHaveLength(1);

    const executePromise = server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'workspace/executeCommand',
      params: codeActionResponse.result[0].command,
    });

    await Promise.resolve();
    const applyEditRequest = messages.find((message) => message.method === 'workspace/applyEdit');
    expect(applyEditRequest?.params.edit.changes[uri]).toHaveLength(1);

    await server.handleMessage({
      jsonrpc: '2.0',
      id: applyEditRequest.id,
      result: { applied: true },
    });
    await executePromise;

    const executeResponse = messages.find((message) => message.id === 3);
    expect(executeResponse?.result).toBeNull();
  });
});
