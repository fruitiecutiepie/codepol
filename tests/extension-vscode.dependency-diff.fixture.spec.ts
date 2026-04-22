/**
 * End-to-end fixture test for the dependency-diff editor surface.
 *
 * The view-model / render / manager / command specs all use mocks. This
 * spec is the only place that stitches `CodepolCommandController` to a
 * *real* `WorkspaceServiceEngine` over a temp workspace and a real
 * baseline snapshot sidecar, so the full `showDependencyDiff` path is
 * exercised end-to-end.
 *
 * Coverage:
 *
 * - no-args path resolves the configured baseline label and opens an
 *   empty diff panel when the live graph matches the labeled snapshot
 * - baseline-label args path opens a panel whose sections contain real
 *   added / removed nodes and edges plus a new cycle, all with
 *   workspace-relative labels derived from the live graph and the diff
 *   payload
 *
 * No vscode mock — the controller does not depend on vscode, only on
 * the injected host + panels.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  workspacePathToUri,
} from '@codepol/core';
import {
  fileSystemGraphSnapshotStoreCreate,
  graphSnapshotFromDependencyGraphResult,
  graphSnapshotWorkspaceRootIdCompute,
  workspaceServiceCreate,
} from '@codepol/workspace-service';
import { CodepolCommandController } from '../extension-vscode/src/commands';
import type { CodepolPanels } from '../extension-vscode/src/commands';
import type { CodepolProtocolClient } from '../extension-vscode/src/protocolClient';

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

function fixtureWorkspaceCreate(): {
  rootPath: string;
  configPath: string;
  files: {
    app: string;
    b: string;
    old: string;
    newFile: string;
  };
} {
  const rootPath = tempWorkspaceCreate('codepol-phase6-diff-fixture-');
  fs.mkdirSync(path.join(rootPath, 'src'), { recursive: true });
  const configPath = path.join(rootPath, 'codepol.toml');
  fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

  const app = path.join(rootPath, 'src', 'app.ts');
  const b = path.join(rootPath, 'src', 'b.ts');
  const old = path.join(rootPath, 'src', 'old.ts');
  const newFile = path.join(rootPath, 'src', 'new.ts');

  fs.writeFileSync(old, 'export const oldValue = 1;\n', 'utf8');
  fs.writeFileSync(b, 'export const b = 2;\n', 'utf8');
  fs.writeFileSync(
    app,
    "import { b } from './b';\nimport { oldValue } from './old';\nexport const app = b + oldValue;\n",
    'utf8',
  );

  return { rootPath, configPath, files: { app, b, old, newFile } };
}

async function fixtureProtocolCreate(input: {
  rootPath: string;
  configPath: string;
}): Promise<{
  service: ReturnType<typeof workspaceServiceCreate>;
  protocol: CodepolProtocolClient;
  session: {
    clientSessionId: string;
    workspaceId: string;
  };
  dispose: () => Promise<void>;
}> {
  const service = workspaceServiceCreate();
  const registered = await service.registerClientSession({
    clientKind: 'test',
    clientInstanceId: 'dependency-diff-fixture',
  });
  const attached = await service.attachWorkspace({
    clientSessionId: registered.clientSessionId,
    rootPath: input.rootPath,
    configPath: input.configPath,
  });
  const session = {
    clientSessionId: registered.clientSessionId,
    workspaceId: attached.workspaceId,
  };

  const unimplemented = (name: string) => {
    return () => {
      throw new Error(
        `fixtureProtocolCreate: ${name} is not wired in this fixture`,
      );
    };
  };

  const protocol: CodepolProtocolClient = {
    start: async () => {},
    stop: async () => {},
    queryIndexStatus: async () => null,
    queryLintRules: async () => null,
    queryLintRuleDetails: async () => null,
    queryCodeActions: async () => [],
    queryArchitectureSummary: async () => null,
    queryDependencyGraph: async () => service.queryDependencyGraph(session),
    queryImpactRadius: unimplemented('queryImpactRadius') as never,
    queryDependencyPath: unimplemented('queryDependencyPath') as never,
    queryDeadModules: async (args) => service.queryDeadModules({ ...session, ...args }),
    queryDependencyDiff: async (args) =>
      service.queryDependencyDiff({ ...session, ...args }),
    queryCallGraph: unimplemented('queryCallGraph') as never,
    queryTypeHierarchy: unimplemented('queryTypeHierarchy') as never,
    querySymbolFlow: unimplemented('querySymbolFlow') as never,
    querySemanticSearch: unimplemented('querySemanticSearch') as never,
    querySemanticDefinition: unimplemented('querySemanticDefinition') as never,
    querySemanticReferences: unimplemented('querySemanticReferences') as never,
    querySemanticHover: unimplemented('querySemanticHover') as never,
    querySymbolLookup: unimplemented('querySymbolLookup') as never,
    querySymbolAtPosition: unimplemented('querySymbolAtPosition') as never,
    querySymbolsInFileWithCallCounts:
      unimplemented('querySymbolsInFileWithCallCounts') as never,
    queryImportSpecifiersInFile:
      unimplemented('queryImportSpecifiersInFile') as never,
    querySymbolImporterCount:
      unimplemented('querySymbolImporterCount') as never,
    prepareRename: unimplemented('prepareRename') as never,
    previewRename: unimplemented('previewRename') as never,
    applyEditPlan: unimplemented('applyEditPlan') as never,
    configureDiagnostics: async () => null,
    getDiagnosticsConfig: async () => null,
    escalateDiagnostics: async () => null,
    revokeDiagnosticsEscalation: async () => {},
    listDiagnosticsEscalations: async () => [],
  };

  return {
    service,
    protocol,
    session,
    dispose: async () => {
      await service.closeClientSession({
        clientSessionId: registered.clientSessionId,
      });
    },
  };
}

function fakePanelsCreate(): CodepolPanels & {
  showDependencyDiff: ReturnType<typeof vi.fn>;
} {
  return {
    showArchitectureSummary: vi.fn(),
    showDependencyGraph: vi.fn(),
    showSemanticDefinition: vi.fn(),
    showArchitectureLinks: vi.fn(),
    showLintRuleDetails: vi.fn(),
    showRenamePreview: vi.fn(),
    showCallGraph: vi.fn(),
    showTypeHierarchy: vi.fn(),
    showDependencyPath: vi.fn(),
    showDeadModules: vi.fn(),
    showDependencyDiff: vi.fn(),
  };
}

function fakeHostCreate(input: {
  baselineLabel?: string;
}) {
  return {
    activeUriGet: () => undefined,
    activePositionGet: () => undefined,
    readinessSnapshotGet: () => ({ status: null }),
    semanticSearchInitialQueryResolve: () => undefined,
    semanticSearchPick: async () => undefined,
    renameTargetsLoad: async () => [],
    renameTargetPick: async () => undefined,
    renamePrompt: async () => undefined,
    architectureBaselineLabelGet: () => input.baselineLabel ?? '',
    architectureBaselineLabelPrompt: async () => undefined,
    quickPick: async () => undefined,
    infoShow: vi.fn(async () => {}),
    errorShow: vi.fn(async () => {}),
    openLocation: vi.fn(async () => {}),
    peekLocations: vi.fn(async () => {}),
  };
}

describe('CodepolCommandController.showDependencyDiff (real workspace fixture)', () => {
  const createdDirs: string[] = [];
  const disposers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) {
      try {
        await dispose();
      } catch {
        // best-effort fixture teardown
      }
    }
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses the configured baseline label and opens an empty panel when the live graph matches the snapshot', async () => {
    const fixture = fixtureWorkspaceCreate();
    createdDirs.push(fixture.rootPath);
    const { service, protocol, session, dispose } = await fixtureProtocolCreate(fixture);
    disposers.push(dispose);

    const baselineGraph = await service.queryDependencyGraph(session);
    const snapshotStore = fileSystemGraphSnapshotStoreCreate({
      rootPath: fixture.rootPath,
    });
    await snapshotStore.graphSnapshotWrite({
      label: 'base',
      snapshot: graphSnapshotFromDependencyGraphResult({
        graph: baselineGraph,
        workspaceRootId: graphSnapshotWorkspaceRootIdCompute(fixture.rootPath),
        label: 'base',
        analysisGeneration: 1,
        createdAtUnixMs: 1,
      }),
    });

    const panels = fakePanelsCreate();
    const host = fakeHostCreate({ baselineLabel: 'base' });
    const controller = new CodepolCommandController(protocol, panels, host);

    const model = await controller.showDependencyDiff();

    expect(model).not.toBeNull();
    expect(panels.showDependencyDiff).toHaveBeenCalledTimes(1);
    const opened = panels.showDependencyDiff.mock.calls[0]![0];
    expect(opened.baselineLabel).toBe('base');
    expect(opened.isEmpty).toBe(true);
    expect(opened.summary).toBe(
      'No dependency changes against the selected baseline.',
    );
  });

  it('renders added and removed rows plus a new cycle from a real baseline-vs-live mutation', async () => {
    const fixture = fixtureWorkspaceCreate();
    createdDirs.push(fixture.rootPath);
    const { service, protocol, session, dispose } = await fixtureProtocolCreate(fixture);
    disposers.push(dispose);

    const appUri = workspacePathToUri(fixture.files.app);
    const bUri = workspacePathToUri(fixture.files.b);
    const oldUri = workspacePathToUri(fixture.files.old);
    const newUri = workspacePathToUri(fixture.files.newFile);

    const baselineGraph = await service.queryDependencyGraph(session);
    const snapshotStore = fileSystemGraphSnapshotStoreCreate({
      rootPath: fixture.rootPath,
    });
    await snapshotStore.graphSnapshotWrite({
      label: 'base',
      snapshot: graphSnapshotFromDependencyGraphResult({
        graph: baselineGraph,
        workspaceRootId: graphSnapshotWorkspaceRootIdCompute(fixture.rootPath),
        label: 'base',
        analysisGeneration: 1,
        createdAtUnixMs: 1,
      }),
    });

    // Mutate the workspace after the snapshot:
    // - remove old.ts and the app -> old edge
    // - add new.ts and the app -> new edge
    // - add b -> app to create a new cycle (app <-> b)
    fs.rmSync(fixture.files.old, { force: true });
    fs.writeFileSync(
      fixture.files.newFile,
      'export const newValue = 3;\n',
      'utf8',
    );
    fs.writeFileSync(
      fixture.files.b,
      "import { app } from './app';\nexport const b = Number(app) + 2;\n",
      'utf8',
    );
    fs.writeFileSync(
      fixture.files.app,
      "import { b } from './b';\nimport { newValue } from './new';\nexport const app = b + newValue;\n",
      'utf8',
    );

    const panels = fakePanelsCreate();
    const host = fakeHostCreate({});
    const controller = new CodepolCommandController(protocol, panels, host);

    const model = await controller.showDependencyDiff({ baselineLabel: 'base' });

    expect(model).not.toBeNull();
    expect(panels.showDependencyDiff).toHaveBeenCalledTimes(1);
    const opened = panels.showDependencyDiff.mock.calls[0]![0];
    expect(opened.baselineLabel).toBe('base');
    expect(opened.isEmpty).toBe(false);

    expect(opened.sections.addedNodes.rows).toEqual([
      {
        uri: newUri,
        label: 'src/new.ts',
      },
    ]);
    expect(opened.sections.removedNodes.rows).toEqual([
      {
        uri: oldUri,
        label: 'src/old.ts',
      },
    ]);
    expect(
      opened.sections.addedEdges.rows.map((row: { label: string }) => row.label),
    ).toEqual([
      'src/app.ts → src/new.ts',
      'src/b.ts → src/app.ts',
    ]);
    expect(opened.sections.removedEdges.rows).toEqual([
      {
        uri: appUri,
        label: 'src/app.ts → src/old.ts',
        detail: `${appUri} → ${oldUri}`,
      },
    ]);
    expect(opened.sections.newCycles.rows).toEqual([
      {
        uri: appUri,
        label: 'src/app.ts',
        detail: 'src/app.ts → src/b.ts',
      },
    ]);
  });
});
