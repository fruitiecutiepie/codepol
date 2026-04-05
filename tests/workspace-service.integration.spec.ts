import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pluginModuleRegister,
  pluginRuleNew,
  workspacePathToUri,
} from '@codepol/core';
import {
  WorkspaceServiceEngine,
  workspaceServiceCreate,
  workspaceWarmCacheFsStoreCreate,
  type WorkspaceWatcherCreate,
} from '@codepol/workspace-service';

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

function noMixedExportsConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-mixed-exports"
targets = ["src"]
args.preferredStyle = "named"
`;
}

function biomeFailureConfigContentCreate(pluginId: string): string {
  return `[[plugins]]
id = "${pluginId}"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "${pluginId}/mock-biome"
targets = ["src"]
providers = ["biome"]
`;
}

function mockBiomeFailureScriptCreate(projectDir: string): string {
  const biomeBin = path.join(projectDir, 'mock-biome-fail.cjs');
  fs.writeFileSync(
    biomeBin,
    `#!/usr/bin/env node
process.stderr.write('mock biome failure');
process.exit(2);
`,
    'utf8',
  );
  fs.chmodSync(biomeBin, 0o755);
  return biomeBin;
}

function workspaceWatcherStubCreate(): {
  watcherCreate: WorkspaceWatcherCreate;
  trigger: (eventName: string, filePath: string) => void;
  closeCallsGet: () => number;
} {
  let listener: ((eventName: string, filePath: string) => void) | undefined;
  let closeCalls = 0;
  const watcher = {
    on(_event: 'all', nextListener: (eventName: string, filePath: string) => void) {
      listener = nextListener;
      return watcher;
    },
    async close() {
      closeCalls += 1;
    },
  };
  return {
    watcherCreate: () => watcher,
    trigger(eventName: string, filePath: string) {
      listener?.(eventName, filePath);
    },
    closeCallsGet() {
      return closeCalls;
    },
  };
}

function backgroundTaskQueueCreate(): {
  schedule: (task: () => Promise<void>) => void;
  pendingCountGet: () => number;
  runNext: () => Promise<void>;
} {
  const tasks: Array<() => Promise<void>> = [];
  return {
    schedule(task) {
      tasks.push(task);
    },
    pendingCountGet() {
      return tasks.length;
    },
    async runNext() {
      const next = tasks.shift();
      if (!next) {
        throw new Error('No background task queued');
      }
      await next();
    },
  };
}

async function clientWorkspaceAttach(
  service: ReturnType<typeof workspaceServiceCreate>,
  input: {
    rootPath: string;
    configPath: string;
    clientKind?: 'lsp' | 'cli' | 'test';
    clientInstanceId?: string;
    clientSessionId?: string;
  },
): Promise<{ clientSessionId: string; workspaceId: string; workspaceInstanceId: string }> {
  const registered = await service.registerClientSession({
    clientKind: input.clientKind ?? 'test',
    clientInstanceId: input.clientInstanceId ?? 'vitest',
    clientSessionId: input.clientSessionId,
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

  it('supports multiple service adapters over one shared engine', async () => {
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

    const engine = new WorkspaceServiceEngine();
    const writerService = workspaceServiceCreate({ engine });
    const readerService = workspaceServiceCreate({ engine });
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      clientInstanceId: 'shared-engine-client',
    });

    expect(
      await readerService.queryDiagnostics({
        clientSessionId,
        workspaceId,
        uri,
      }),
    ).toHaveLength(1);

    await writerService.openOverlay({
      clientSessionId,
      workspaceId,
      uri,
      version: 1,
      text: 'export type User = {\n  name: string;\n};\n',
    });

    expect(
      await readerService.queryDiagnostics({
        clientSessionId,
        workspaceId,
        uri,
      }),
    ).toEqual([]);
  });

  it('accepts stable client-generated session ids and re-registers them idempotently', async () => {
    const service = workspaceServiceCreate();

    const first = await service.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'stable-client',
      clientSessionId: 'client-stable-1',
    });
    const second = await service.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'stable-client',
      clientSessionId: 'client-stable-1',
    });

    expect(first).toEqual({
      clientSessionId: 'client-stable-1',
      daemonSessionId: first.daemonSessionId,
    });
    expect(second).toEqual(first);

    await expect(
      service.registerClientSession({
        clientKind: 'cli',
        clientInstanceId: 'other-client',
        clientSessionId: 'client-stable-1',
      }),
    ).rejects.toThrow('already registered with a different identity');
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

  it('rejects stale diagnostics and status reads when document or analysis freshness lags', async () => {
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
      version: 2,
      text: fs.readFileSync(filePath, 'utf8'),
    });

    await expect(
      service.queryDiagnostics({
        clientSessionId,
        workspaceId,
        uri,
        documentVersion: 1,
      }),
    ).rejects.toThrow(`Document version mismatch for ${uri}: expected 2, received 1`);

    await service.queryDiagnostics({
      clientSessionId,
      workspaceId,
      uri,
      documentVersion: 2,
    });

    await expect(
      service.queryIndexStatus({
        clientSessionId,
        workspaceId,
        analysisGeneration: 0,
      }),
    ).rejects.toThrow('Analysis generation mismatch: expected 1, received 0');
  });

  it('reports diagnostics as degraded when a lint provider fails but analysis still completes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const pluginId = `test-biome-status-${randomUUID()}`;
    const biomeBin = mockBiomeFailureScriptCreate(workspaceRoot);
    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: 'mock-biome',
          capabilities: {
            lintProviders: [
              {
                platform: 'biome',
                languages: ['typescript'],
                config: {
                  biomeBin,
                },
              },
            ],
          },
        }),
      ],
    });

    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, biomeFailureConfigContentCreate(pluginId), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

    const service = workspaceServiceCreate();
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'provider-degraded-client',
    });

    expect(
      await service.queryDiagnostics({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).toEqual([]);

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'pending',
      workspaceReady: false,
      featureStatus: {
        diagnostics: {
          readiness: 'degraded',
          detail: 'Biome lint failed: Failed to execute biome: mock biome failure',
        },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
      analysisGeneration: 1,
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
    expect(
      await service.queryIndexStatus({
        clientSessionId,
        workspaceId,
      }),
    ).toMatchObject({
      workspaceId,
      status: 'ready',
      featureStatus: {
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Session-derived index ready',
        },
      },
      analysisGeneration: 1,
    });

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
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'cold',
      replayState: 'pending',
      replayEpoch: 0,
      workspaceReady: false,
      featureStatus: {
        diagnostics: { readiness: 'cold' },
        codeActions: { readiness: 'cold' },
        editPlans: { readiness: 'cold' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
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
      replayState: 'pending',
      replayEpoch: 0,
      workspaceReady: false,
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
      openDocumentCount: 0,
      overlayCount: 0,
      analysisGeneration: 1,
    });
  });

  it('invalidates ready workspace state when watched disk files change and closes the watcher on last detach', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const watcher = workspaceWatcherStubCreate();
    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        watcherCreate: watcher.watcherCreate,
      }),
    });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'watched-disk-client',
    });

    expect(
      await service.queryDiagnostics({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);
    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'pending',
      analysisGeneration: 1,
    });

    fs.writeFileSync(
      filePath,
      'export type User = {\n  name: string;\n};\n',
      'utf8',
    );
    watcher.trigger('change', filePath);

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'cold',
      replayState: 'pending',
      analysisGeneration: 1,
    });
    expect(
      await service.queryDiagnostics({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).toEqual([]);
    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'pending',
      analysisGeneration: 2,
    });

    await service.closeClientSession({
      clientSessionId: attached.clientSessionId,
    });
    expect(watcher.closeCallsGet()).toBe(1);
  });

  it('reloads config after a watched config change invalidates the workspace', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const watcher = workspaceWatcherStubCreate();
    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        watcherCreate: watcher.watcherCreate,
      }),
    });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'watched-config-client',
    });

    expect(
      await service.queryDiagnostics({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);

    fs.writeFileSync(configPath, noMixedExportsConfigContentCreate(), 'utf8');
    watcher.trigger('change', configPath);

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'cold',
      replayState: 'pending',
      analysisGeneration: 1,
    });
    expect(
      await service.queryDiagnostics({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).toEqual([]);
    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'pending',
      analysisGeneration: 2,
    });
  });

  it('restores a persisted warm cache on attach and lets overlay replay win over it', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-writer',
    });

    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri,
      }),
    ).toHaveLength(1);
    await writerService.closeClientSession({
      clientSessionId: written.clientSessionId,
    });

    const backgroundTasks = backgroundTaskQueueCreate();
    const readerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        backgroundWarmup: true,
        backgroundTaskSchedule: backgroundTasks.schedule,
        warmCache,
      }),
    });
    const restored = await clientWorkspaceAttach(readerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-reader',
    });

    expect(
      await readerService.queryIndexStatus({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: restored.workspaceId,
      workspaceInstanceId: restored.workspaceInstanceId,
      status: 'ready',
      replayState: 'pending',
      workspaceReady: false,
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
      analysisGeneration: 1,
    });

    await readerService.completeReplay({
      clientSessionId: restored.clientSessionId,
      workspaceId: restored.workspaceId,
      workspaceInstanceId: restored.workspaceInstanceId,
    });

    expect(backgroundTasks.pendingCountGet()).toBe(0);
    expect(
      await readerService.queryDiagnostics({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
        uri,
      }),
    ).toHaveLength(1);

    await readerService.openOverlay({
      clientSessionId: restored.clientSessionId,
      workspaceId: restored.workspaceId,
      uri,
      version: 1,
      text: 'export type User = {\n  name: string;\n};\n',
    });

    expect(
      await readerService.queryDiagnostics({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
        uri,
      }),
    ).toEqual([]);
  });

  it('discards a stale warm cache when the disk-backed workspace state changes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-stale-writer',
    });
    await writerService.queryDiagnostics({
      clientSessionId: written.clientSessionId,
      workspaceId: written.workspaceId,
      uri,
    });

    fs.writeFileSync(
      filePath,
      'export type User = {\n  name: string;\n};\n',
      'utf8',
    );

    const readerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const restored = await clientWorkspaceAttach(readerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-stale-reader',
    });

    expect(
      await readerService.queryIndexStatus({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: restored.workspaceId,
      workspaceInstanceId: restored.workspaceInstanceId,
      status: 'cold',
      replayState: 'pending',
      workspaceReady: false,
      analysisGeneration: 0,
    });
    expect(
      await readerService.queryDiagnostics({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
        uri,
      }),
    ).toEqual([]);
  });

  it('reports replay pending and warms in the background after replay completes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const backgroundTasks = backgroundTaskQueueCreate();
    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        backgroundWarmup: true,
        backgroundTaskSchedule: backgroundTasks.schedule,
      }),
    });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'background-warmup-client',
    });

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'cold',
      replayState: 'pending',
      replayEpoch: 0,
      workspaceReady: false,
      featureStatus: {
        diagnostics: { readiness: 'cold' },
        codeActions: { readiness: 'cold' },
        editPlans: { readiness: 'cold' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
      indexedFileCount: 0,
      openDocumentCount: 0,
      overlayCount: 0,
      analysisGeneration: 0,
      lastError: undefined,
    });

    await service.completeReplay({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
    });

    expect(backgroundTasks.pendingCountGet()).toBe(1);
    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'warming',
      replayState: 'applied',
      replayEpoch: 1,
      workspaceReady: false,
      featureStatus: {
        diagnostics: { readiness: 'warming' },
        codeActions: { readiness: 'warming' },
        editPlans: { readiness: 'warming' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
      analysisGeneration: 0,
    });

    await backgroundTasks.runNext();

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'applied',
      replayEpoch: 1,
      workspaceReady: true,
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
      analysisGeneration: 1,
    });
    expect(
      await service.queryDiagnostics({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);
  });

  it('re-queues background warm-up after a watched disk invalidation', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const watcher = workspaceWatcherStubCreate();
    const backgroundTasks = backgroundTaskQueueCreate();
    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        watcherCreate: watcher.watcherCreate,
        backgroundWarmup: true,
        backgroundTaskSchedule: backgroundTasks.schedule,
      }),
    });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'background-warmup-watch-client',
    });

    await service.completeReplay({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
    });
    await backgroundTasks.runNext();

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'applied',
      analysisGeneration: 1,
    });

    fs.writeFileSync(
      filePath,
      'export type User = {\n  name: string;\n};\n',
      'utf8',
    );
    watcher.trigger('change', filePath);

    expect(backgroundTasks.pendingCountGet()).toBe(1);
    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'warming',
      replayState: 'applied',
      analysisGeneration: 1,
    });

    await backgroundTasks.runNext();

    expect(
      await service.queryIndexStatus({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'applied',
      analysisGeneration: 2,
    });
    expect(
      await service.queryDiagnostics({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).toEqual([]);
  });
});
