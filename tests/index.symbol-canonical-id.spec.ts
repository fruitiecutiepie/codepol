/**
 * Phase 7 follow-up tests for cross-file call resolution and the
 * `symbolCanonicalIdGet` re-export normalization helper added to
 * `ProjectIndex`.
 *
 * Verifies:
 *
 * - `symbolCanonicalIdGet` is idempotent for declaration symbols.
 * - `symbolCanonicalIdGet` collapses a single-hop import binding to the
 *   canonical declaration in the source module.
 * - `symbolCanonicalIdGet` collapses a multi-hop re-export chain
 *   (`a.ts` → re-exported by `b.ts` → re-exported by `c.ts` → imported
 *   by `d.ts`) onto the original declaration in `a.ts`.
 * - `callersGet` and `calleesGet` find cross-file edges that the
 *   adapter could not resolve file-locally — both for direct imports
 *   and for re-export chains. Both queries return one entry per
 *   logical declaration regardless of how many proxies the call
 *   traversed.
 * - Passing a re-export proxy id into `callersGet` produces the same
 *   answer as passing the canonical id (input normalization).
 * - Symbol-level `symbolCallGraphCompute` (the Phase 7 traversal
 *   helper) sees one node per canonical symbol when adapted onto a
 *   real `ProjectIndex`, confirming the call-graph view that the
 *   workspace service feeds to the panel collapses re-export hops
 *   end-to-end.
 *
 * The tests use `projectIndexBuild` end-to-end so the cross-file
 *   resolution pass (Step 5b in `crossFileResolve`) actually runs. A
 *   small in-memory unit suite for the helpers themselves lives in
 *   `tests/index.symbol-graph-queries.spec.ts`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuild,
  symbolCallGraphCompute,
  type ProjectIndex,
  type SymbolRecord,
} from '@codepol/core';

const tempDirs: string[] = [];

beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  await parserInit();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempProjectCreate(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

async function projectIndexBuildFromFiles(input: {
  dir: string;
  files: Record<string, string>;
}): Promise<ProjectIndex> {
  const absoluteFiles: string[] = [];
  for (const [relativePath, source] of Object.entries(input.files)) {
    const filePath = path.join(input.dir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source, 'utf8');
    absoluteFiles.push(filePath);
  }
  const { index } = await projectIndexBuild({
    files: absoluteFiles,
    dir: input.dir,
  });
  return index;
}

function symbolFindByName(
  index: ProjectIndex,
  filePath: string,
  name: string,
): SymbolRecord {
  const candidate = index
    .symbolsInFileGet(filePath)
    .find((symbol) => symbol.name === name);
  if (!candidate) {
    throw new Error(`No symbol named "${name}" in ${filePath}`);
  }
  return candidate;
}

// ============================================================================
// symbolCanonicalIdGet
// ============================================================================

describe('symbolCanonicalIdGet', () => {
  it('is idempotent for declaration symbols (no import binding)', async () => {
    const dir = tempProjectCreate('canonical-id-idempotent-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': `export function helper(): number { return 1; }\n`,
      },
    });
    const helper = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    expect(index.symbolCanonicalIdGet(helper.id)).toBe(helper.id);
    // Calling twice must hit the cache and return the same value.
    expect(index.symbolCanonicalIdGet(helper.id)).toBe(helper.id);
  });

  it('returns the input unchanged for an unknown id', async () => {
    const dir = tempProjectCreate('canonical-id-unknown-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: { 'a.ts': `export const value = 1;\n` },
    });
    expect(index.symbolCanonicalIdGet('symbol-that-does-not-exist')).toBe(
      'symbol-that-does-not-exist',
    );
  });

  it('collapses a direct import binding onto the canonical declaration', async () => {
    const dir = tempProjectCreate('canonical-id-direct-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': `export function helper(): number { return 1; }\n`,
        'c.ts':
          `import { helper } from './a';\n` +
          `export function caller(): number { return helper(); }\n`,
      },
    });
    const helperA = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    const helperC = symbolFindByName(index, path.join(dir, 'c.ts'), 'helper');
    expect(helperA.id).not.toBe(helperC.id);
    expect(index.symbolCanonicalIdGet(helperC.id)).toBe(helperA.id);
    expect(index.symbolCanonicalIdGet(helperA.id)).toBe(helperA.id);
  });

  it('collapses a multi-hop re-export chain onto the canonical declaration', async () => {
    const dir = tempProjectCreate('canonical-id-chain-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': `export function helper(): number { return 1; }\n`,
        'b.ts': `export { helper } from './a';\n`,
        'c.ts': `export { helper } from './b';\n`,
        'd.ts':
          `import { helper } from './c';\n` +
          `export function caller(): number { return helper(); }\n`,
      },
    });
    const helperA = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    const helperD = symbolFindByName(index, path.join(dir, 'd.ts'), 'helper');
    expect(index.symbolCanonicalIdGet(helperD.id)).toBe(helperA.id);
  });
});

// ============================================================================
// callersGet / calleesGet
// ============================================================================

describe('cross-file callersGet / calleesGet', () => {
  it('finds cross-file callers for a directly imported function', async () => {
    const dir = tempProjectCreate('cross-call-direct-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': `export function helper(): number { return 1; }\n`,
        'c.ts':
          `import { helper } from './a';\n` +
          `export function caller(): number { return helper(); }\n`,
      },
    });
    const helperA = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    const callerC = symbolFindByName(index, path.join(dir, 'c.ts'), 'caller');

    expect(index.callersGet(helperA.id)).toEqual([callerC.id]);
    expect(index.calleesGet(callerC.id)).toEqual([helperA.id]);
  });

  it('collapses a re-export chain so callersGet / calleesGet bucket on the canonical id', async () => {
    const dir = tempProjectCreate('cross-call-chain-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': `export function helper(): number { return 1; }\n`,
        'b.ts': `export { helper } from './a';\n`,
        'c.ts': `export { helper } from './b';\n`,
        'd.ts':
          `import { helper } from './c';\n` +
          `export function caller(): number { return helper(); }\n`,
      },
    });
    const helperA = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    const callerD = symbolFindByName(index, path.join(dir, 'd.ts'), 'caller');

    expect(index.callersGet(helperA.id)).toEqual([callerD.id]);
    expect(index.calleesGet(callerD.id)).toEqual([helperA.id]);
  });

  it('returns the same callers when given a re-export proxy id as the canonical id', async () => {
    const dir = tempProjectCreate('cross-call-proxy-input-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': `export function helper(): number { return 1; }\n`,
        'd.ts':
          `import { helper } from './a';\n` +
          `export function caller(): number { return helper(); }\n`,
      },
    });
    const helperA = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    const helperD = symbolFindByName(index, path.join(dir, 'd.ts'), 'helper');
    const callerD = symbolFindByName(index, path.join(dir, 'd.ts'), 'caller');

    // Both ids must produce the same caller list.
    expect(index.callersGet(helperA.id)).toEqual([callerD.id]);
    expect(index.callersGet(helperD.id)).toEqual([callerD.id]);
  });

  it('keeps file-local resolution preferred when a same-file declaration shadows an import', async () => {
    const dir = tempProjectCreate('cross-call-shadow-');
    // c.ts declares its own `helper` AND imports `helper` (aliased) from
    // a.ts. The local function shadows the import for `helper()` calls;
    // the aliased call goes cross-file. Verify both resolve correctly.
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': `export function helper(): number { return 1; }\n`,
        'c.ts':
          `import { helper as remoteHelper } from './a';\n` +
          `function helper(): number { return 2; }\n` +
          `export function caller(): number { return helper() + remoteHelper(); }\n`,
      },
    });
    const helperA = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    const helperLocalC = index
      .symbolsInFileGet(path.join(dir, 'c.ts'))
      .find((symbol) => symbol.name === 'helper' && symbol.kind === 'function')!;
    expect(helperLocalC).toBeDefined();
    const callerC = symbolFindByName(index, path.join(dir, 'c.ts'), 'caller');

    const calleesOfCaller = new Set(index.calleesGet(callerC.id));
    expect(calleesOfCaller.has(helperA.id)).toBe(true);
    expect(calleesOfCaller.has(helperLocalC.id)).toBe(true);

    // The local helper has no cross-file callers; the canonical
    // declaration in a.ts gets the cross-file caller.
    expect(index.callersGet(helperLocalC.id)).toEqual([callerC.id]);
    expect(index.callersGet(helperA.id)).toEqual([callerC.id]);
  });
});

// ============================================================================
// symbolCallGraphCompute (Phase 7 traversal helper) end-to-end
// ============================================================================

describe('symbolCallGraphCompute over a re-export chain', () => {
  it('produces one node per canonical symbol regardless of re-export hops', async () => {
    const dir = tempProjectCreate('symbol-call-graph-chain-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': `export function helper(): number { return 1; }\n`,
        'b.ts': `export { helper } from './a';\n`,
        'd.ts':
          `import { helper } from './b';\n` +
          `export function caller(): number { return helper(); }\n`,
      },
    });
    const helperA = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    const callerD = symbolFindByName(index, path.join(dir, 'd.ts'), 'caller');

    const result = symbolCallGraphCompute(
      {
        callersGet: (id) => index.callersGet(id),
        calleesGet: (id) => index.calleesGet(id),
      },
      {
        symbolId: helperA.id,
        direction: 'callers',
      },
    );
    expect(result.symbols.sort()).toEqual([helperA.id, callerD.id].sort());
    expect(result.edges).toEqual([{ from: callerD.id, to: helperA.id }]);
  });
});
