import { describe, it, expect, beforeAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type PolicyRule,
  type PolicyCheckContext,
  type ProjectIndex,
} from '@codepol/core';
import { enforceCasingCheck } from './enforceCasingCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('enforceCasingCheck', () => {
  let testDir: string;

  function contextNew(
    filePath: string,
    source: string,
    index: ProjectIndex | undefined,
    ruleArgs: Record<string, unknown>,
    cwd?: string,
  ): { rule: PolicyRule; context: PolicyCheckContext } {
    const rule: PolicyRule = {
      id: 'casing-test',
      ruleId: 'enforce-casing',
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
        dir: cwd ?? testDir,
        target,
        projectIndex: index,
        ruleArgs,
      },
    };
  }

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'python', fileExtensions: ['.py'] });
    await parserInit();
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codepol-enforce-casing-'),
    );
  });

  describe('paths only', () => {
    it('returns empty when no path rules configured', () => {
      const { rule, context } = contextNew(
        path.join(testDir, 'src', 'app.ts'),
        'export const x = 1;',
        undefined,
        { symbols: { variable: ['camelCase'] } },
      );
      expect(enforceCasingCheck(rule, context)).toHaveLength(0);
    });

    it('flags kebab-case mismatch for file name', () => {
      const filePath = path.join(testDir, 'BadName.ts');
      const { rule, context } = contextNew(
        filePath,
        '',
        undefined,
        { paths: { file: ['kebab-case'] } },
      );
      const v = enforceCasingCheck(rule, context);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('File');
      expect(v[0].message).toContain('BadName');
      expect(v[0].line).toBe(1);
    });

    it('allows kebab-case file name', () => {
      const filePath = path.join(testDir, 'good-name.ts');
      const { rule, context } = contextNew(
        filePath,
        '',
        undefined,
        { paths: { file: ['kebab-case'] } },
      );
      expect(enforceCasingCheck(rule, context)).toHaveLength(0);
    });

    it('flags directory segment', () => {
      const filePath = path.join(testDir, 'OldStuff', 'file.ts');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const { rule, context } = contextNew(
        filePath,
        'export const x = 1;',
        undefined,
        { paths: { directory: ['kebab-case'], file: ['kebab-case'] } },
      );
      const v = enforceCasingCheck(rule, context);
      expect(v.some((x) => x.message.includes('OldStuff'))).toBe(true);
    });

    it('respects checkFiles false', () => {
      const filePath = path.join(testDir, 'BadFile.ts');
      const { rule, context } = contextNew(
        filePath,
        '',
        undefined,
        {
          paths: {
            file: ['kebab-case'],
            checkFiles: false,
            checkDirectories: true,
          },
        },
      );
      expect(enforceCasingCheck(rule, context)).toHaveLength(0);
    });
  });

  describe('symbols with index', () => {
    it('flags class not PascalCase', () => {
      const filePath = path.join(testDir, 'sym-class.ts');
      const source = 'export class bad_class {}\n';
      fs.writeFileSync(filePath, source);
      const { index } = projectIndexBuildSync({
        files: [filePath],
        dir: testDir,
      });
      const { rule, context } = contextNew(filePath, source, index, {
        symbols: { class: ['PascalCase'] },
      });
      const v = enforceCasingCheck(rule, context);
      expect(v.length).toBeGreaterThanOrEqual(1);
      expect(v[0].message).toContain('bad_class');
      expect(v[0].message).toContain('class');
      expect(v[0].fix).toBeDefined();
      expect(v[0].fix!.text).toBe('BadClass');
      expect(v[0].suggestions).toBeUndefined();
    });

    it('emits suggestions when multiple allowed styles and multiple renames', () => {
      const filePath = path.join(testDir, 'sym-fn-suggest.ts');
      const source = 'export function bad_NAME() { return 1; }\n';
      fs.writeFileSync(filePath, source);
      const { index } = projectIndexBuildSync({
        files: [filePath],
        dir: testDir,
      });
      const { rule, context } = contextNew(filePath, source, index, {
        symbols: { function: ['camelCase', 'SCREAMING_SNAKE_CASE'] },
      });
      const v = enforceCasingCheck(rule, context);
      expect(v).toHaveLength(1);
      expect(v[0].fix).toBeUndefined();
      expect(v[0].suggestions?.length).toBe(2);
      const texts = v[0].suggestions!.map((s) => s.fix.text).sort();
      expect(texts).toEqual(['BAD_NAME', 'badName']);
    });

    it('allows PascalCase class', () => {
      const filePath = path.join(testDir, 'sym-class-ok.ts');
      const source = 'export class GoodClass {}\n';
      fs.writeFileSync(filePath, source);
      const { index } = projectIndexBuildSync({
        files: [filePath],
        dir: testDir,
      });
      const { rule, context } = contextNew(filePath, source, index, {
        symbols: { class: ['PascalCase'] },
      });
      expect(enforceCasingCheck(rule, context)).toHaveLength(0);
    });

    it('allows const as SCREAMING_SNAKE_CASE or camelCase', () => {
      const filePath = path.join(testDir, 'sym-const.ts');
      const source = 'export const MAX_RETRY = 3;\n';
      fs.writeFileSync(filePath, source);
      const { index } = projectIndexBuildSync({
        files: [filePath],
        dir: testDir,
      });
      const { rule, context } = contextNew(filePath, source, index, {
        symbols: { const: ['camelCase', 'SCREAMING_SNAKE_CASE'] },
      });
      expect(enforceCasingCheck(rule, context)).toHaveLength(0);
    });

    it('import type bindings use symbols.type, not symbols.variable', () => {
      const filePath = path.join(testDir, 'import-type-casing.ts');
      const source =
        "import type {\n  TreeCheckLintAdapter,\n} from '@codepol/core';\n";
      fs.writeFileSync(filePath, source);
      const { index } = projectIndexBuildSync({
        files: [filePath],
        dir: testDir,
      });
      const { rule, context } = contextNew(filePath, source, index, {
        symbols: {
          variable: ['snake_case'],
          type: ['PascalCase'],
        },
      });
      expect(enforceCasingCheck(rule, context)).toHaveLength(0);
    });

    it('value imports use resolved export kind (e.g. function), not variable', () => {
      const depPath = path.join(testDir, 'casing-dep.ts');
      fs.writeFileSync(
        depPath,
        'export function bad_import_name() { return 1; }\n',
      );
      const consumerPath = path.join(testDir, 'casing-consumer.ts');
      const consumerSource =
        "import { bad_import_name } from './casing-dep';\n";
      fs.writeFileSync(consumerPath, consumerSource);
      const { index } = projectIndexBuildSync({
        files: [depPath, consumerPath],
        dir: testDir,
      });
      const { rule, context } = contextNew(
        consumerPath,
        consumerSource,
        index,
        {
          symbols: {
            function: ['camelCase'],
            variable: ['snake_case'],
          },
        },
      );
      const v = enforceCasingCheck(rule, context);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('bad_import_name');
      expect(v[0].message).toContain('function');
    });

    it('Python: function snake_case', () => {
      const pyDir = path.join(testDir, 'py-fn');
      fs.mkdirSync(pyDir, { recursive: true });
      const filePath = path.join(pyDir, 'mod.py');
      const source = 'def get_user():\n    pass\n';
      fs.writeFileSync(filePath, source);
      const { index } = projectIndexBuildSync({
        files: [filePath],
        dir: pyDir,
      });
      const rule: PolicyRule = {
        id: 'py-test',
        ruleId: 'enforce-casing',
        targets: ['py'],
      };
      const target = { language: 'python' as const, files: ['**/*.py'] };
      const context: PolicyCheckContext = {
        filePath,
        source,
        policy: {
          plugins: [],
          exclude: [],
          targets: { py: target },
          rules: [rule],
        },
        dir: pyDir,
        target,
        projectIndex: index,
        ruleArgs: { symbols: { function: ['snake_case'] } },
      };
      expect(enforceCasingCheck(rule, context)).toHaveLength(0);
    });
  });

  it('returns empty when projectIndex missing but only symbols configured', () => {
    const { rule, context } = contextNew(
      path.join(testDir, 'no-index.ts'),
      'export class X {}\n',
      undefined,
      { symbols: { class: ['PascalCase'] } },
    );
    expect(enforceCasingCheck(rule, context)).toHaveLength(0);
  });
});
