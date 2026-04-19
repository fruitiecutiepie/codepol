/**
 * Type-aware call-graph merge tests (Phase 9.2 / Gap 1).
 *
 * Pins the conflict-resolution table from Phase 9.2 / Step 4 and the
 * "type-aware never demotes structural" guarantee. We use an in-memory
 * fake `TypeAwareCallGraphSource` so the test does not depend on a
 * real language server.
 *
 * Coverage matrix:
 *
 * | In S? | In T? | Output `callGraphConfidence`        |
 * | ----- | ----- | ----------------------------------- |
 * | yes   | yes   | `'type-aware'` (kind from T)        |
 * | yes   | no    | `'structural'` (kind = 'direct')    |
 * | no    | yes   | `'type-aware'` (kind from T)        |
 *
 * Plus:
 *
 * - `requireTypeAware` with no source registered ⇒ structured error.
 * - Source rejection ⇒ structural-only result; no error propagates.
 * - No source bound and no `requireTypeAware` ⇒ result has NO new
 *   fields (byte-identical to legacy Phase 7 output).
 * - Deterministic edge ordering across runs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WorkspaceServiceEngine,
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';
import {
  typeAwareCallGraphSourceRegistryCreate,
  type TypeAwareCallEdge,
  type TypeAwareCallGraphSource,
  type WorkspaceCallGraphEdgeConfidence,
  type WorkspaceCallGraphEdgeKind,
} from '@codepol/core';

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

async function clientWorkspaceAttach(
  service: WorkspaceService,
  rootPath: string,
  configPath: string,
): Promise<{ clientSessionId: string; workspaceId: string }> {
  const registered = await service.registerClientSession({
    clientKind: 'test',
    clientInstanceId: `vitest-cg-typeaware-${process.pid}-${Math.random()}`,
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

async function symbolIdLookup(
  service: WorkspaceService,
  clientSessionId: string,
  workspaceId: string,
  name: string,
): Promise<string> {
  const result = await service.querySymbolLookup({
    clientSessionId,
    workspaceId,
    name,
  });
  expect(result.symbols.length).toBeGreaterThan(0);
  return result.symbols[0]!.symbolId;
}

type FixtureSetup = {
  service: WorkspaceService;
  engine: WorkspaceServiceEngine;
  clientSessionId: string;
  workspaceId: string;
  callerId: string;
  calleeId: string;
};

/**
 * Set up a tiny `caller -> callee` workspace and return both the
 * service and the resolved symbol ids. Both functions exist on the
 * structural call graph (caller invokes callee directly).
 */
async function callerCalleeFixtureCreate(
  prefix: string,
): Promise<FixtureSetup> {
  const root = tempWorkspaceCreate(prefix);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'codepol.toml'),
    pluginConfigContentCreate(),
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'a.ts'),
    `export function callee(): number { return 1; }\n` +
      `export function caller(): number { return callee(); }\n`,
    'utf8',
  );

  const engine = new WorkspaceServiceEngine();
  const service = workspaceServiceCreate({ engine });
  const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
    service,
    root,
    path.join(root, 'codepol.toml'),
  );
  const callerId = await symbolIdLookup(service, clientSessionId, workspaceId, 'caller');
  const calleeId = await symbolIdLookup(service, clientSessionId, workspaceId, 'callee');
  return { service, engine, clientSessionId, workspaceId, callerId, calleeId };
}

function staticSourceCreate(edges: TypeAwareCallEdge[]): TypeAwareCallGraphSource {
  return {
    typeAwareCallersGet: async () => edges,
    typeAwareCalleesGet: async () => edges,
  };
}

describe('workspace-service queryCallGraph (type-aware merge)', () => {
  it('falls back to structural-only output when no source is registered (byte-identical)', async () => {
    const { service, clientSessionId, workspaceId, callerId } =
      await callerCalleeFixtureCreate('codepol-cg-default-');

    const result = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: callerId,
      direction: 'callees',
    });
    expect(result.edges.length).toBeGreaterThan(0);
    for (const edge of result.edges) {
      expect(edge.callGraphConfidence).toBeUndefined();
      expect(edge.callGraphKind).toBeUndefined();
    }
  });

  it('throws a structured error when requireTypeAware is set and no source is registered', async () => {
    const { service, clientSessionId, workspaceId, callerId } =
      await callerCalleeFixtureCreate('codepol-cg-require-');

    let captured: unknown;
    try {
      await service.queryCallGraph({
        clientSessionId,
        workspaceId,
        symbolId: callerId,
        direction: 'callees',
        requireTypeAware: true,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeDefined();
    const err = captured as { code?: string; languageId?: string };
    expect(err.code).toBe('type-aware-source-missing');
    expect(err.languageId).toBe('typescript');
  });

  it('tags structural-only edges with confidence "structural" / kind "direct" when a source is registered', async () => {
    const { engine, service, clientSessionId, workspaceId, callerId, calleeId } =
      await callerCalleeFixtureCreate('codepol-cg-structural-');
    // Register a source that returns NO edges so every structural edge
    // falls into the `S∧¬T` row of the conflict-resolution table.
    engine.typeAwareCallGraphSourceRegister('typescript', staticSourceCreate([]));

    const result = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: callerId,
      direction: 'callees',
    });
    const survivor = result.edges.find(
      (edge) =>
        edge.fromUri.endsWith(encodeURIComponent(callerId)) &&
        edge.toUri.endsWith(encodeURIComponent(calleeId)),
    );
    expect(survivor).toBeDefined();
    expect(survivor!.callGraphConfidence).toBe<WorkspaceCallGraphEdgeConfidence>(
      'structural',
    );
    expect(survivor!.callGraphKind).toBe<WorkspaceCallGraphEdgeKind>('direct');
  });

  it('upgrades an overlapping edge to "type-aware" with the source-supplied callKind', async () => {
    const { engine, service, clientSessionId, workspaceId, callerId, calleeId } =
      await callerCalleeFixtureCreate('codepol-cg-overlap-');
    engine.typeAwareCallGraphSourceRegister(
      'typescript',
      staticSourceCreate([
        { callerSymbolId: callerId, calleeSymbolId: calleeId, callKind: 'dynamic-dispatch' },
      ]),
    );

    const result = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: callerId,
      direction: 'callees',
    });
    const survivor = result.edges.find(
      (edge) =>
        edge.fromUri.endsWith(encodeURIComponent(callerId)) &&
        edge.toUri.endsWith(encodeURIComponent(calleeId)),
    );
    expect(survivor).toBeDefined();
    expect(survivor!.callGraphConfidence).toBe<WorkspaceCallGraphEdgeConfidence>(
      'type-aware',
    );
    expect(survivor!.callGraphKind).toBe<WorkspaceCallGraphEdgeKind>('dynamic-dispatch');
  });

  it('adds type-aware-only edges that are absent from the structural set', async () => {
    const { engine, service, clientSessionId, workspaceId, callerId } =
      await callerCalleeFixtureCreate('codepol-cg-typeaware-only-');
    engine.typeAwareCallGraphSourceRegister(
      'typescript',
      staticSourceCreate([
        { callerSymbolId: callerId, calleeSymbolId: 'invented-callee', callKind: 'higher-order' },
      ]),
    );

    const result = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: callerId,
      direction: 'callees',
    });
    const invented = result.edges.find((edge) =>
      edge.toUri.endsWith(encodeURIComponent('invented-callee')),
    );
    expect(invented).toBeDefined();
    expect(invented!.callGraphConfidence).toBe('type-aware');
    expect(invented!.callGraphKind).toBe('higher-order');
  });

  it('preserves a structural edge missing from T (type-aware never demotes structural)', async () => {
    const { engine, service, clientSessionId, workspaceId, callerId, calleeId } =
      await callerCalleeFixtureCreate('codepol-cg-preserve-');
    engine.typeAwareCallGraphSourceRegister(
      'typescript',
      staticSourceCreate([
        { callerSymbolId: callerId, calleeSymbolId: 'unrelated', callKind: 'direct' },
      ]),
    );

    const result = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: callerId,
      direction: 'callees',
    });
    const structuralEdge = result.edges.find(
      (edge) =>
        edge.fromUri.endsWith(encodeURIComponent(callerId)) &&
        edge.toUri.endsWith(encodeURIComponent(calleeId)),
    );
    expect(structuralEdge).toBeDefined();
    expect(structuralEdge!.callGraphConfidence).toBe('structural');
  });

  it('falls back to structural when the source rejects', async () => {
    const { engine, service, clientSessionId, workspaceId, callerId } =
      await callerCalleeFixtureCreate('codepol-cg-reject-');
    engine.typeAwareCallGraphSourceRegister('typescript', {
      typeAwareCallersGet: async () => {
        throw new Error('language server crash');
      },
      typeAwareCalleesGet: async () => {
        throw new Error('language server crash');
      },
    });

    const result = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: callerId,
      direction: 'callees',
    });
    // The query succeeds; structural edges remain intact (untagged
    // because the source dropped out before merging contributed any
    // type-aware data).
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('produces deterministic edge ordering across runs', async () => {
    const { engine, service, clientSessionId, workspaceId, callerId } =
      await callerCalleeFixtureCreate('codepol-cg-determinism-');
    engine.typeAwareCallGraphSourceRegister(
      'typescript',
      staticSourceCreate([
        { callerSymbolId: callerId, calleeSymbolId: 'zzz', callKind: 'direct' },
        { callerSymbolId: callerId, calleeSymbolId: 'aaa', callKind: 'direct' },
      ]),
    );
    const first = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: callerId,
      direction: 'callees',
    });
    const second = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: callerId,
      direction: 'callees',
    });
    expect(second.edges.map((e) => `${e.fromUri}->${e.toUri}`)).toEqual(
      first.edges.map((e) => `${e.fromUri}->${e.toUri}`),
    );
  });

  it('engine accepts an externally constructed registry (no module-level singleton)', async () => {
    const root = tempWorkspaceCreate('codepol-cg-external-registry-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `export function alpha(): number { return 1; }\n`,
      'utf8',
    );
    const registry = typeAwareCallGraphSourceRegistryCreate();
    const engine = new WorkspaceServiceEngine({
      typeAwareCallGraphSourceRegistry: registry,
    });
    const service = workspaceServiceCreate({ engine });
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );
    // The registry passed in is the same object the engine consults.
    registry.typeAwareCallGraphSourceRegister('typescript', staticSourceCreate([]));
    const alphaId = await symbolIdLookup(service, clientSessionId, workspaceId, 'alpha');
    const result = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: alphaId,
      direction: 'callees',
    });
    // alpha has no callees structurally and the source returns nothing
    // — so the merge should yield an empty edge list with no errors.
    expect(result.edges).toEqual([]);
  });
});
