/**
 * End-to-end fixture test for the Phase 2 user-facing extension surfaces.
 *
 * The view-model / render / command / manager specs all use mocks. This
 * spec is the only place that stitches the controller against a *real*
 * `WorkspaceServiceEngine` running over a temp workspace fixture, so the
 * worry "did I get the URI / argument shape wrong somewhere along the
 * pipe?" actually fires before the user sees an empty panel.
 *
 * Coverage:
 *
 * - `showDependencyPath` against a 4-file chain `app.ts → b.ts → c.ts
 *   → d.ts` resolves the indexed file set, runs the picker, fires
 *   `queryDependencyPath`, and produces a panel view model whose
 *   `paths` and `workspaceRelativePath` strings come straight from the
 *   real workspace service
 * - chip replay (`maxPaths: 20`) re-fires the workspace query and
 *   returns the same path with the truncation flag updated
 * - `showDeadModules` with natural entry points lists the workspace's
 *   orphan files using their real workspace-relative paths
 * - `showDeadModules` with a caller-supplied entry point computes a
 *   different unreachable set against the live module graph
 *
 * The test wires:
 *
 * - real `workspaceServiceCreate()` over a temp workspace
 * - a thin `CodepolProtocolClient` adapter that pre-binds
 *   `clientSessionId` / `workspaceId` so the controller's call sites
 *   stay byte-identical to production
 * - a fake `CodepolPanels` that captures `showDependencyPath` /
 *   `showDeadModules` invocations
 * - a fake `CodepolCommandHost` whose `quickPick` deterministically
 *   returns the test's destination URI
 *
 * No vscode mock — the controller does not depend on `vscode`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspacePathToUri } from '@codepol/core';
import { workspaceServiceCreate } from '@codepol/workspace-service';
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

/**
 * Stand up a workspace shaped like:
 *
 * ```
 *   app.ts ─→ b.ts ─→ c.ts ─→ d.ts
 *   orphan.ts        (unreachable from app.ts)
 * ```
 *
 * `app.ts` and `orphan.ts` are both natural entry points (nothing
 * imports them); `d.ts` is a leaf imported only by `c.ts`.
 */
function fixtureWorkspaceCreate(): {
  rootPath: string;
  configPath: string;
  files: {
    app: string;
    b: string;
    c: string;
    d: string;
    orphan: string;
  };
} {
  const rootPath = tempWorkspaceCreate('codepol-phase2-extension-fixture-');
  fs.mkdirSync(path.join(rootPath, 'src'), { recursive: true });
  const configPath = path.join(rootPath, 'codepol.toml');
  fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

  const app = path.join(rootPath, 'src', 'app.ts');
  const b = path.join(rootPath, 'src', 'b.ts');
  const c = path.join(rootPath, 'src', 'c.ts');
  const d = path.join(rootPath, 'src', 'd.ts');
  const orphan = path.join(rootPath, 'src', 'orphan.ts');

  fs.writeFileSync(d, 'export const leaf = 1;\n', 'utf8');
  fs.writeFileSync(
    c,
    "import { leaf } from './d';\nexport const three = leaf;\n",
    'utf8',
  );
  fs.writeFileSync(
    b,
    "import { three } from './c';\nexport const two = three;\n",
    'utf8',
  );
  fs.writeFileSync(
    app,
    "import { two } from './b';\nexport const entry = two;\n",
    'utf8',
  );
  fs.writeFileSync(orphan, 'export const lonely = true;\n', 'utf8');

  return { rootPath, configPath, files: { app, b, c, d, orphan } };
}

/**
 * Wire a real `workspaceServiceCreate()` engine, attach a session
 * against the temp workspace, and return a `CodepolProtocolClient`
 * shape that pre-binds `clientSessionId` / `workspaceId`. Only the
 * methods the Phase 2 extension surface actually calls are
 * implemented; the rest assert if invoked so accidental coupling
 * surfaces immediately.
 */
async function fixtureProtocolCreate(input: {
  rootPath: string;
  configPath: string;
}): Promise<{
  protocol: CodepolProtocolClient;
  dispose: () => Promise<void>;
}> {
  const service = workspaceServiceCreate();
  const registered = await service.registerClientSession({
    clientKind: 'test',
    clientInstanceId: 'phase2-extension-fixture',
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
    queryArchitectureSummary: async () =>
      service.queryArchitectureSummary(session),
    queryDependencyGraph: async () => service.queryDependencyGraph(session),
    queryImpactRadius: async (input) =>
      service.queryImpactRadius({ ...session, ...input }),
    queryDependencyPath: async (input) =>
      service.queryDependencyPath({ ...session, ...input }),
    queryDeadModules: async (input) =>
      service.queryDeadModules({ ...session, ...input }),
    queryDependencyDiff: unimplemented('queryDependencyDiff') as never,
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
    protocol,
    dispose: async () => {
      await service.closeClientSession({
        clientSessionId: registered.clientSessionId,
      });
    },
  };
}

function fakePanelsCreate(): CodepolPanels & {
  showDependencyPath: ReturnType<typeof vi.fn>;
  showDeadModules: ReturnType<typeof vi.fn>;
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
  };
}

function fakeHostCreate(input: {
  activeUri: string | undefined;
  /** Quick-pick chooses the first item whose `value` matches. */
  pickValue?: string;
}) {
  return {
    activeUriGet: () => input.activeUri,
    activePositionGet: () => undefined,
    readinessSnapshotGet: () => ({ status: null }),
    semanticSearchInitialQueryResolve: () => undefined,
    semanticSearchPick: async () => undefined,
    renameTargetsLoad: async () => [],
    renameTargetPick: async () => undefined,
    renamePrompt: async () => undefined,
    quickPick: async <T>(pickInput: {
      items: Array<{ value: T }>;
    }): Promise<T | undefined> => {
      if (input.pickValue === undefined) {
        return pickInput.items[0]?.value;
      }
      const matched = pickInput.items.find(
        (item) => (item.value as unknown) === input.pickValue,
      );
      return matched?.value;
    },
    infoShow: vi.fn(async () => {}),
    errorShow: vi.fn(async () => {}),
    openLocation: vi.fn(async () => {}),
    peekLocations: vi.fn(async () => {}),
  };
}

describe('Phase 2 user-facing extension surfaces (real workspace fixture)', () => {
  const createdDirs: string[] = [];
  const disposers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) {
      try {
        await dispose();
      } catch {}
    }
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('showDependencyPath produces a view model whose paths and workspace-relative paths come from the real workspace service', async () => {
    const fixture = fixtureWorkspaceCreate();
    createdDirs.push(fixture.rootPath);
    const { protocol, dispose } = await fixtureProtocolCreate(fixture);
    disposers.push(dispose);

    const appUri = workspacePathToUri(fixture.files.app);
    const dUri = workspacePathToUri(fixture.files.d);

    const panels = fakePanelsCreate();
    const host = fakeHostCreate({ activeUri: appUri, pickValue: dUri });
    const controller = new CodepolCommandController(protocol, panels, host);

    const initial = await controller.showDependencyPath();

    expect(initial).not.toBeNull();
    expect(panels.showDependencyPath).toHaveBeenCalledTimes(1);

    const opened = panels.showDependencyPath.mock.calls[0]![0];
    expect(opened.fromUri).toBe(appUri);
    expect(opened.toUri).toBe(dUri);
    expect(opened.fromWorkspaceRelativePath).toBe('src/app.ts');
    expect(opened.toWorkspaceRelativePath).toBe('src/d.ts');
    expect(opened.headline).toBe('Shortest path: 3 hops');
    expect(opened.shortestLength).toBe(3);
    expect(opened.maxPaths).toBe(5);
    expect(opened.truncated).toBe(false);
    expect(opened.paths).toHaveLength(1);
    expect(
      opened.paths[0]!.nodes.map((n: { workspaceRelativePath: string }) =>
        n.workspaceRelativePath,
      ),
    ).toEqual(['src/app.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
  });

  it('showDependencyPath rebuilder replays queryDependencyPath through the real service with a new maxPaths cap', async () => {
    const fixture = fixtureWorkspaceCreate();
    createdDirs.push(fixture.rootPath);
    const { protocol, dispose } = await fixtureProtocolCreate(fixture);
    disposers.push(dispose);

    const appUri = workspacePathToUri(fixture.files.app);
    const dUri = workspacePathToUri(fixture.files.d);

    const panels = fakePanelsCreate();
    const host = fakeHostCreate({ activeUri: appUri, pickValue: dUri });
    const controller = new CodepolCommandController(protocol, panels, host);

    await controller.showDependencyPath();

    const rebuilder = panels.showDependencyPath.mock.calls[0]![1] as (input: {
      maxPaths: 5 | 10 | 20;
    }) => Promise<unknown>;
    expect(typeof rebuilder).toBe('function');

    const rebuilt = (await rebuilder({ maxPaths: 20 })) as {
      maxPaths: number;
      paths: Array<{ nodes: Array<{ workspaceRelativePath: string }> }>;
      truncated: boolean;
    };

    expect(rebuilt.maxPaths).toBe(20);
    expect(rebuilt.paths).toHaveLength(1);
    expect(
      rebuilt.paths[0]!.nodes.map((n) => n.workspaceRelativePath),
    ).toEqual(['src/app.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
    expect(rebuilt.truncated).toBe(false);
  });

  it('showDeadModules with natural entry points reports an empty unreachable set when every file is its own root', async () => {
    const fixture = fixtureWorkspaceCreate();
    createdDirs.push(fixture.rootPath);
    const { protocol, dispose } = await fixtureProtocolCreate(fixture);
    disposers.push(dispose);

    const panels = fakePanelsCreate();
    const host = fakeHostCreate({ activeUri: undefined });
    const controller = new CodepolCommandController(protocol, panels, host);

    const model = await controller.showDeadModules();

    expect(model).not.toBeNull();
    expect(panels.showDeadModules).toHaveBeenCalledTimes(1);
    const opened = panels.showDeadModules.mock.calls[0]![0];
    // `app.ts` and `orphan.ts` are both natural entry points, so
    // forward reachability covers every file in the workspace.
    expect(opened.totalUnreachable).toBe(0);
    expect(opened.summary).toBe('Entry points: natural');
  });

  it('showDeadModules with a caller-supplied entry point reports the orphan as unreachable using its real workspace-relative path', async () => {
    const fixture = fixtureWorkspaceCreate();
    createdDirs.push(fixture.rootPath);
    const { protocol, dispose } = await fixtureProtocolCreate(fixture);
    disposers.push(dispose);

    const appUri = workspacePathToUri(fixture.files.app);
    const orphanUri = workspacePathToUri(fixture.files.orphan);

    const panels = fakePanelsCreate();
    const host = fakeHostCreate({ activeUri: appUri });
    const controller = new CodepolCommandController(protocol, panels, host);

    await controller.showDeadModules({ entryPointUris: [appUri] });

    const opened = panels.showDeadModules.mock.calls[0]![0];
    expect(opened.totalUnreachable).toBe(1);
    expect(opened.summary).toBe('Entry points: src/app.ts');
    expect(opened.groups).toHaveLength(1);
    expect(opened.groups[0]!.directoryWorkspaceRelativePath).toBe('src');
    expect(opened.groups[0]!.files).toEqual([
      {
        uri: orphanUri,
        workspaceRelativePath: 'src/orphan.ts',
        basename: 'orphan.ts',
      },
    ]);
  });

  it('showDependencyPath surfaces an error when the active file is not in the indexed workspace', async () => {
    const fixture = fixtureWorkspaceCreate();
    createdDirs.push(fixture.rootPath);
    const { protocol, dispose } = await fixtureProtocolCreate(fixture);
    disposers.push(dispose);

    const outsideUri = 'file:///not/in/workspace.ts';

    const panels = fakePanelsCreate();
    const host = fakeHostCreate({ activeUri: outsideUri });
    const controller = new CodepolCommandController(protocol, panels, host);

    const model = await controller.showDependencyPath();

    expect(model).toBeNull();
    expect(panels.showDependencyPath).not.toHaveBeenCalled();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Codepol has not indexed the active file yet.',
    );
  });
});
