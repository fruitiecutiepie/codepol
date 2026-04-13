import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pluginModuleRegister,
  pluginRuleNew,
  treeCheckProviderNew,
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

function unusedExportsWorkspacePackagesConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.workspace]
language = "typescript"
files = ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-unused-exports"
targets = ["workspace"]
`;
}

function noUnusedVarsConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-unused-vars"
targets = ["src"]
`;
}

function dottedTargetConfigContentCreate(): string {
  return `targets.codepol-src.language = "typescript"
targets.codepol-src.files = ["src/**/*.ts"]

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["codepol-src"]
`;
}

function collisionTargetConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[targets.shared]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["src", "shared"]
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

function processPluginConfigContentCreate(pluginScriptPath: string): string {
  return `[[plugins]]
id = "fixture/process-plugin"

[plugins.source]
kind = "process"
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(pluginScriptPath)}]
timeoutMs = 5000

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "fixture/process-plugin/no-todo-comment"
targets = ["src"]
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

function mockBiomeSuccessScriptCreate(projectDir: string, fileName = 'mock-biome-ok.cjs'): string {
  const biomeBin = path.join(projectDir, fileName);
  fs.writeFileSync(
    biomeBin,
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ diagnostics: [] }));
process.exit(0);
`,
    'utf8',
  );
  fs.chmodSync(biomeBin, 0o755);
  return biomeBin;
}

function mockBiomeDiagnosticScriptCreate(
  projectDir: string,
  options: {
    diagnostic: {
      code: string;
      filePath: string;
      message: string;
      startLine?: number;
      startColumn?: number;
      endLine?: number;
      endColumn?: number;
    };
    fileName?: string;
  },
): string {
  const biomeBin = path.join(
    projectDir,
    options.fileName ?? 'mock-biome-diagnostic.cjs',
  );
  const diagnostic = {
    code: {
      value: options.diagnostic.code,
    },
    location: {
      path: options.diagnostic.filePath,
      range: {
        start: {
          line: options.diagnostic.startLine ?? 0,
          column: options.diagnostic.startColumn ?? 0,
        },
        end: {
          line: options.diagnostic.endLine ?? 0,
          column: options.diagnostic.endColumn ?? 5,
        },
      },
    },
    message: options.diagnostic.message,
  };
  fs.writeFileSync(
    biomeBin,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(JSON.stringify({ diagnostics: [diagnostic] }))});
process.exit(0);
`,
    'utf8',
  );
  fs.chmodSync(biomeBin, 0o755);
  return biomeBin;
}

function pluginRuleConfigContentCreate(input: {
  pluginId: string;
  ruleId: string;
  language?: string;
}): string {
  return `[[plugins]]
id = "${input.pluginId}"
source = { kind = "builtin" }

[targets.src]
language = "${input.language ?? 'typescript'}"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "${input.pluginId}/${input.ruleId}"
targets = ["src"]
`;
}

function analyzerScorecardGet(
  engine: WorkspaceServiceEngine,
  input: {
    clientSessionId: string;
    workspaceId: string;
  },
): Array<{
  analyzerId: string;
  platform: string;
  status: string;
  ownedRuleIds: string[];
  skippedRuleIds: string[];
  skippedReason?: string;
  issues: string[];
}> {
  const debugEngine = engine as unknown as {
    clientSessions: Map<
      string,
      {
        workspaces: Map<
          string,
          {
            lastAnalysis?: {
              analyzerScorecard?: Array<{
                analyzerId: string;
                platform: string;
                status: string;
                ownedRuleIds: string[];
                skippedRuleIds: string[];
                skippedReason?: string;
                issues: string[];
              }>;
            };
          }
        >;
      }
    >;
  };
  return (
    debugEngine.clientSessions
      .get(input.clientSessionId)
      ?.workspaces.get(input.workspaceId)
      ?.lastAnalysis?.analyzerScorecard ?? []
  );
}

function analyzerInventoryGet(
  engine: WorkspaceServiceEngine,
  input: {
    clientSessionId: string;
    workspaceId: string;
  },
): Array<{
  ruleId: string;
  languages: string[];
  wrappedPlatforms: string[];
  hasNativeOwner: boolean;
  ownership: string;
  recentNativeDiagnosticCount: number;
  recentWrappedDiagnosticCount: number;
  recentNativeLatencyMs: number;
  recentWrappedLatencyMs: number;
  fixSurfaceNotes: string[];
}> {
  const debugEngine = engine as unknown as {
    clientSessions: Map<
      string,
      {
        workspaces: Map<
          string,
          {
            lastAnalysis?: {
              analyzerInventory?: Array<{
                ruleId: string;
                languages: string[];
                wrappedPlatforms: string[];
                hasNativeOwner: boolean;
                ownership: string;
                recentNativeDiagnosticCount: number;
                recentWrappedDiagnosticCount: number;
                recentNativeLatencyMs: number;
                recentWrappedLatencyMs: number;
                fixSurfaceNotes: string[];
              }>;
            };
          }
        >;
      }
    >;
  };
  return (
    debugEngine.clientSessions
      .get(input.clientSessionId)
      ?.workspaces.get(input.workspaceId)
      ?.lastAnalysis?.analyzerInventory ?? []
  );
}

function mockProcessPluginScriptCreate(
  projectDir: string,
  options: {
    fileName?: string;
    violationMessage?: string;
  } = {},
): string {
  const pluginPath = path.join(
    projectDir,
    options.fileName ?? 'mock-process-plugin.cjs',
  );
  fs.writeFileSync(
    pluginPath,
    `#!/usr/bin/env node
const fs = require('node:fs');

const request = JSON.parse(fs.readFileSync(0, 'utf8'));
if (request.method === 'describe') {
  process.stdout.write(JSON.stringify({
    protocolVersion: 1,
    ok: true,
    result: {
      pluginId: request.pluginId,
      rules: [{ id: 'no-todo-comment', languages: ['typescript'] }],
    },
  }));
  process.exit(0);
}

if (request.method === 'check') {
  const source = request.context.source;
  const violations = source.includes('TODO')
    ? [{
        ruleId: request.ruleId,
        filePath: request.context.filePath,
        message: ${JSON.stringify(options.violationMessage ?? 'TODO comment detected')},
        line: 1,
        column: 1,
      }]
    : [];
  process.stdout.write(JSON.stringify({
    protocolVersion: 1,
    ok: true,
    result: { violations },
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  protocolVersion: 1,
  ok: true,
  result: {},
}));
`,
    'utf8',
  );
  fs.chmodSync(pluginPath, 0o755);
  return pluginPath;
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

  it('prefers a native JS/TS rule over a wrapped analyzer for the same rule id', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

    const pluginId = `test-dual-native-${randomUUID()}`;
    const ruleId = 'dual-capability';
    const resolvedRuleId = `${pluginId}/${ruleId}`;
    const biomeBin = mockBiomeDiagnosticScriptCreate(workspaceRoot, {
      fileName: 'mock-biome-dual.cjs',
      diagnostic: {
        code: 'lint/mock/wrapped',
        filePath,
        message: 'wrapped diagnostic',
      },
    });
    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: ruleId,
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
            treeCheckProvider: treeCheckProviderNew({
              languages: ['typescript'],
              check: () => [
                {
                  ruleId: resolvedRuleId,
                  filePath,
                  message: 'native diagnostic',
                  line: 1,
                  column: 1,
                },
              ],
            }),
          },
        }),
      ],
    });

    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      pluginRuleConfigContentCreate({ pluginId, ruleId }),
      'utf8',
    );

    const engine = new WorkspaceServiceEngine();
    const service = workspaceServiceCreate({ engine });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'dual-native-client',
    });

    const diagnostics = await service.queryDiagnostics({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        source: 'codepol',
        code: resolvedRuleId,
        message: 'native diagnostic',
      }),
    ]);

    const scorecard = analyzerScorecardGet(engine, {
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    expect(scorecard).toContainEqual(
      expect.objectContaining({
        analyzerId: 'codepol/tree',
        platform: 'codepol_tree',
        status: 'ran',
        ownedRuleIds: [resolvedRuleId],
      }),
    );
    expect(scorecard).toContainEqual(
      expect.objectContaining({
        analyzerId: 'biome',
        platform: 'biome',
        status: 'skipped',
        ownedRuleIds: [],
        skippedRuleIds: [resolvedRuleId],
        skippedReason: 'native_preferred',
      }),
    );
    expect(
      analyzerInventoryGet(engine, {
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        ruleId: resolvedRuleId,
        languages: ['typescript'],
        wrappedPlatforms: ['biome'],
        hasNativeOwner: true,
        ownership: 'native_preferred',
        recentNativeDiagnosticCount: 1,
        recentWrappedDiagnosticCount: 0,
        fixSurfaceNotes: expect.arrayContaining([
          'tree_check',
          'tree_only_code_actions',
          'wrapped_external_fix:biome',
        ]),
      }),
    );
  });

  it('treats the shipped no-unused-vars builtin as native-preferred over eslint', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      `function demo() {
  const unused = 1;
  return 1;
}

demo();
`,
      'utf8',
    );
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noUnusedVarsConfigContentCreate(), 'utf8');

    const engine = new WorkspaceServiceEngine();
    const service = workspaceServiceCreate({ engine });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'builtin-no-unused-vars-client',
    });

    const diagnostics = await service.queryDiagnostics({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        source: 'codepol',
        code: '@codepol/plugin/no-unused-vars',
        message: "'unused' is assigned a value but never used.",
      }),
    ]);

    const scorecard = analyzerScorecardGet(engine, {
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    expect(scorecard).toContainEqual(
      expect.objectContaining({
        analyzerId: 'codepol/tree',
        platform: 'codepol_tree',
        status: 'ran',
        ownedRuleIds: ['@codepol/plugin/no-unused-vars'],
      }),
    );
    expect(scorecard).toContainEqual(
      expect.objectContaining({
        analyzerId: 'eslint',
        platform: 'eslint',
        status: 'skipped',
        ownedRuleIds: [],
        skippedRuleIds: ['@codepol/plugin/no-unused-vars'],
        skippedReason: 'native_preferred',
      }),
    );
    expect(
      analyzerInventoryGet(engine, {
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        ruleId: '@codepol/plugin/no-unused-vars',
        languages: ['typescript'],
        wrappedPlatforms: ['eslint'],
        hasNativeOwner: true,
        ownership: 'native_preferred',
        recentNativeDiagnosticCount: 1,
        recentWrappedDiagnosticCount: 0,
        fixSurfaceNotes: expect.arrayContaining([
          'tree_check',
          'tree_only_code_actions',
          'wrapped_external_fix:eslint',
        ]),
      }),
    );
  });

  it('keeps wrapped-only JS/TS analyzers active when no native owner exists', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

    const pluginId = `test-wrapped-only-${randomUUID()}`;
    const ruleId = 'wrapped-only';
    const resolvedRuleId = 'lint/mock/wrapped-only';
    const biomeBin = mockBiomeDiagnosticScriptCreate(workspaceRoot, {
      fileName: 'mock-biome-wrapped-only.cjs',
      diagnostic: {
        code: resolvedRuleId,
        filePath,
        message: 'wrapped-only diagnostic',
      },
    });
    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: ruleId,
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
    fs.writeFileSync(
      configPath,
      pluginRuleConfigContentCreate({ pluginId, ruleId }),
      'utf8',
    );

    const engine = new WorkspaceServiceEngine();
    const service = workspaceServiceCreate({ engine });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'wrapped-only-client',
    });

    const diagnostics = await service.queryDiagnostics({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        source: 'biome',
        code: resolvedRuleId,
        message: 'wrapped-only diagnostic',
      }),
    ]);

    const scorecard = analyzerScorecardGet(engine, {
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    expect(scorecard).toContainEqual(
      expect.objectContaining({
        analyzerId: 'biome',
        platform: 'biome',
        status: 'ran',
        ownedRuleIds: [`${pluginId}/${ruleId}`],
        skippedRuleIds: [],
      }),
    );
    expect(
      analyzerInventoryGet(engine, {
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        ruleId: `${pluginId}/${ruleId}`,
        languages: ['typescript'],
        wrappedPlatforms: ['biome'],
        hasNativeOwner: false,
        ownership: 'keep_wrapped',
        recentNativeDiagnosticCount: 0,
        recentWrappedDiagnosticCount: 1,
        fixSurfaceNotes: ['wrapped_external_fix:biome'],
      }),
    );
  });

  it('degrades diagnostics when a native-owned JS/TS rule fails without falling back to wrapped output', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

    const pluginId = `test-dual-native-failure-${randomUUID()}`;
    const ruleId = 'dual-capability-failure';
    const resolvedRuleId = `${pluginId}/${ruleId}`;
    const biomeBin = mockBiomeDiagnosticScriptCreate(workspaceRoot, {
      fileName: 'mock-biome-dual-failure.cjs',
      diagnostic: {
        code: 'lint/mock/fallback',
        filePath,
        message: 'wrapped fallback diagnostic',
      },
    });
    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: ruleId,
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
            treeCheckProvider: treeCheckProviderNew({
              languages: ['typescript'],
              check: () => {
                throw new Error('native tree exploded');
              },
            }),
          },
        }),
      ],
    });

    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      pluginRuleConfigContentCreate({ pluginId, ruleId }),
      'utf8',
    );

    const engine = new WorkspaceServiceEngine();
    const service = workspaceServiceCreate({ engine });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'dual-native-failure-client',
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
      status: 'ready',
      featureStatus: {
        diagnostics: {
          readiness: 'degraded',
          detail: expect.stringContaining('native tree exploded'),
        },
      },
    });

    const scorecard = analyzerScorecardGet(engine, {
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    expect(scorecard).toContainEqual(
      expect.objectContaining({
        analyzerId: 'codepol/tree',
        platform: 'codepol_tree',
        status: 'failed',
        ownedRuleIds: [resolvedRuleId],
        issues: [expect.stringContaining('native tree exploded')],
      }),
    );
    expect(scorecard).toContainEqual(
      expect.objectContaining({
        analyzerId: 'biome',
        platform: 'biome',
        status: 'skipped',
        ownedRuleIds: [],
        skippedRuleIds: [resolvedRuleId],
        skippedReason: 'native_preferred',
      }),
    );
    expect(
      analyzerInventoryGet(engine, {
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        ruleId: resolvedRuleId,
        ownership: 'native_preferred',
        recentNativeDiagnosticCount: 0,
        recentWrappedDiagnosticCount: 0,
        wrappedPlatforms: ['biome'],
      }),
    );
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

  it('warms index-backed read features for LSP sessions and keeps semantic search overlay-aware', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const sharedPath = path.join(workspaceRoot, 'src', 'shared.ts');
    const appPath = path.join(workspaceRoot, 'src', 'app.ts');
    const sharedUri = workspacePathToUri(sharedPath);
    const appUri = workspacePathToUri(appPath);
    fs.writeFileSync(sharedPath, 'export const sharedValue = 1;\n', 'utf8');
    fs.writeFileSync(
      appPath,
      "import { sharedValue } from './shared';\nexport const appValue = sharedValue;\n",
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
      clientKind: 'lsp',
      clientInstanceId: 'lsp-read-feature-client',
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
      featureStatus: {
        workspaceIndex: { readiness: 'cold' },
        workspaceSymbols: { readiness: 'cold' },
        semanticSearch: { readiness: 'cold' },
        dependencyGraph: { readiness: 'cold' },
        architectureSummary: { readiness: 'cold' },
      },
      analysisGeneration: 0,
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
      workspaceReady: false,
      featureStatus: {
        workspaceIndex: { readiness: 'warming' },
        workspaceSymbols: { readiness: 'warming' },
        semanticSearch: { readiness: 'warming' },
        dependencyGraph: { readiness: 'warming' },
        architectureSummary: { readiness: 'warming' },
      },
      analysisGeneration: 0,
    });

    await backgroundTasks.runNext();

    const readyStatus = await service.queryIndexStatus({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    expect(readyStatus).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'applied',
      workspaceReady: true,
      featureStatus: {
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Session-derived index ready',
        },
        workspaceSymbols: { readiness: 'ready' },
        semanticSearch: { readiness: 'ready' },
        dependencyGraph: { readiness: 'ready' },
        architectureSummary: { readiness: 'ready' },
      },
      indexedFileCount: 2,
      analysisGeneration: 1,
    });

    const workspaceSymbols = await service.queryWorkspaceSymbols({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      query: 'shared',
    });
    expect(workspaceSymbols).toEqual([
      {
        name: 'shared.ts',
        kind: 'module',
        location: {
          uri: sharedUri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
        containerName: 'src',
        detail: 'src/shared.ts',
        source: 'codepol',
        semanticClass: 'workspace_module',
        score: workspaceSymbols[0]?.score,
      },
    ]);

    const semanticDefinition = await service.querySemanticDefinition({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: sharedUri,
    });
    expect(semanticDefinition).toEqual({
      kind: 'single_location',
      target: {
        uri: sharedUri,
        semanticClass: 'architecture_node',
      },
      location: {
        uri: sharedUri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      source: 'codepol',
      semanticClass: 'architecture_node',
    });

    const semanticReferences = await service.querySemanticReferences({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: sharedUri,
    });
    expect(semanticReferences).toMatchObject({
      target: {
        uri: sharedUri,
        semanticClass: 'architecture_node',
      },
      presentation: 'grouped_list',
      totalItems: 3,
      totalAvailableItems: 3,
      truncated: false,
      groups: [
        {
          group: 'declarations',
          totalCount: 1,
          truncated: false,
          items: [
            {
              location: {
                uri: sharedUri,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 0 },
                },
              },
              label: 'src/shared.ts',
              detail: 'module declaration',
              relationKind: 'declarations',
              semanticClass: 'architecture_node',
            },
          ],
        },
        {
          group: 'incoming',
          totalCount: 2,
          truncated: false,
          items: [
            expect.objectContaining({
              location: {
                uri: appUri,
                range: {
                  start: { line: 0, character: 0 },
                  end: {
                    line: 0,
                    character: expect.any(Number),
                  },
                },
              },
              label: 'src/app.ts',
              detail: 'import sharedValue from ./shared',
              relationKind: 'incoming',
              semanticClass: 'architecture_node',
            }),
            expect.objectContaining({
              location: {
                uri: appUri,
                range: {
                  start: { line: 0, character: 28 },
                  end: {
                    line: 0,
                    character: expect.any(Number),
                  },
                },
              },
              label: 'src/app.ts',
              detail: 'import from ./shared',
              relationKind: 'incoming',
              semanticClass: 'architecture_node',
            }),
          ],
        },
        {
          group: 'outgoing',
          totalCount: 0,
          truncated: false,
          items: [],
        },
      ],
      source: 'codepol',
      semanticClass: 'architecture_node',
    });

    const semanticHover = await service.querySemanticHover({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: sharedUri,
    });
    expect(semanticHover).toEqual({
      target: {
        uri: sharedUri,
        semanticClass: 'architecture_node',
      },
      title: 'shared.ts',
      subtitle: 'src/shared.ts',
      summary: 'Indexed architecture node for the workspace module graph.',
      fields: [
        { label: 'Directory', value: 'src' },
        { label: 'Inbound edges', value: '1' },
        { label: 'Outbound edges', value: '0' },
        { label: 'Entry point', value: 'No' },
        { label: 'Cycle member', value: 'No' },
      ],
      tags: undefined,
      actions: ['go_to_definition', 'find_references', 'show_graph'],
      source: 'codepol',
      semanticClass: 'architecture_node',
    });

    const prepareRename = await service.prepareRename({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      target: {
        semanticClass: 'architecture_node',
        uri: sharedUri,
      },
    });
    expect(prepareRename).toEqual({
      ok: false,
      code: 'not_renameable_class',
      message: 'Semantic class architecture_node is not renameable in MVP.',
    });

    const renamePreview = await service.previewRename({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      target: {
        semanticClass: 'architecture_node',
        uri: sharedUri,
      },
      newName: 'shared-renamed',
    });
    expect(renamePreview).toEqual({
      ok: false,
      code: 'not_renameable_class',
      message: 'Semantic class architecture_node is not renameable in MVP.',
    });

    const configRenamePrepare = await service.prepareRename({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      target: {
        semanticClass: 'config_component',
        targetId: 'target:src',
      },
    });
    expect(configRenamePrepare).toEqual({
      ok: true,
      target: {
        semanticClass: 'config_component',
        targetId: 'target:src',
      },
      displayName: 'src',
      currentName: 'src',
      normalizedCurrentName: 'src',
      namespaceId: `config.targets:${workspacePathToUri(configPath)}`,
      declarationLocation: {
        uri: workspacePathToUri(configPath),
        range: {
          start: { line: 4, character: 9 },
          end: { line: 4, character: 12 },
        },
      },
      placeholderRange: {
        start: { line: 4, character: 9 },
        end: { line: 4, character: 12 },
      },
      impactedSiteCount: 2,
      requiresPreview: true,
      namingRules: {
        minLength: 1,
        patternDescription: 'bare TOML key segment ([A-Za-z0-9_-]+)',
        casePolicy: 'preserve',
      },
    });

    const configRenamePreview = await service.previewRename({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      target: {
        semanticClass: 'config_component',
        targetId: 'target:src',
      },
      newName: 'app-src',
    });
    expect(configRenamePreview).toEqual({
      ok: true,
      target: {
        semanticClass: 'config_component',
        targetId: 'target:src',
      },
      oldName: 'src',
      newName: 'app-src',
      normalizedNewName: 'app-src',
      namespaceId: `config.targets:${workspacePathToUri(configPath)}`,
      groups: [
        {
          group: 'declarations',
          edits: [
            {
              uri: workspacePathToUri(configPath),
              range: {
                start: { line: 4, character: 9 },
                end: { line: 4, character: 12 },
              },
              oldText: 'src',
              newText: 'app-src',
              kind: 'declaration',
              semanticClass: 'config_component',
              targetId: 'target:src',
            },
          ],
        },
        {
          group: 'config',
          edits: [
            {
              uri: workspacePathToUri(configPath),
              range: {
                start: { line: 10, character: 12 },
                end: { line: 10, character: 15 },
              },
              oldText: 'src',
              newText: 'app-src',
              kind: 'config_key',
              semanticClass: 'config_component',
              targetId: 'target:src',
            },
          ],
        },
      ],
      totalEdits: 2,
      warnings: [],
      blockingIssues: [],
      canApply: true,
    });

    const dependencyGraph = await service.queryDependencyGraph({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    expect(dependencyGraph.nodes).toEqual([
      {
        uri: appUri,
        workspaceRelativePath: 'src/app.ts',
      },
      {
        uri: sharedUri,
        workspaceRelativePath: 'src/shared.ts',
      },
    ]);
    expect(dependencyGraph.edges).toEqual([
      {
        fromUri: appUri,
        toUri: sharedUri,
      },
    ]);

    const architectureSummary = await service.queryArchitectureSummary({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    expect(architectureSummary).toMatchObject({
      indexedFileCount: 2,
      entryPointCount: 1,
      cycleCount: 0,
    });
    expect(architectureSummary.summary).toContain('Indexed 2 files');
    expect(architectureSummary.hotspots).toEqual([
      expect.objectContaining({
        uri: sharedUri,
        workspaceRelativePath: 'src/shared.ts',
      }),
      expect.objectContaining({
        uri: appUri,
        workspaceRelativePath: 'src/app.ts',
      }),
    ]);

    await service.openOverlay({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: sharedUri,
      version: 1,
      text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
    });

    const semanticResults = await service.querySemanticSearch({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      query: 'OverlayOnly',
    });
    expect(semanticResults).toContainEqual(
      expect.objectContaining({
        name: 'OverlayOnly',
        kind: 'exported_symbol',
        location: expect.objectContaining({
          uri: sharedUri,
          range: expect.objectContaining({
            start: { line: 1, character: 13 },
            end: expect.objectContaining({
              line: 1,
              character: expect.any(Number),
            }),
          }),
        }),
        detail: 'src/shared.ts • const',
        source: 'codepol',
        semanticClass: 'exported_symbol',
      }),
    );

    await expect(
      service.previewRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'architecture_node',
          uri: sharedUri,
        },
        newName: 'shared-renamed',
        analysisGeneration: readyStatus.analysisGeneration,
      }),
    ).rejects.toThrow(
      `Analysis generation mismatch: expected ${readyStatus.analysisGeneration! + 1}, received ${readyStatus.analysisGeneration}`,
    );
  });

  it('prepares config target rename for dotted-key declarations', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, dottedTargetConfigContentCreate(), 'utf8');

    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine(),
    });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientKind: 'lsp',
      clientInstanceId: 'dotted-config-rename-client',
    });

    expect(
      await service.prepareRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:codepol-src',
        },
      }),
    ).toEqual({
      ok: true,
      target: {
        semanticClass: 'config_component',
        targetId: 'target:codepol-src',
      },
      displayName: 'codepol-src',
      currentName: 'codepol-src',
      normalizedCurrentName: 'codepol-src',
      namespaceId: `config.targets:${workspacePathToUri(configPath)}`,
      declarationLocation: {
        uri: workspacePathToUri(configPath),
        range: {
          start: { line: 0, character: 8 },
          end: { line: 0, character: 19 },
        },
      },
      placeholderRange: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 19 },
      },
      impactedSiteCount: 3,
      requiresPreview: true,
      namingRules: {
        minLength: 1,
        patternDescription: 'bare TOML key segment ([A-Za-z0-9_-]+)',
        casePolicy: 'preserve',
      },
    });
  });

  it('blocks colliding config target rename previews and rejects invalid new names', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, collisionTargetConfigContentCreate(), 'utf8');

    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine(),
    });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientKind: 'lsp',
      clientInstanceId: 'collision-config-rename-client',
    });

    expect(
      await service.previewRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:src',
        },
        newName: 'shared',
      }),
    ).toMatchObject({
      ok: true,
      target: {
        semanticClass: 'config_component',
        targetId: 'target:src',
      },
      oldName: 'src',
      newName: 'shared',
      normalizedNewName: 'shared',
      totalEdits: 2,
      canApply: false,
      blockingIssues: [
        {
          code: 'collision',
        },
      ],
    });

    await expect(
      service.previewRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:src',
        },
        newName: '   ',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'validation_failed',
      message: 'Config target rename must not be empty.',
    });

    await expect(
      service.previewRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:src',
        },
        newName: 'bad.name',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'validation_failed',
      message: 'Config target rename must match bare TOML key segment ([A-Za-z0-9_-]+).',
    });

    await expect(
      service.previewRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:src',
        },
        newName: 'SRC',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'validation_failed',
      message: 'Case-only config target renames are not supported in MVP.',
    });
  });

  it('keeps config target rename overlay-aware and rejects stale analysisGeneration after config overlays', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    const configUri = workspacePathToUri(configPath);
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine(),
    });
    const attached = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientKind: 'lsp',
      clientInstanceId: 'overlay-config-rename-client',
    });

    const initialStatus = await service.queryIndexStatus({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });

    expect(
      await service.prepareRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:src',
        },
      }),
    ).toMatchObject({
      ok: true,
      currentName: 'src',
      impactedSiteCount: 2,
    });

    const overlayConfig = noInterfaceConfigContentCreate()
      .replace('[targets.src]', '[targets.overlay-src]')
      .replace('targets = ["src"]', 'targets = ["overlay-src"]');

    await service.openOverlay({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: configUri,
      version: 1,
      text: overlayConfig,
    });

    expect(
      await service.prepareRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:src',
        },
      }),
    ).toEqual({
      ok: false,
      code: 'unsupported_context',
      message: 'Config target target:src is not defined in the active Codepol config.',
    });

    expect(
      await service.prepareRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:overlay-src',
        },
      }),
    ).toMatchObject({
      ok: true,
      currentName: 'overlay-src',
      impactedSiteCount: 2,
    });

    expect(
      await service.previewRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:overlay-src',
        },
        newName: 'final-src',
      }),
    ).toMatchObject({
      ok: true,
      oldName: 'overlay-src',
      newName: 'final-src',
      totalEdits: 2,
      canApply: true,
    });

    await service.queryDiagnostics({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });

    const refreshedStatus = await service.queryIndexStatus({
      clientSessionId: attached.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    expect(refreshedStatus.analysisGeneration).toBeGreaterThan(initialStatus.analysisGeneration);

    await expect(
      service.previewRename({
        clientSessionId: attached.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'config_component',
          targetId: 'target:overlay-src',
        },
        newName: 'final-src',
        analysisGeneration: initialStatus.analysisGeneration,
      }),
    ).rejects.toThrow(
      `Analysis generation mismatch: expected ${refreshedStatus.analysisGeneration}, received ${initialStatus.analysisGeneration}`,
    );
  });

  it('keeps architecture semantic references isolated per client overlay session', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const sharedPath = path.join(workspaceRoot, 'src', 'shared.ts');
    const otherPath = path.join(workspaceRoot, 'src', 'other.ts');
    const appPath = path.join(workspaceRoot, 'src', 'app.ts');
    const sharedUri = workspacePathToUri(sharedPath);
    const otherUri = workspacePathToUri(otherPath);
    const appUri = workspacePathToUri(appPath);
    fs.writeFileSync(sharedPath, 'export const sharedValue = 1;\n', 'utf8');
    fs.writeFileSync(otherPath, 'export const otherValue = 1;\n', 'utf8');
    fs.writeFileSync(
      appPath,
      "import { sharedValue } from './shared';\nexport const appValue = sharedValue;\n",
      'utf8',
    );

    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine(),
    });
    const clientA = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientKind: 'lsp',
      clientInstanceId: 'semantic-client-a',
      clientSessionId: 'semantic-client-a-session',
    });
    const clientB = await clientWorkspaceAttach(service, {
      rootPath: workspaceRoot,
      configPath,
      clientKind: 'lsp',
      clientInstanceId: 'semantic-client-b',
      clientSessionId: 'semantic-client-b-session',
    });

    await service.completeReplay({
      clientSessionId: clientA.clientSessionId,
      workspaceId: clientA.workspaceId,
      workspaceInstanceId: clientA.workspaceInstanceId,
    });
    await service.completeReplay({
      clientSessionId: clientB.clientSessionId,
      workspaceId: clientB.workspaceId,
      workspaceInstanceId: clientB.workspaceInstanceId,
    });

    expect(
      (
        await service.querySemanticReferences({
          clientSessionId: clientA.clientSessionId,
          workspaceId: clientA.workspaceId,
          uri: sharedUri,
        })
      )?.groups[1],
    ).toMatchObject({
      group: 'incoming',
      totalCount: 2,
    });
    expect(
      (
        await service.querySemanticReferences({
          clientSessionId: clientB.clientSessionId,
          workspaceId: clientB.workspaceId,
          uri: sharedUri,
        })
      )?.groups[1],
    ).toMatchObject({
      group: 'incoming',
      totalCount: 2,
    });

    await service.openOverlay({
      clientSessionId: clientA.clientSessionId,
      workspaceId: clientA.workspaceId,
      uri: appUri,
      version: 1,
      text: "import { otherValue } from './other';\nexport const appValue = otherValue;\n",
    });

    expect(
      (
        await service.querySemanticReferences({
          clientSessionId: clientA.clientSessionId,
          workspaceId: clientA.workspaceId,
          uri: sharedUri,
        })
      )?.groups[1],
    ).toMatchObject({
      group: 'incoming',
      totalCount: 0,
      items: [],
    });
    expect(
      (
        await service.querySemanticReferences({
          clientSessionId: clientB.clientSessionId,
          workspaceId: clientB.workspaceId,
          uri: sharedUri,
        })
      )?.groups[1],
    ).toMatchObject({
      group: 'incoming',
      totalCount: 2,
    });
    expect(
      (
        await service.querySemanticReferences({
          clientSessionId: clientA.clientSessionId,
          workspaceId: clientA.workspaceId,
          uri: otherUri,
        })
      )?.groups[1],
    ).toMatchObject({
      group: 'incoming',
      totalCount: 2,
    });
    expect(
      (
        await service.querySemanticReferences({
          clientSessionId: clientB.clientSessionId,
          workspaceId: clientB.workspaceId,
          uri: otherUri,
        })
      )?.groups[1],
    ).toMatchObject({
      group: 'incoming',
      totalCount: 0,
      items: [],
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

  it('persists analyzer ownership scorecards across warm restore for native-owned JS/TS rules', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

    const pluginId = `test-warm-scorecard-${randomUUID()}`;
    const ruleId = 'warm-dual';
    const resolvedRuleId = `${pluginId}/${ruleId}`;
    const biomeBin = mockBiomeDiagnosticScriptCreate(workspaceRoot, {
      fileName: 'mock-biome-warm-scorecard.cjs',
      diagnostic: {
        code: 'lint/mock/warm-fallback',
        filePath,
        message: 'wrapped warm diagnostic',
      },
    });
    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: ruleId,
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
            treeCheckProvider: treeCheckProviderNew({
              languages: ['typescript'],
              check: () => [
                {
                  ruleId: resolvedRuleId,
                  filePath,
                  message: 'warm native diagnostic',
                  line: 1,
                  column: 1,
                },
              ],
            }),
          },
        }),
      ],
    });

    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      pluginRuleConfigContentCreate({ pluginId, ruleId }),
      'utf8',
    );

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerEngine = new WorkspaceServiceEngine({
      warmCache,
    });
    const writerService = workspaceServiceCreate({
      engine: writerEngine,
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-scorecard-writer',
    });

    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri,
      }),
    ).toHaveLength(1);
    expect(
      analyzerScorecardGet(writerEngine, {
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        analyzerId: 'biome',
        status: 'skipped',
        skippedRuleIds: [resolvedRuleId],
        skippedReason: 'native_preferred',
      }),
    );
    await writerService.closeClientSession({
      clientSessionId: written.clientSessionId,
    });

    const readerEngine = new WorkspaceServiceEngine({
      warmCache,
    });
    const readerService = workspaceServiceCreate({
      engine: readerEngine,
    });
    const restored = await clientWorkspaceAttach(readerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-scorecard-reader',
    });

    expect(
      await readerService.queryIndexStatus({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
      }),
    ).toMatchObject({
      status: 'ready',
      replayState: 'pending',
      analysisGeneration: 1,
    });
    expect(
      analyzerScorecardGet(readerEngine, {
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        analyzerId: 'biome',
        status: 'skipped',
        skippedRuleIds: [resolvedRuleId],
        skippedReason: 'native_preferred',
      }),
    );
    expect(
      analyzerInventoryGet(readerEngine, {
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        ruleId: resolvedRuleId,
        ownership: 'native_preferred',
        wrappedPlatforms: ['biome'],
        hasNativeOwner: true,
      }),
    );
    expect(
      await readerService.queryDiagnostics({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
        uri,
      }),
    ).toEqual([
      expect.objectContaining({
        source: 'codepol',
        code: resolvedRuleId,
        message: 'warm native diagnostic',
      }),
    ]);
  });

  it('does not persist open overlays or session-scoped edit plans across warm restore', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    const diskText = 'export interface User {\n  name: string;\n}\n';
    const overlayText = 'export type User = {\n  name: string;\n};\n';
    fs.writeFileSync(filePath, diskText, 'utf8');

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-overlay-plan-writer',
    });

    const diskDiagnostics = await writerService.queryDiagnostics({
      clientSessionId: written.clientSessionId,
      workspaceId: written.workspaceId,
      uri,
    });
    expect(diskDiagnostics).toHaveLength(1);

    await writerService.openOverlay({
      clientSessionId: written.clientSessionId,
      workspaceId: written.workspaceId,
      uri,
      version: 1,
      text: diskText,
    });
    const overlayActions = await writerService.queryCodeActions({
      clientSessionId: written.clientSessionId,
      workspaceId: written.workspaceId,
      uri,
      version: 1,
      diagnosticIds: [diskDiagnostics[0]!.id],
    });
    expect(overlayActions).toHaveLength(1);

    await writerService.updateOverlay({
      clientSessionId: written.clientSessionId,
      workspaceId: written.workspaceId,
      uri,
      version: 2,
      text: overlayText,
    });
    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri,
      }),
    ).toEqual([]);

    await writerService.closeClientSession({
      clientSessionId: written.clientSessionId,
    });

    const readerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const restored = await clientWorkspaceAttach(readerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-overlay-plan-reader',
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
      analysisGeneration: 1,
    });
    expect(
      await readerService.queryDiagnostics({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
        uri,
      }),
    ).toHaveLength(1);
    expect(
      await readerService.applyEditPlan({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
        planId: overlayActions[0]!.plan.id,
        documentVersions: {
          [uri]: 1,
        },
      }),
    ).toEqual({
      applied: false,
      failureReason: 'plan_not_found',
    });
  });

  it('restores an index-required warm cache and reapplies overlay updates through the restored index', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, unusedExportsConfigContentCreate(), 'utf8');

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

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-index-writer',
    });

    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri: exporterUri,
      }),
    ).toEqual([]);
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
      clientInstanceId: 'warm-index-reader',
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
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Session-derived index ready',
        },
      },
      indexedFileCount: 2,
      analysisGeneration: 1,
    });

    expect(
      await readerService.querySemanticSearch({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
        query: 'sharedValue',
      }),
    ).toContainEqual(
      expect.objectContaining({
        name: 'sharedValue',
        kind: 'exported_symbol',
        location: expect.objectContaining({
          uri: exporterUri,
        }),
      }),
    );
    expect(
      await readerService.queryDependencyGraph({
        clientSessionId: restored.clientSessionId,
        workspaceId: restored.workspaceId,
      }),
    ).toMatchObject({
      nodes: [
        {
          uri: exporterUri,
          workspaceRelativePath: 'src/exporter.ts',
        },
        {
          uri: importerUri,
          workspaceRelativePath: 'src/importer.ts',
        },
      ],
      edges: [
        {
          fromUri: importerUri,
          toUri: exporterUri,
        },
      ],
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
        uri: exporterUri,
      }),
    ).toEqual([]);

    await readerService.openOverlay({
      clientSessionId: restored.clientSessionId,
      workspaceId: restored.workspaceId,
      uri: importerUri,
      version: 1,
      text: 'export const value = 1;\n',
    });

    const diagnostics = await readerService.queryDiagnostics({
      clientSessionId: restored.clientSessionId,
      workspaceId: restored.workspaceId,
      uri: exporterUri,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('@codepol/plugin/no-unused-exports');
  });

  it('discards an index-required warm cache when workspace package metadata changes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'packages/lib/src'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'apps/web/src'), { recursive: true });

    fs.writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }, null, 2),
      'utf8',
    );
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      unusedExportsWorkspacePackagesConfigContentCreate(),
      'utf8',
    );

    const exporterPath = path.join(workspaceRoot, 'packages/lib/src/index.ts');
    const importerPath = path.join(workspaceRoot, 'apps/web/src/app.ts');
    const exporterUri = workspacePathToUri(exporterPath);

    fs.writeFileSync(
      path.join(workspaceRoot, 'packages/lib/package.json'),
      JSON.stringify(
        {
          name: '@acme/lib',
          main: './dist/index.js',
        },
        null,
        2,
      ),
      'utf8',
    );
    fs.writeFileSync(exporterPath, 'export const sharedValue = 1;\n', 'utf8');
    fs.writeFileSync(
      importerPath,
      "import { sharedValue } from '@acme/lib';\nexport const value = sharedValue;\n",
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
      clientInstanceId: 'warm-workspace-packages-writer',
    });

    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri: exporterUri,
      }),
    ).toEqual([]);
    await writerService.closeClientSession({
      clientSessionId: written.clientSessionId,
    });

    fs.writeFileSync(
      path.join(workspaceRoot, 'packages/lib/package.json'),
      JSON.stringify(
        {
          name: '@acme/lib-renamed',
          main: './dist/index.js',
        },
        null,
        2,
      ),
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
      clientInstanceId: 'warm-workspace-packages-reader',
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

  it('discards a warm cache when a configured external tool binary changes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const pluginId = `test-biome-cache-${randomUUID()}`;
    const biomeBin = mockBiomeSuccessScriptCreate(workspaceRoot, 'mock-biome-cache.cjs');
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

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-tool-writer',
    });
    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri,
      }),
    ).toEqual([]);

    fs.writeFileSync(
      biomeBin,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ diagnostics: [{ severity: "error", category: "lint", description: "changed", location: { path: ${JSON.stringify(filePath)}, span: [0, 1], sourceCode: "export const value = 1;\\n" } }] }));
process.exit(0);
`,
      'utf8',
    );
    fs.chmodSync(biomeBin, 0o755);

    const readerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const restored = await clientWorkspaceAttach(readerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-tool-reader',
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
  });

  it('discards a warm cache when a configured external tool config file changes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const pluginId = `test-biome-config-cache-${randomUUID()}`;
    const biomeBin = mockBiomeSuccessScriptCreate(workspaceRoot, 'mock-biome-config-cache.cjs');
    const biomeConfigPath = path.join(workspaceRoot, 'biome.json');
    fs.writeFileSync(biomeConfigPath, '{ "formatter": { "enabled": true } }\n', 'utf8');
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
                  configPath: './biome.json',
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

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-tool-config-writer',
    });
    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri,
      }),
    ).toEqual([]);

    fs.writeFileSync(
      biomeConfigPath,
      '{ "formatter": { "enabled": false }, "linter": { "enabled": true } }\n',
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
      clientInstanceId: 'warm-cache-tool-config-reader',
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
  });

  it('discards a warm cache when a process plugin script changes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const pluginPath = mockProcessPluginScriptCreate(workspaceRoot);
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, processPluginConfigContentCreate(pluginPath), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, '// TODO fix\nexport const value = 1;\n', 'utf8');

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-process-plugin-writer',
    });
    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri,
      }),
    ).toHaveLength(1);

    mockProcessPluginScriptCreate(workspaceRoot, {
      fileName: path.basename(pluginPath),
      violationMessage: 'changed process plugin logic',
    });

    const readerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const restored = await clientWorkspaceAttach(readerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-process-plugin-reader',
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
  });

  it('discards a warm cache when a registered builtin plugin definition changes', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-workspace-service-');
    const runtimeDir = tempWorkspaceCreate('codepol-workspace-cache-');
    createdDirs.push(workspaceRoot, runtimeDir);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const pluginId = `test-plugin-signature-${randomUUID()}`;
    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: 'mock-rule',
          capabilities: {},
        }),
      ],
    });

    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      `[[plugins]]
id = "${pluginId}"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "${pluginId}/mock-rule"
targets = ["src"]
`,
      'utf8',
    );

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const writerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const written = await clientWorkspaceAttach(writerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-plugin-signature-writer',
    });
    expect(
      await writerService.queryDiagnostics({
        clientSessionId: written.clientSessionId,
        workspaceId: written.workspaceId,
        uri,
      }),
    ).toEqual([]);

    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: 'mock-rule',
          capabilities: {
            lintProviders: [
              {
                platform: 'mock',
                languages: ['typescript'],
                config: {
                  mode: 'updated',
                },
              },
            ],
          },
        }),
      ],
    });

    const readerService = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        warmCache,
      }),
    });
    const restored = await clientWorkspaceAttach(readerService, {
      rootPath: workspaceRoot,
      configPath,
      clientInstanceId: 'warm-cache-plugin-signature-reader',
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
