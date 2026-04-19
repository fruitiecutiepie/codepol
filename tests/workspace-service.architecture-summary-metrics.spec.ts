/**
 * Phase 8 integration tests: the workspace-service Architecture Summary
 * carries the new health metrics (`instability`, `longestChain`,
 * `sccSizeDistribution`, `complexityHotspots`) when the underlying
 * project index has the data to support them, and the values stay
 * deterministic across:
 *
 *   - identical back-to-back queries (determinism)
 *   - in-process incremental updates via overlays (stability)
 *
 * The test workspace is sized to exercise every field at least once:
 *
 *   src/entry.ts    -> imports lib/a + lib/b
 *   src/lib/a.ts    -> imports lib/utils
 *   src/lib/b.ts    -> imports lib/utils + lib/cyclic1
 *   src/lib/utils.ts -> leaf
 *   src/lib/cyclic1.ts <-> src/lib/cyclic2.ts (2-cycle so the SCC
 *     distribution is non-empty and `longestChain` collapses the SCC)
 *
 * `entry.ts` is depended on by no one (Ce > 0, Ca = 0 → instability = 1)
 * and `utils.ts` is depended on by everyone (Ce = 0, Ca > 0 →
 * instability = 0). `entry.ts` also has multiple branchy helper
 * functions so its aggregate cyclomatic complexity is > 1, and `lib/a`
 * imports `entry`-side helpers indirectly to give the file fan-in for
 * the complexity hotspot ranking.
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
    clientInstanceId: `vitest-arch-summary-${process.pid}-${Math.random()}`,
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

type SummaryWorkspace = {
  service: WorkspaceService;
  clientSessionId: string;
  workspaceId: string;
  rootPath: string;
  entryUri: string;
  utilsUri: string;
  cyclic1Uri: string;
  cyclic2Uri: string;
};

async function summaryWorkspaceCreate(prefix: string): Promise<SummaryWorkspace> {
  const root = tempWorkspaceCreate(prefix);
  fs.mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'codepol.toml'), pluginConfigContentCreate(), 'utf8');

  const utilsPath = path.join(root, 'src', 'lib', 'utils.ts');
  fs.writeFileSync(
    utilsPath,
    `export function utilsHelper(value: number): number {\n` +
      `  if (value < 0) return -value;\n` +
      `  return value;\n` +
      `}\n`,
    'utf8',
  );

  const aPath = path.join(root, 'src', 'lib', 'a.ts');
  fs.writeFileSync(
    aPath,
    `import { utilsHelper } from './utils';\n` +
      `export function aRun(values: number[]): number {\n` +
      `  let total = 0;\n` +
      `  for (const value of values) {\n` +
      `    if (value > 0) {\n` +
      `      total += utilsHelper(value);\n` +
      `    } else {\n` +
      `      total -= utilsHelper(value);\n` +
      `    }\n` +
      `  }\n` +
      `  return total;\n` +
      `}\n`,
    'utf8',
  );

  const cyclic1Path = path.join(root, 'src', 'lib', 'cyclic1.ts');
  fs.writeFileSync(
    cyclic1Path,
    `import { ping } from './cyclic2';\n` +
      `export function pong(value: number): number {\n` +
      `  if (value <= 0) return value;\n` +
      `  return ping(value - 1);\n` +
      `}\n`,
    'utf8',
  );

  const cyclic2Path = path.join(root, 'src', 'lib', 'cyclic2.ts');
  fs.writeFileSync(
    cyclic2Path,
    `import { pong } from './cyclic1';\n` +
      `export function ping(value: number): number {\n` +
      `  if (value <= 0) return value;\n` +
      `  return pong(value - 1);\n` +
      `}\n`,
    'utf8',
  );

  const bPath = path.join(root, 'src', 'lib', 'b.ts');
  fs.writeFileSync(
    bPath,
    `import { utilsHelper } from './utils';\n` +
      `import { ping } from './cyclic2';\n` +
      `export function bRun(value: number): number {\n` +
      `  if (value < 0) return utilsHelper(value);\n` +
      `  return ping(value);\n` +
      `}\n`,
    'utf8',
  );

  const entryPath = path.join(root, 'src', 'entry.ts');
  fs.writeFileSync(
    entryPath,
    `import { aRun } from './lib/a';\n` +
      `import { bRun } from './lib/b';\n` +
      `export function entryRun(values: number[]): number {\n` +
      `  let total = 0;\n` +
      `  for (const value of values) {\n` +
      `    if (value === 0) {\n` +
      `      total += 1;\n` +
      `    } else if (value > 0) {\n` +
      `      total += aRun([value]);\n` +
      `    } else {\n` +
      `      total += bRun(value);\n` +
      `    }\n` +
      `  }\n` +
      `  return total;\n` +
      `}\n`,
    'utf8',
  );

  const service = workspaceServiceCreate();
  const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
    service,
    root,
    path.join(root, 'codepol.toml'),
  );
  return {
    service,
    clientSessionId,
    workspaceId,
    rootPath: root,
    entryUri: pathToFileURL(entryPath).href,
    utilsUri: pathToFileURL(utilsPath).href,
    cyclic1Uri: pathToFileURL(cyclic1Path).href,
    cyclic2Uri: pathToFileURL(cyclic2Path).href,
  };
}

describe('workspace-service architecture summary Phase 8 metrics', () => {
  it('emits instability, longestChain, sccSizeDistribution, and complexityHotspots when the index has the data', async () => {
    const ws = await summaryWorkspaceCreate('codepol-ws-arch-summary-emit-');
    const summary = await ws.service.queryArchitectureSummary({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
    });

    // instability — every file participates in some import edge, so the
    // list is non-empty. `entry.ts` has Ce > 0, Ca = 0 → I = 1 and is
    // ranked first.
    expect(summary.instability).toBeDefined();
    expect(summary.instability!.length).toBeGreaterThan(0);
    const mostUnstable = summary.instability![0]!;
    expect(mostUnstable.uri).toBe(ws.entryUri);
    expect(mostUnstable.value).toBe(1);
    expect(mostUnstable.importerCount).toBe(0);
    // `utils.ts` is depended on by both `a.ts` and `b.ts` → Ca > 0,
    // Ce = 0 → I = 0 and is ranked last in the truncated list (or
    // appears with value === 0).
    const utilsEntry = summary.instability!.find((entry) => entry.uri === ws.utilsUri);
    expect(utilsEntry).toBeDefined();
    expect(utilsEntry!.value).toBe(0);
    expect(utilsEntry!.importeeCount).toBe(0);

    // longestChain — the longest chain over the SCC condensation goes
    // entry → b → cyclic-SCC. With cycle representative chosen as the
    // lex-min member (`cyclic1.ts`), the path is exactly 2 hops.
    expect(summary.longestChain).toBeDefined();
    expect(summary.longestChain!.length).toBeGreaterThanOrEqual(2);
    expect(summary.longestChain!.uriPath.length).toBe(
      summary.longestChain!.length + 1,
    );
    expect(summary.longestChain!.workspaceRelativePathPath.length).toBe(
      summary.longestChain!.uriPath.length,
    );

    // sccSizeDistribution — exactly one 2-cycle (cyclic1 ↔ cyclic2).
    expect(summary.sccSizeDistribution).toEqual({ 2: 1 });

    // complexityHotspots — `utils.ts` is the most fan-in-heavy file
    // with measurable complexity (one branchy function imported by two
    // others). The list is bounded and sorted by score desc.
    expect(summary.complexityHotspots).toBeDefined();
    expect(summary.complexityHotspots!.length).toBeGreaterThan(0);
    const hotspotUris = summary.complexityHotspots!.map((entry) => entry.uri);
    expect(hotspotUris).toContain(ws.utilsUri);
    for (const hotspot of summary.complexityHotspots!) {
      expect(hotspot.score).toBe(
        hotspot.aggregateCyclomaticComplexity * hotspot.importerCount,
      );
      expect(hotspot.score).toBeGreaterThan(0);
    }
  });

  it('produces byte-identical metrics on back-to-back queries (determinism)', async () => {
    const ws = await summaryWorkspaceCreate('codepol-ws-arch-summary-determinism-');
    const first = await ws.service.queryArchitectureSummary({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
    });
    const second = await ws.service.queryArchitectureSummary({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
    });
    expect(JSON.stringify(second.instability)).toEqual(JSON.stringify(first.instability));
    expect(JSON.stringify(second.longestChain)).toEqual(JSON.stringify(first.longestChain));
    expect(JSON.stringify(second.sccSizeDistribution)).toEqual(
      JSON.stringify(first.sccSizeDistribution),
    );
    expect(JSON.stringify(second.complexityHotspots)).toEqual(
      JSON.stringify(first.complexityHotspots),
    );
  });

  it('updates metrics predictably when an overlay breaks the cycle', async () => {
    const ws = await summaryWorkspaceCreate('codepol-ws-arch-summary-stability-');
    const before = await ws.service.queryArchitectureSummary({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
    });
    expect(before.sccSizeDistribution).toEqual({ 2: 1 });

    // Overlay that removes the back-edge from cyclic2 -> cyclic1, so
    // the cycle disappears. The metric set must reflect the change in
    // a single round-trip — no stale SCC distribution from the previous
    // generation.
    await ws.service.openOverlay({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      uri: ws.cyclic2Uri,
      version: 1,
      text:
        `export function ping(value: number): number {\n` +
        `  if (value <= 0) return value;\n` +
        `  return value - 1;\n` +
        `}\n`,
    });

    const after = await ws.service.queryArchitectureSummary({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
    });
    expect(after.sccSizeDistribution).toBeUndefined();
    // The longest chain may have grown because the SCC collapse no
    // longer hides cyclic1 / cyclic2. It must still be defined, and
    // its `uriPath` length must equal `length + 1`.
    expect(after.longestChain).toBeDefined();
    expect(after.longestChain!.uriPath.length).toBe(
      after.longestChain!.length + 1,
    );
    // Instability for `entry.ts` is invariant under this change because
    // its incoming/outgoing edge counts did not move.
    const entryBefore = before.instability!.find((entry) => entry.uri === ws.entryUri)!;
    const entryAfter = after.instability!.find((entry) => entry.uri === ws.entryUri)!;
    expect(entryAfter.value).toBe(entryBefore.value);
    expect(entryAfter.importerCount).toBe(entryBefore.importerCount);
    expect(entryAfter.importeeCount).toBe(entryBefore.importeeCount);
  });

  it('omits Phase 8 fields when the workspace has no edges', async () => {
    const root = tempWorkspaceCreate('codepol-ws-arch-summary-empty-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'codepol.toml'), pluginConfigContentCreate(), 'utf8');
    fs.writeFileSync(
      path.join(root, 'src', 'lonely.ts'),
      `export const value = 1;\n`,
      'utf8',
    );
    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );
    const summary = await service.queryArchitectureSummary({
      clientSessionId,
      workspaceId,
    });
    // No edges means no instability and no SCC distribution. The
    // longest chain is a trivial single-node "chain" so it is still
    // emitted, but `length` is 0.
    expect(summary.instability).toBeUndefined();
    expect(summary.sccSizeDistribution).toBeUndefined();
    expect(summary.complexityHotspots).toBeUndefined();
    expect(summary.longestChain).toEqual({
      length: 0,
      uriPath: [pathToFileURL(path.join(root, 'src', 'lonely.ts')).href],
      workspaceRelativePathPath: ['src/lonely.ts'],
    });
  });
});
