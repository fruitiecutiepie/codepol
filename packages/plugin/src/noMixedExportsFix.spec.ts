import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type PolicyRule,
  type PolicyCheckContext,
} from '@codepol/core';
import { noMixedExportsCheck } from './noMixedExportsCheck';

describe('noMixedExportsFix', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-no-mixed-exports-fix-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function contextNew(
    filePath: string,
    source: string,
    index: ReturnType<typeof projectIndexBuildSync>['index'],
    ruleArgs: { preferredStyle: 'named' | 'default' },
  ): { rule: PolicyRule; context: PolicyCheckContext } {
    const rule: PolicyRule = {
      id: 'no-mixed-test',
      ruleId: '@codepol/plugin/no-mixed-exports',
      description: 'Test',
      targets: ['ts'],
    };
    const target = {
      language: 'typescript' as const,
      files: ['**/*.ts'],
    };
    const policy = {
      plugins: [],
      exclude: [],
      targets: { ts: target },
      rules: [rule],
    };
    return {
      rule,
      context: {
        filePath,
        source,
        policy,
        dir: testDir,
        target,
        projectIndex: index,
        ruleArgs,
      },
    };
  }

  it('preferredStyle named: produces multi-file fix for default function + importer', () => {
    const aPath = path.join(testDir, 'a.ts');
    const bPath = path.join(testDir, 'b.ts');
    const aSrc =
      'export default function main() {\n  return 1;\n}\nexport const x = 2;\n';
    const bSrc = "import main from './a';\nconsole.log(main());\n";
    fs.writeFileSync(aPath, aSrc, 'utf8');
    fs.writeFileSync(bPath, bSrc, 'utf8');

    const { index } = projectIndexBuildSync({
      files: [aPath, bPath],
      dir: testDir,
    });
    const { rule, context } = contextNew(aPath, aSrc, index, {
      preferredStyle: 'named',
    });
    const v = noMixedExportsCheck(rule, context);
    expect(v).toHaveLength(1);
    expect(v[0].fix).toBeDefined();
    expect(v[0].fix!.edits).toBeDefined();
    const files = new Set(v[0].fix!.edits!.map((e) => e.filePath));
    expect(files.has(aPath)).toBe(true);
    expect(files.has(bPath)).toBe(true);
  });

  it('preferredStyle default: safe single named export + default id ref', () => {
    const aPath = path.join(testDir, 'c.ts');
    const bPath = path.join(testDir, 'd.ts');
    const aSrc =
      'export function main() {\n  return 1;\n}\nexport default main;\n';
    const bSrc = "import { main } from './c';\n";
    fs.writeFileSync(aPath, aSrc, 'utf8');
    fs.writeFileSync(bPath, bSrc, 'utf8');

    const { index } = projectIndexBuildSync({
      files: [aPath, bPath],
      dir: testDir,
    });
    const { rule, context } = contextNew(aPath, aSrc, index, {
      preferredStyle: 'default',
    });
    const v = noMixedExportsCheck(rule, context);
    expect(v).toHaveLength(1);
    expect(v[0].fix).toBeDefined();
    expect(v[0].fix!.edits!.some((e) => e.filePath === aPath)).toBe(true);
    // When the index resolves named imports to this module, rewrite `import { main }` → default import.
    const importerEdits = v[0].fix!.edits!.filter((e) => e.filePath === bPath);
    if (importerEdits.length > 0) {
      expect(importerEdits[0].text).toMatch(/import\s+main\s+from/);
    }
  });

  it('preferredStyle default: no fix when multiple named exports', () => {
    const aPath = path.join(testDir, 'e.ts');
    const aSrc =
      'export const a = 1;\nexport const b = 2;\nexport default a;\n';
    fs.writeFileSync(aPath, aSrc, 'utf8');

    const { index } = projectIndexBuildSync({
      files: [aPath],
      dir: testDir,
    });
    const { rule, context } = contextNew(aPath, aSrc, index, {
      preferredStyle: 'default',
    });
    const v = noMixedExportsCheck(rule, context);
    expect(v).toHaveLength(1);
    expect(v[0].fix).toBeUndefined();
  });
});
