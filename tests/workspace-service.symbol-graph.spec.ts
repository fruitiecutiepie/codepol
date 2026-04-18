/**
 * Phase 7 integration tests for the workspace-service surface:
 *
 * - `queryCallGraph` over a real `WorkspaceServiceEngine`
 * - `queryTypeHierarchy` over a real `WorkspaceServiceEngine`
 *
 * The public workspace-service surface does not expose a "lookup symbol
 * id by name" entry point — symbol ids are opaque, stable, and produced
 * inside the index. These tests therefore exercise the call-graph /
 * type-hierarchy contract using two angles that *are* on the public
 * surface:
 *
 * 1. Unknown-id behavior — passing a symbol id the index does not know
 *    must return a seed-only subgraph with the synthetic
 *    `codepol-symbol://` URI, the echoed `symbolId` field, empty
 *    `edges`, and empty `entryPoints` / `cycles`. This confirms the
 *    response shape, the graceful-degradation contract, the daemon
 *    round-trip, and the URI encoding.
 *
 * 2. Round-trip-id behavior — once a real id appears on a returned
 *    node, feeding it back into the same query must produce a node
 *    with the same `symbolId` and the same synthetic `uri`. This
 *    confirms callers can chain `queryCallGraph` calls without an
 *    out-of-band symbol-id discovery hop.
 *
 * Deep semantic correctness (caller / callee structure across the
 * index) is covered by the unit suite in
 * `tests/index.symbol-graph-queries.spec.ts`, which exercises the pure
 * traversal helpers against in-memory views without any reliance on
 * tree-sitter or the workspace lifecycle.
 *
 * Known fidelity caveats documented in Phase 7:
 *
 * - dynamic dispatch and higher-order calls are *not* tracked
 * - calls that flow through re-exports are not resolved by the
 *   structural call graph
 * - structural typing (interfaces matched by shape) is not modeled
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';

const SYMBOL_URI_SCHEME_PREFIX = 'codepol-symbol://';

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
    clientInstanceId: `vitest-phase7-${process.pid}-${Math.random()}`,
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
// queryCallGraph
// ============================================================================

describe('workspace-service queryCallGraph', () => {
  it('returns a seed-only subgraph when the symbol id is unknown to the index', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-callgraph-unknown-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'a.ts'),
      `export function alpha(): number { return 1; }\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    const result = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: 'symbol-that-does-not-exist',
      direction: 'both',
    });

    expect(result.nodes).toHaveLength(1);
    const seed = result.nodes[0]!;
    expect(seed.symbolId).toBe('symbol-that-does-not-exist');
    expect(seed.uri.startsWith(SYMBOL_URI_SCHEME_PREFIX)).toBe(true);
    expect(seed.uri).toBe(
      `${SYMBOL_URI_SCHEME_PREFIX}${encodeURIComponent('symbol-that-does-not-exist')}`,
    );
    expect(result.edges).toEqual([]);
    expect(result.entryPoints).toEqual([]);
    expect(result.cycles).toEqual([]);
  });

  it('echoes the same symbolId / uri pair when the seed is fed back in', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-callgraph-roundtrip-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'a.ts'),
      `export function alpha(): number { return 1; }\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    const first = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: 'opaque-id',
      direction: 'callees',
    });
    const second = await service.queryCallGraph({
      clientSessionId,
      workspaceId,
      symbolId: first.nodes[0]!.symbolId!,
      direction: 'callees',
    });
    expect(second.nodes[0]!.uri).toBe(first.nodes[0]!.uri);
    expect(second.nodes[0]!.symbolId).toBe(first.nodes[0]!.symbolId);
  });
});

// ============================================================================
// queryTypeHierarchy
// ============================================================================

describe('workspace-service queryTypeHierarchy', () => {
  it('returns a seed-only subgraph when the symbol id is unknown to the index', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-typehier-unknown-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'a.ts'),
      `export interface Animal { name(): string; }\n` +
        `export class Dog implements Animal { name() { return 'dog'; } }\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: 'symbol-that-does-not-exist',
      direction: 'both',
    });

    expect(result.nodes).toHaveLength(1);
    const seed = result.nodes[0]!;
    expect(seed.symbolId).toBe('symbol-that-does-not-exist');
    expect(seed.uri.startsWith(SYMBOL_URI_SCHEME_PREFIX)).toBe(true);
    expect(result.edges).toEqual([]);
    expect(result.entryPoints).toEqual([]);
    expect(result.cycles).toEqual([]);
  });
});
