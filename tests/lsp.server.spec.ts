import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceService } from '@codepol/workspace-service';
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

  it('registers a client session and attaches the workspace during initialize', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const calls: string[] = [];
    const service: WorkspaceService = {
      async registerClientSession() {
        calls.push('registerClientSession');
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {
        calls.push('closeClientSession');
      },
      async attachWorkspace() {
        calls.push('attachWorkspace');
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async openOverlay() {
        calls.push('openOverlay');
      },
      async updateOverlay() {
        calls.push('updateOverlay');
      },
      async closeOverlay() {
        calls.push('closeOverlay');
      },
      async queryDiagnostics() {
        calls.push('queryDiagnostics');
        return [];
      },
      async queryCodeActions() {
        calls.push('queryCodeActions');
        return [];
      },
      async applyEditPlan() {
        calls.push('applyEditPlan');
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        calls.push('queryIndexStatus');
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const server = new CodepolLspServer({
      service,
      sendMessage: () => {},
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    expect(calls).toEqual(['registerClientSession', 'attachWorkspace']);
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

  it('returns code actions for a related diagnostic range when the editor sends no diagnostic ids', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export const x = 1;\nexport default x;\n', 'utf8');
    const uri = pathToFileURL(filePath).href;

    const seenDiagnosticIds: string[][] = [];
    const service: WorkspaceService = {
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        return [
          {
            id: 'diag-1',
            uri,
            source: 'codepol',
            code: 'no-mixed-exports',
            severity: 'error',
            message: 'Do not mix default exports with named exports in the same module; prefer named exports for mixed modules.',
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 16 },
            },
            relatedLocations: [
              {
                uri,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 19 },
                },
                message: 'Additional export in mixed module',
              },
            ],
          },
        ];
      },
      async queryCodeActions(input) {
        seenDiagnosticIds.push(input.diagnosticIds ?? []);
        if (!input.diagnosticIds?.includes('diag-1')) {
          return [];
        }
        return [
          {
            id: 'action-1',
            title: 'Fix no-mixed-exports',
            kind: 'quickfix',
            diagnosticIds: ['diag-1'],
            isPreferred: true,
            plan: {
              id: 'plan-1',
              title: 'Fix no-mixed-exports',
              kind: 'quickfix',
              edits: [],
              diagnosticIds: ['diag-1'],
              isPreferred: true,
            },
          },
        ];
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const messages: any[] = [];
    const server = new CodepolLspServer({
      service,
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
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        context: {
          diagnostics: [],
        },
      },
    });

    const codeActionResponse = messages.find((message) => message.id === 2);
    expect(codeActionResponse?.result).toHaveLength(1);
    expect(seenDiagnosticIds).toEqual([['diag-1']]);
  });

  it('publishes same-file related locations as separate diagnostics that keep the primary fix id', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export const x = 1;\nexport default x;\n', 'utf8');
    const uri = pathToFileURL(filePath).href;

    const service: WorkspaceService = {
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        return [
          {
            id: 'diag-1',
            uri,
            source: 'codepol',
            code: 'no-mixed-exports',
            severity: 'error',
            message: 'Do not mix default exports with named exports in the same module; prefer named exports for mixed modules.',
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 16 },
            },
            relatedLocations: [
              {
                uri,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 19 },
                },
                message: 'Additional export in mixed module',
              },
            ],
          },
        ];
      },
      async queryCodeActions(input) {
        if (!input.diagnosticIds?.includes('diag-1')) {
          return [];
        }
        return [
          {
            id: 'action-1',
            title: 'Fix no-mixed-exports',
            kind: 'quickfix',
            diagnosticIds: ['diag-1'],
            isPreferred: true,
            plan: {
              id: 'plan-1',
              title: 'Fix no-mixed-exports',
              kind: 'quickfix',
              edits: [],
              diagnosticIds: ['diag-1'],
              isPreferred: true,
            },
          },
        ];
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const messages: any[] = [];
    const server = new CodepolLspServer({
      service,
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
    expect(publish?.params.diagnostics).toHaveLength(2);
    expect(publish?.params.diagnostics[1]?.message).toBe('Additional export in mixed module');
    expect(publish?.params.diagnostics[1]?.data?.id).toBe('diag-1');

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri },
        range: publish.params.diagnostics[1].range,
        context: {
          diagnostics: [publish.params.diagnostics[1]],
        },
      },
    });

    const codeActionResponse = messages.find((message) => message.id === 2);
    expect(codeActionResponse?.result).toHaveLength(1);
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
