/**
 * Phase 6 integration tests for the workspace-service surface:
 *
 * - `queryDependencyDiff` (inline baseline + sidecar baseline)
 * - `codepol/architecture` diagnostic source emitted for cycles and
 *   dead modules through `queryDiagnostics`
 *
 * Both spin up a real {@link WorkspaceServiceEngine} against a temp
 * workspace so we exercise the engine, the graph snapshot store, and
 * the architecture-rule pipeline end-to-end.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspacePathToUri } from '@codepol/core';
import {
  fileSystemGraphSnapshotStoreCreate,
  graphSnapshotFromDependencyGraphResult,
  graphSnapshotWorkspaceRootIdCompute,
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';

const ARCHITECTURE_DIAGNOSTIC_SOURCE = 'codepol/architecture';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempWorkspaceCreate(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function pluginConfigContentCreate(): string {
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

function architectureConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "no-cycles"
ruleId = "@codepol/plugin/no-cycles"
description = "Reject cycles"
targets = ["src"]

[rules.args]
maxCycles = 50

[[rules]]
id = "dead-module"
ruleId = "@codepol/plugin/dead-module"
description = "Reject orphan modules"
targets = ["src"]

[rules.args]
entries = ["src/entry.ts"]
`;
}

async function clientWorkspaceAttach(
  service: WorkspaceService,
  rootPath: string,
  configPath: string,
): Promise<{ clientSessionId: string; workspaceId: string }> {
  const registered = await service.registerClientSession({
    clientKind: 'test',
    clientInstanceId: `vitest-phase6-${process.pid}-${Math.random()}`,
  });
  const attached = await service.attachWorkspace({
    clientSessionId: registered.clientSessionId,
    rootPath,
    configPath,
  });
  return {
    clientSessionId: registered.clientSessionId,
    workspaceId: attached.workspaceId,
  };
}

// ============================================================================
// queryDependencyDiff
// ============================================================================

describe('workspace-service queryDependencyDiff', () => {
  it('reports no diff when the live graph matches the inline baseline', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-diff-eq-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'a.ts'),
      `import { b } from './b';\nexport const a = b + 1;\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'b.ts'),
      `export const b = 1;\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    const baseline = await service.queryDependencyGraph({
      clientSessionId,
      workspaceId,
    });
    const diff = await service.queryDependencyDiff({
      clientSessionId,
      workspaceId,
      baselineGraph: baseline,
    });
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.addedEdges).toEqual([]);
    expect(diff.removedEdges).toEqual([]);
    expect(diff.newCycles).toEqual([]);
    expect(diff.removedCycles).toEqual([]);
  });

  it('detects added nodes / edges and new cycles introduced after the baseline', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-diff-new-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    const aPath = path.join(workspaceRoot, 'src', 'a.ts');
    const bPath = path.join(workspaceRoot, 'src', 'b.ts');
    fs.writeFileSync(aPath, `import { b } from './b';\nexport const a = b;\n`, 'utf8');
    fs.writeFileSync(bPath, `export const b = 1;\n`, 'utf8');

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );
    const baseline = await service.queryDependencyGraph({
      clientSessionId,
      workspaceId,
    });

    // Mutate via overlay: introduce a new file and a cycle.
    const cPath = path.join(workspaceRoot, 'src', 'c.ts');
    const cUri = workspacePathToUri(cPath);
    fs.writeFileSync(cPath, `export const c = 2;\n`, 'utf8');
    // Make b import a — completes the a <-> b cycle.
    fs.writeFileSync(
      bPath,
      `import { a } from './a';\nimport { c } from './c';\nexport const b = Number(a) + c;\n`,
      'utf8',
    );

    const diff = await service.queryDependencyDiff({
      clientSessionId,
      workspaceId,
      baselineGraph: baseline,
    });

    expect(diff.addedNodes.map((n) => n.uri)).toContain(cUri);
    const aUri = workspacePathToUri(aPath);
    const bUri = workspacePathToUri(bPath);
    // New edges: b -> a (closes cycle) and b -> c (uses new file).
    const addedEdgePairs = diff.addedEdges.map((edge) => `${edge.fromUri}->${edge.toUri}`);
    expect(addedEdgePairs).toContain(`${bUri}->${aUri}`);
    expect(addedEdgePairs).toContain(`${bUri}->${cUri}`);
    // New cycle (a, b) appears.
    expect(diff.newCycles.length).toBeGreaterThanOrEqual(1);
    const cycleSet = diff.newCycles[0]!;
    expect([...cycleSet].sort()).toEqual([aUri, bUri].sort());
  });

  it('reads the baseline from the sidecar snapshot store when given a label', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-diff-sidecar-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'a.ts'),
      `export const a = 1;\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    // Capture a snapshot to disk under the label "base".
    const baselineGraph = await service.queryDependencyGraph({
      clientSessionId,
      workspaceId,
    });
    const store = fileSystemGraphSnapshotStoreCreate({ rootPath: workspaceRoot });
    const snapshot = graphSnapshotFromDependencyGraphResult({
      graph: baselineGraph,
      workspaceRootId: graphSnapshotWorkspaceRootIdCompute(workspaceRoot),
      label: 'base',
    });
    await store.graphSnapshotWrite({ label: 'base', snapshot });

    const diff = await service.queryDependencyDiff({
      clientSessionId,
      workspaceId,
      baselineLabel: 'base',
    });
    expect(diff.baselineLabel).toBe('base');
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
  });

  it('throws a clear error when both baselineLabel and baselineGraph are passed', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-diff-bad-input-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'a.ts'),
      `export const a = 1;\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    await expect(
      service.queryDependencyDiff({
        clientSessionId,
        workspaceId,
        baselineLabel: 'base',
        baselineGraph: {
          nodes: [],
          edges: [],
          entryPoints: [],
          cycles: [],
        },
      }),
    ).rejects.toThrow(/exactly one/);

    await expect(
      service.queryDependencyDiff({ clientSessionId, workspaceId }),
    ).rejects.toThrow(/exactly one/);
  });

  it('rejects a baseline label that points to a snapshot from a different workspace', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-diff-rootid-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'a.ts'),
      `export const a = 1;\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    // Write a snapshot whose workspaceRootId is for a *different* root.
    const store = fileSystemGraphSnapshotStoreCreate({ rootPath: workspaceRoot });
    const wrongRootSnapshot = graphSnapshotFromDependencyGraphResult({
      graph: { nodes: [], edges: [], entryPoints: [], cycles: [] },
      workspaceRootId: graphSnapshotWorkspaceRootIdCompute('/some/other/repo'),
      label: 'base',
    });
    await store.graphSnapshotWrite({ label: 'base', snapshot: wrongRootSnapshot });

    await expect(
      service.queryDependencyDiff({
        clientSessionId,
        workspaceId,
        baselineLabel: 'base',
      }),
    ).rejects.toThrow(/different workspace/);
  });
});

// ============================================================================
// codepol/architecture diagnostics
// ============================================================================

describe('workspace-service codepol/architecture diagnostics', () => {
  it('emits a diagnostic for each cycle under the codepol/architecture source', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-arch-cycle-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      architectureConfigContentCreate(),
      'utf8',
    );
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const aPath = path.join(workspaceRoot, 'src', 'a.ts');
    const bPath = path.join(workspaceRoot, 'src', 'b.ts');
    fs.writeFileSync(
      entryPath,
      `import { a } from './a';\nexport const entry = a;\n`,
      'utf8',
    );
    fs.writeFileSync(
      aPath,
      `import { b } from './b';\nexport const a = b;\n`,
      'utf8',
    );
    fs.writeFileSync(
      bPath,
      `import { a } from './a';\nexport const b = a;\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    const diagnostics = await service.queryDiagnostics({
      clientSessionId,
      workspaceId,
    });

    const archDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.source === ARCHITECTURE_DIAGNOSTIC_SOURCE,
    );
    expect(archDiagnostics.length).toBeGreaterThanOrEqual(1);

    const cycle = archDiagnostics.find((diagnostic) => diagnostic.code === 'no-cycles');
    expect(cycle).toBeDefined();
    expect(cycle?.severity).toBe('info');
    expect(cycle?.message.toLowerCase()).toContain('circular');
  });

  it('emits a diagnostic for unreachable modules', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-arch-dead-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      architectureConfigContentCreate(),
      'utf8',
    );
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const orphanPath = path.join(workspaceRoot, 'src', 'orphan.ts');
    fs.writeFileSync(entryPath, `export const entry = 1;\n`, 'utf8');
    fs.writeFileSync(orphanPath, `export const orphan = 99;\n`, 'utf8');

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    const diagnostics = await service.queryDiagnostics({
      clientSessionId,
      workspaceId,
    });

    const dead = diagnostics.find(
      (diagnostic) =>
        diagnostic.source === ARCHITECTURE_DIAGNOSTIC_SOURCE &&
        diagnostic.code === 'dead-module',
    );
    expect(dead).toBeDefined();
    expect(dead?.uri).toBe(workspacePathToUri(orphanPath));
  });

  it('does not emit codepol/architecture diagnostics when no architecture rule is declared', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-arch-noop-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'a.ts'),
      `export const a = 1;\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    const diagnostics = await service.queryDiagnostics({
      clientSessionId,
      workspaceId,
    });
    expect(
      diagnostics.find((diagnostic) => diagnostic.source === ARCHITECTURE_DIAGNOSTIC_SOURCE),
    ).toBeUndefined();
  });
});
