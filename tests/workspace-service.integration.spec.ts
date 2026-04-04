import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspacePathToUri } from '@codepol/core';
import { workspaceServiceCreate } from '@codepol/workspace-service';

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

function unusedExportsConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-unused-exports"
targets = ["src"]
`;
}

async function clientWorkspaceAttach(
  service: ReturnType<typeof workspaceServiceCreate>,
  input: {
    rootPath: string;
    configPath: string;
    clientKind?: 'lsp' | 'cli' | 'test';
    clientInstanceId?: string;
  },
): Promise<{ clientSessionId: string; workspaceId: string; workspaceInstanceId: string }> {
  const registered = await service.registerClientSession({
    clientKind: input.clientKind ?? 'test',
    clientInstanceId: input.clientInstanceId ?? 'vitest',
  });
  const attached = await service.attachWorkspace({
    clientSessionId: registered.clientSessionId,
    rootPath: input.rootPath,
    configPath: input.configPath,
  });
  return {
    clientSessionId: registered.clientSessionId,
    workspaceId: attached.workspaceId,
    workspaceInstanceId: attached.workspaceInstanceId,
  };
}

describe('workspace service integration', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses overlays for diagnostics and reverts to disk on close', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });

    const diskDiagnostics = await service.queryDiagnostics({
      clientSessionId,
      workspaceId,
      uri,
    });
    expect(diskDiagnostics).toHaveLength(1);

    await service.openOverlay({
      clientSessionId,
      workspaceId,
      uri,
      version: 1,
      text: 'export type User = {\n  name: string;\n};\n',
    });
    const overlayDiagnostics = await service.queryDiagnostics({
      clientSessionId,
      workspaceId,
      uri,
    });
    expect(overlayDiagnostics).toEqual([]);

    await service.closeOverlay({ clientSessionId, workspaceId, uri });
    const revertedDiagnostics = await service.queryDiagnostics({
      clientSessionId,
      workspaceId,
      uri,
    });
    expect(revertedDiagnostics).toHaveLength(1);
  });

  it('rejects stale edit-plan application after the document version changes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    await service.openOverlay({
      clientSessionId,
      workspaceId,
      uri,
      version: 1,
      text: fs.readFileSync(filePath, 'utf8'),
    });

    const diagnostics = await service.queryDiagnostics({ clientSessionId, workspaceId, uri });
    const actions = await service.queryCodeActions({
      clientSessionId,
      workspaceId,
      uri,
      version: 1,
      diagnosticIds: [diagnostics[0]!.id],
    });

    expect(actions).toHaveLength(1);

    await service.updateOverlay({
      clientSessionId,
      workspaceId,
      uri,
      version: 2,
      text: 'export interface User {\n  email: string;\n}\n',
    });

    const applyResult = await service.applyEditPlan({
      clientSessionId,
      workspaceId,
      planId: actions[0]!.plan.id,
      documentVersions: {
        [uri]: 1,
      },
    });

    expect(applyResult).toEqual({
      applied: false,
      failureReason: 'stale_document_version',
    });
  });

  it('refreshes cross-file diagnostics from overlay text using the project index', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), unusedExportsConfigContentCreate(), 'utf8');

    const exporterPath = path.join(workspaceRoot, 'src', 'exporter.ts');
    const importerPath = path.join(workspaceRoot, 'src', 'importer.ts');
    const exporterUri = workspacePathToUri(exporterPath);
    const importerUri = workspacePathToUri(importerPath);

    fs.writeFileSync(exporterPath, 'export const sharedValue = 1;\n', 'utf8');
    fs.writeFileSync(
      importerPath,
      "import { sharedValue } from './exporter';\nexport const value = sharedValue;\n",
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });

    expect(
      await service.queryDiagnostics({
        clientSessionId,
        workspaceId,
        uri: exporterUri,
      }),
    ).toEqual([]);

    await service.openOverlay({
      clientSessionId,
      workspaceId,
      uri: importerUri,
      version: 1,
      text: 'export const value = 1;\n',
    });

    const updatedDiagnostics = await service.queryDiagnostics({
      clientSessionId,
      workspaceId,
      uri: exporterUri,
    });
    expect(updatedDiagnostics).toHaveLength(1);
    expect(updatedDiagnostics[0]?.code).toBe('@codepol/plugin/no-unused-exports');

    await service.closeOverlay({ clientSessionId, workspaceId, uri: importerUri });
    expect(
      await service.queryDiagnostics({
        clientSessionId,
        workspaceId,
        uri: exporterUri,
      }),
    ).toEqual([]);
  });

  it('isolates overlays, diagnostics, and code-action plans per client session', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const service = workspaceServiceCreate();
    const clientA = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      clientInstanceId: 'client-a',
    });
    const clientB = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      clientInstanceId: 'client-b',
    });

    await service.openOverlay({
      clientSessionId: clientA.clientSessionId,
      workspaceId: clientA.workspaceId,
      uri,
      version: 1,
      text: 'export type User = {\n  name: string;\n};\n',
    });
    await service.openOverlay({
      clientSessionId: clientB.clientSessionId,
      workspaceId: clientB.workspaceId,
      uri,
      version: 1,
      text: fs.readFileSync(filePath, 'utf8'),
    });

    expect(
      await service.queryDiagnostics({
        clientSessionId: clientA.clientSessionId,
        workspaceId: clientA.workspaceId,
        uri,
      }),
    ).toEqual([]);

    const clientBDiagnostics = await service.queryDiagnostics({
      clientSessionId: clientB.clientSessionId,
      workspaceId: clientB.workspaceId,
      uri,
    });
    expect(clientBDiagnostics).toHaveLength(1);

    const clientBActions = await service.queryCodeActions({
      clientSessionId: clientB.clientSessionId,
      workspaceId: clientB.workspaceId,
      uri,
      version: 1,
      diagnosticIds: [clientBDiagnostics[0]!.id],
    });
    expect(clientBActions).toHaveLength(1);

    const clientAApplyResult = await service.applyEditPlan({
      clientSessionId: clientA.clientSessionId,
      workspaceId: clientA.workspaceId,
      planId: clientBActions[0]!.plan.id,
      documentVersions: {
        [uri]: 1,
      },
    });
    expect(clientAApplyResult).toEqual({
      applied: false,
      failureReason: 'plan_not_found',
    });

    await service.closeOverlay({
      clientSessionId: clientA.clientSessionId,
      workspaceId: clientA.workspaceId,
      uri,
    });
    const revertedClientADiagnostics = await service.queryDiagnostics({
      clientSessionId: clientA.clientSessionId,
      workspaceId: clientA.workspaceId,
      uri,
    });
    expect(revertedClientADiagnostics).toHaveLength(1);
  });

  it('reports per-session index status from cold to ready', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const service = workspaceServiceCreate();
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      clientInstanceId: 'status-client',
    });

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toEqual({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'cold',
      indexedFileCount: 0,
      openDocumentCount: 0,
      overlayCount: 0,
      analysisGeneration: 0,
      lastError: undefined,
    });

    await service.queryDiagnostics({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      openDocumentCount: 0,
      overlayCount: 0,
      analysisGeneration: 1,
    });
  });
});
