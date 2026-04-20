/**
 * Phase 5 follow-up tests for `symbolImportersCompute`.
 *
 * Covered behavior:
 *
 * - Returns the canonical declaration id and the distinct importer file
 *   set for a given symbol.
 * - Normalizes the input through `symbolCanonicalIdGet` so callers that
 *   pass a local re-export proxy get the same result as callers that
 *   pass the canonical declaration id.
 * - Deduplicates per file (a file with two `ImportBinding`s for the
 *   same symbol shows up once).
 * - Collapses single-hop and multi-hop re-export chains, returning the
 *   leaf importer files only.
 * - Returns an empty file list (and the canonical id) when no file
 *   imports the symbol.
 *
 * The tests build a real `ProjectIndex` via `projectIndexBuild` so the
 * cross-file resolution pass actually runs. A small in-memory unit
 * suite for the canonical-id helper itself lives in
 * `tests/index.symbol-canonical-id.spec.ts`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuild,
  symbolImportersCompute,
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

describe('symbolImportersCompute', () => {
  it('returns the canonical id and the distinct files that import a directly-exported symbol', async () => {
    const dir = tempProjectCreate('codepol-importers-direct-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'lib.ts': 'export function helper() { return 1; }\n',
        'consumerA.ts':
          "import { helper } from './lib';\nexport function useA() { helper(); }\n",
        'consumerB.ts':
          "import { helper } from './lib';\nexport function useB() { helper(); }\n",
        'consumerDup.ts':
          "import { helper } from './lib';\nimport { helper as alias } from './lib';\nexport function useDup() { alias(); helper(); }\n",
        'unrelated.ts': 'export const value = 42;\n',
      },
    });

    const helper = symbolFindByName(index, path.join(dir, 'lib.ts'), 'helper');
    const result = symbolImportersCompute(index, { symbolId: helper.id });

    expect(result.symbolId).toBe(helper.id);
    expect(result.importerFilePaths).toEqual(
      [
        path.join(dir, 'consumerA.ts'),
        path.join(dir, 'consumerB.ts'),
        path.join(dir, 'consumerDup.ts'),
      ].sort(),
    );
  });

  it('returns an empty file list (and the canonical id) for an unimported symbol', async () => {
    const dir = tempProjectCreate('codepol-importers-empty-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'lib.ts': 'export function unused() { return 0; }\n',
      },
    });

    const unused = symbolFindByName(index, path.join(dir, 'lib.ts'), 'unused');
    const result = symbolImportersCompute(index, { symbolId: unused.id });

    expect(result.symbolId).toBe(unused.id);
    expect(result.importerFilePaths).toEqual([]);
  });

  it('collapses re-export chains so the leaf importer file appears once against the original declaration', async () => {
    const dir = tempProjectCreate('codepol-importers-reexport-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': 'export function helper() { return 1; }\n',
        'b.ts': "export { helper } from './a';\n",
        'c.ts': "export { helper } from './b';\n",
        'd.ts':
          "import { helper } from './c';\nexport function useD() { helper(); }\n",
      },
    });

    const helperOriginal = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    const result = symbolImportersCompute(index, { symbolId: helperOriginal.id });

    expect(result.symbolId).toBe(helperOriginal.id);
    expect(result.importerFilePaths).toEqual([path.join(dir, 'd.ts')]);
  });

  it('returns the same answer when given a local re-export proxy id (input normalization)', async () => {
    const dir = tempProjectCreate('codepol-importers-proxy-');
    const index = await projectIndexBuildFromFiles({
      dir,
      files: {
        'a.ts': 'export function helper() { return 1; }\n',
        'b.ts': "export { helper } from './a';\n",
        'c.ts':
          "import { helper } from './b';\nexport function useC() { helper(); }\n",
      },
    });

    const helperOriginal = symbolFindByName(index, path.join(dir, 'a.ts'), 'helper');
    // The local import-binding symbol in `c.ts` is the proxy: it's
    // distinct from the canonical declaration in `a.ts` but
    // `symbolCanonicalIdGet` collapses it onto the original.
    const helperProxy = symbolFindByName(index, path.join(dir, 'c.ts'), 'helper');
    expect(helperProxy.id).not.toBe(helperOriginal.id);

    const fromOriginal = symbolImportersCompute(index, {
      symbolId: helperOriginal.id,
    });
    const fromProxy = symbolImportersCompute(index, { symbolId: helperProxy.id });

    expect(fromProxy.symbolId).toBe(fromOriginal.symbolId);
    expect(fromProxy.importerFilePaths).toEqual(fromOriginal.importerFilePaths);
    expect(fromProxy.importerFilePaths).toEqual([path.join(dir, 'c.ts')]);
  });
});
