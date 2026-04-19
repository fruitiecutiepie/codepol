/**
 * Phase 7 follow-up: integration tests for the symbol-id discovery
 * surface on `WorkspaceServiceEngine`.
 *
 * Closes the "symbol-id discovery is out of scope for MVP" gap that
 * previous Phase 7 work left open. The contract is two queries:
 *
 * - `querySymbolLookup` — name-based discovery (with optional kind /
 *   file scope and a deterministic limit) returning
 *   {@link WorkspaceSymbolDescriptor}s.
 * - `querySymbolAtPosition` — cursor-based discovery returning the
 *   smallest indexed symbol whose declaration byte range contains the
 *   editor position.
 *
 * The descriptors share their shape with the symbol fields on
 * `WorkspaceDependencyGraphNode`, so a discovered descriptor flows
 * straight into `queryCallGraph` / `queryTypeHierarchy` without any
 * translation step. The round-trip case at the bottom asserts that
 * end-to-end chain.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';

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
    clientInstanceId: `vitest-symbol-lookup-${process.pid}-${Math.random()}`,
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

type LookupWorkspace = {
  service: WorkspaceService;
  clientSessionId: string;
  workspaceId: string;
  rootPath: string;
  fileAUri: string;
  fileBUri: string;
};

async function lookupWorkspaceCreate(prefix: string): Promise<LookupWorkspace> {
  const workspaceRoot = tempWorkspaceCreate(prefix);
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, 'codepol.toml'),
    pluginConfigContentCreate(),
    'utf8',
  );
  // File A — declares `helper` (function) and `helper` (variable) and `Animal` (class).
  // The two `helper` symbols share a name but differ in kind so the
  // kind filter is exercised.
  const fileAPath = path.join(workspaceRoot, 'src', 'a.ts');
  fs.writeFileSync(
    fileAPath,
    `export function helper(value: number): number {\n` +
      `  return value + 1;\n` +
      `}\n` +
      `\n` +
      `export const helperConst = 42;\n` +
      `\n` +
      `export class Animal {\n` +
      `  speak(): string {\n` +
      `    return 'sound';\n` +
      `  }\n` +
      `}\n`,
    'utf8',
  );
  // File B — declares another `helper` (function). Forces the lookup
  // to consider multiple files unless `scopeUri` narrows it down.
  const fileBPath = path.join(workspaceRoot, 'src', 'b.ts');
  fs.writeFileSync(
    fileBPath,
    `export function helper(label: string): string {\n` +
      `  return label.toUpperCase();\n` +
      `}\n`,
    'utf8',
  );

  const service = workspaceServiceCreate();
  const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
    service,
    workspaceRoot,
    path.join(workspaceRoot, 'codepol.toml'),
  );
  return {
    service,
    clientSessionId,
    workspaceId,
    rootPath: workspaceRoot,
    fileAUri: pathToFileURL(fileAPath).href,
    fileBUri: pathToFileURL(fileBPath).href,
  };
}

// ============================================================================
// querySymbolLookup
// ============================================================================

describe('workspace-service querySymbolLookup', () => {
  it('returns deterministically sorted descriptors across files matching by name', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-lookup-name-');
    const { symbols } = await ws.service.querySymbolLookup({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      name: 'helper',
    });
    // Three symbols match the name `helper`:
    //   - src/a.ts function helper
    //   - src/a.ts const helperConst   ← does NOT match (different name)
    //   - src/b.ts function helper
    // The const declaration is named `helperConst`, not `helper`, so
    // it should not appear in the result set.
    expect(symbols.map((s) => s.name)).toEqual(['helper', 'helper']);
    expect(symbols.map((s) => s.kind)).toEqual(['function', 'function']);
    // Deterministic order: sorted by (declarationUri, byteRange.start).
    expect(symbols.map((s) => s.declarationUri)).toEqual([
      ws.fileAUri,
      ws.fileBUri,
    ]);
    for (const symbol of symbols) {
      expect(symbol.symbolId).toMatch(/.+/);
      expect(symbol.declarationRange.start.line).toBe(0);
    }
  });

  it('filters by kind when the kind argument is provided', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-lookup-kind-');
    const functions = await ws.service.querySymbolLookup({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      name: 'helper',
      kind: 'function',
    });
    expect(functions.symbols.every((s) => s.kind === 'function')).toBe(true);
    expect(functions.symbols.length).toBeGreaterThan(0);

    const classes = await ws.service.querySymbolLookup({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      name: 'Animal',
      kind: 'class',
    });
    expect(classes.symbols).toHaveLength(1);
    expect(classes.symbols[0]!.kind).toBe('class');
    expect(classes.symbols[0]!.name).toBe('Animal');
    expect(classes.symbols[0]!.declarationUri).toBe(ws.fileAUri);
  });

  it('restricts the search to a single file when scopeUri is set', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-lookup-scope-');
    const scoped = await ws.service.querySymbolLookup({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      name: 'helper',
      scopeUri: ws.fileBUri,
    });
    expect(scoped.symbols).toHaveLength(1);
    expect(scoped.symbols[0]!.declarationUri).toBe(ws.fileBUri);
  });

  it('trims to the supplied limit while keeping the deterministic order', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-lookup-limit-');
    const limited = await ws.service.querySymbolLookup({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      name: 'helper',
      limit: 1,
    });
    expect(limited.symbols).toHaveLength(1);
    // The first match in the deterministic ordering is the file-A
    // declaration because A < B in the URI sort.
    expect(limited.symbols[0]!.declarationUri).toBe(ws.fileAUri);
  });

  it('returns an empty array when no symbol matches the name', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-lookup-empty-');
    const result = await ws.service.querySymbolLookup({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      name: '__nothing_named_this_in_the_workspace__',
    });
    expect(result.symbols).toEqual([]);
  });

  it('returns an empty array when scopeUri is malformed (no throw)', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-lookup-bad-uri-');
    const result = await ws.service.querySymbolLookup({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      name: 'helper',
      scopeUri: 'not-a-real-uri',
    });
    expect(result.symbols).toEqual([]);
  });
});

// ============================================================================
// querySymbolAtPosition
// ============================================================================

describe('workspace-service querySymbolAtPosition', () => {
  it('returns the smallest enclosing symbol at the cursor position', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-at-pos-method-');
    // The class `Animal` declaration is at file A line 6 in our fixture
    // (function helper spans lines 0-2, const helperConst is line 4,
    //  class Animal opens line 6 and contains a method `speak` on line 7).
    // Position inside the body of `speak` should resolve to the
    // innermost matching symbol — the method, not the class.
    const result = await ws.service.querySymbolAtPosition({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      uri: ws.fileAUri,
      position: { line: 8, character: 12 },
    });
    expect(result.symbol).toBeDefined();
    expect(result.symbol!.kind).toBe('method');
    expect(result.symbol!.name).toBe('speak');
    expect(result.symbol!.declarationUri).toBe(ws.fileAUri);
  });

  it('returns undefined when the cursor is on whitespace outside any declaration', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-at-pos-blank-');
    const result = await ws.service.querySymbolAtPosition({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      uri: ws.fileAUri,
      position: { line: 3, character: 0 },
    });
    expect(result).toEqual({ symbol: undefined });
  });

  it('returns undefined for an unindexed (or unknown) URI', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-at-pos-unknown-');
    const phantomUri = pathToFileURL(
      path.join(ws.rootPath, 'src', 'does-not-exist.ts'),
    ).href;
    const result = await ws.service.querySymbolAtPosition({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      uri: phantomUri,
      position: { line: 0, character: 0 },
    });
    expect(result).toEqual({ symbol: undefined });
  });

  it('returns undefined for a malformed URI rather than throwing', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-at-pos-bad-uri-');
    const result = await ws.service.querySymbolAtPosition({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      uri: 'not-a-real-uri',
      position: { line: 0, character: 0 },
    });
    expect(result).toEqual({ symbol: undefined });
  });

  it('produces a descriptor that feeds straight into queryCallGraph without translation', async () => {
    const ws = await lookupWorkspaceCreate('codepol-ws-sym-roundtrip-');
    const lookup = await ws.service.querySymbolLookup({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      name: 'helper',
      kind: 'function',
      scopeUri: ws.fileAUri,
    });
    expect(lookup.symbols).toHaveLength(1);
    const descriptor = lookup.symbols[0]!;

    // Feed the discovered symbolId straight into the call-graph query.
    const callGraph = await ws.service.queryCallGraph({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      symbolId: descriptor.symbolId,
      direction: 'both',
    });
    // The seed node must echo the same symbolId; nodes carry the
    // synthetic codepol-symbol:// URI (file:// → codepol-symbol://
    // translation lives entirely inside the workspace service).
    expect(callGraph.nodes.length).toBeGreaterThanOrEqual(1);
    const seed = callGraph.nodes.find((n) => n.symbolId === descriptor.symbolId);
    expect(seed).toBeDefined();
    expect(seed!.symbolName).toBe('helper');
    expect(seed!.symbolKind).toBe('function');
  });
});
