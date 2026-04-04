import { describe, it, expect, beforeAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type PolicyRule,
  type PolicyCheckContext,
  type ProjectIndex,
} from '@codepol/core';
import {
  enforceCasingCheck,
  type EnforceCasingSymbolsArgs,
} from './enforceCasingCheck';
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

  function symbolViolations(
    fileName: string,
    source: string,
    symbols: EnforceCasingSymbolsArgs,
  ) {
    const filePath = path.join(testDir, fileName);
    fs.writeFileSync(filePath, source);
    const { index } = projectIndexBuildSync({
      files: [filePath],
      dir: testDir,
    });
    const { rule, context } = contextNew(filePath, source, index, {
      symbols,
    });
    return enforceCasingCheck(rule, context);
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
    const badSymbolKindCases: Array<{
      label: string;
      fileName: string;
      source: string;
      symbols: EnforceCasingSymbolsArgs;
      expectedName: string;
      expectedKind: keyof EnforceCasingSymbolsArgs;
    }> = [
      {
        label: 'class',
        fileName: 'sym-kind-class-bad.ts',
        source: 'export class bad_class {}\n',
        symbols: { class: ['PascalCase'] },
        expectedName: 'bad_class',
        expectedKind: 'class',
      },
      {
        label: 'interface',
        fileName: 'sym-kind-interface-bad.ts',
        source: 'export interface bad_interface {}\n',
        symbols: { interface: ['PascalCase'] },
        expectedName: 'bad_interface',
        expectedKind: 'interface',
      },
      {
        label: 'type',
        fileName: 'sym-kind-type-bad.ts',
        source: 'export type bad_type = string;\n',
        symbols: { type: ['PascalCase'] },
        expectedName: 'bad_type',
        expectedKind: 'type',
      },
      {
        label: 'function',
        fileName: 'sym-kind-function-bad.ts',
        source: 'export function BadFunction() { return 1; }\n',
        symbols: { function: ['camelCase'] },
        expectedName: 'BadFunction',
        expectedKind: 'function',
      },
      {
        label: 'method',
        fileName: 'sym-kind-method-bad.ts',
        source: 'export class MethodHost { BadMethod() { return 1; } }\n',
        symbols: { method: ['camelCase'] },
        expectedName: 'BadMethod',
        expectedKind: 'method',
      },
      {
        label: 'interface method signature',
        fileName: 'sym-kind-interface-method-bad.ts',
        source: 'export interface MethodHost { BadMethod(): void; }\n',
        symbols: { method: ['camelCase'] },
        expectedName: 'BadMethod',
        expectedKind: 'method',
      },
      {
        label: 'variable',
        fileName: 'sym-kind-variable-bad.ts',
        source: 'let BadVariable = 1;\n',
        symbols: { variable: ['camelCase'] },
        expectedName: 'BadVariable',
        expectedKind: 'variable',
      },
      {
        label: 'const',
        fileName: 'sym-kind-const-bad.ts',
        source: 'const badConst = 1;\n',
        symbols: { const: ['SCREAMING_SNAKE_CASE'] },
        expectedName: 'badConst',
        expectedKind: 'const',
      },
      {
        label: 'field',
        fileName: 'sym-kind-field-bad.ts',
        source: "export class FieldHost { BadField: string = 'x'; }\n",
        symbols: { field: ['camelCase'] },
        expectedName: 'BadField',
        expectedKind: 'field',
      },
      {
        label: 'type literal field signature',
        fileName: 'sym-kind-type-field-bad.ts',
        source: 'export type FieldHost = { BadField: string };\n',
        symbols: { field: ['camelCase'] },
        expectedName: 'BadField',
        expectedKind: 'field',
      },
      {
        label: 'parameter',
        fileName: 'sym-kind-parameter-bad.ts',
        source: 'export function parameterHost(BadParam: string) { return BadParam; }\n',
        symbols: { parameter: ['camelCase'] },
        expectedName: 'BadParam',
        expectedKind: 'parameter',
      },
      {
        label: 'enum',
        fileName: 'sym-kind-enum-bad.ts',
        source: "export enum bad_enum { GoodMember = 'x' }\n",
        symbols: { enum: ['PascalCase'] },
        expectedName: 'bad_enum',
        expectedKind: 'enum',
      },
      {
        label: 'enumMember',
        fileName: 'sym-kind-enum-member-bad.ts',
        source: "export enum GoodEnum { bad_member = 'x' }\n",
        symbols: { enumMember: ['PascalCase'] },
        expectedName: 'bad_member',
        expectedKind: 'enumMember',
      },
    ];

    const goodSymbolKindCases: Array<{
      label: string;
      fileName: string;
      source: string;
      symbols: EnforceCasingSymbolsArgs;
    }> = [
      {
        label: 'class',
        fileName: 'sym-kind-class-ok.ts',
        source: 'export class GoodClass {}\n',
        symbols: { class: ['PascalCase'] },
      },
      {
        label: 'interface',
        fileName: 'sym-kind-interface-ok.ts',
        source: 'export interface GoodInterface {}\n',
        symbols: { interface: ['PascalCase'] },
      },
      {
        label: 'type',
        fileName: 'sym-kind-type-ok.ts',
        source: 'export type GoodType = string;\n',
        symbols: { type: ['PascalCase'] },
      },
      {
        label: 'function',
        fileName: 'sym-kind-function-ok.ts',
        source: 'export function goodFunction() { return 1; }\n',
        symbols: { function: ['camelCase'] },
      },
      {
        label: 'method',
        fileName: 'sym-kind-method-ok.ts',
        source: 'export class MethodHost { goodMethod() { return 1; } }\n',
        symbols: { method: ['camelCase'] },
      },
      {
        label: 'interface method signature',
        fileName: 'sym-kind-interface-method-ok.ts',
        source: 'export interface MethodHost { goodMethod(): void; }\n',
        symbols: { method: ['camelCase'] },
      },
      {
        label: 'variable',
        fileName: 'sym-kind-variable-ok.ts',
        source: 'let goodVariable = 1;\n',
        symbols: { variable: ['camelCase'] },
      },
      {
        label: 'const',
        fileName: 'sym-kind-const-ok.ts',
        source: 'const GOOD_CONST = 1;\n',
        symbols: { const: ['SCREAMING_SNAKE_CASE'] },
      },
      {
        label: 'field',
        fileName: 'sym-kind-field-ok.ts',
        source: "export class FieldHost { goodField: string = 'x'; }\n",
        symbols: { field: ['camelCase'] },
      },
      {
        label: 'type literal field signature',
        fileName: 'sym-kind-type-field-ok.ts',
        source: 'export type FieldHost = { goodField: string };\n',
        symbols: { field: ['camelCase'] },
      },
      {
        label: 'parameter',
        fileName: 'sym-kind-parameter-ok.ts',
        source: 'export function parameterHost(goodParam: string) { return goodParam; }\n',
        symbols: { parameter: ['camelCase'] },
      },
      {
        label: 'enum',
        fileName: 'sym-kind-enum-ok.ts',
        source: "export enum GoodEnum { GoodMember = 'x' }\n",
        symbols: { enum: ['PascalCase'] },
      },
      {
        label: 'enumMember',
        fileName: 'sym-kind-enum-member-ok.ts',
        source: "export enum GoodEnumMemberHost { GoodMember = 'x' }\n",
        symbols: { enumMember: ['PascalCase'] },
      },
    ];

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

    it('flags parameter not matching camelCase or snake_case', () => {
      const filePath = path.join(testDir, 'sym-param-bad.ts');
      const source =
        'export function f(BAD_NAME: string): void {\n  void BAD_NAME;\n}\n';
      fs.writeFileSync(filePath, source);
      const { index } = projectIndexBuildSync({
        files: [filePath],
        dir: testDir,
      });
      const { rule, context } = contextNew(filePath, source, index, {
        symbols: { parameter: ['camelCase', 'snake_case'] },
      });
      const v = enforceCasingCheck(rule, context);
      expect(v.some((x) => x.message.includes('BAD_NAME'))).toBe(true);
      expect(v.some((x) => x.message.includes('parameter'))).toBe(true);
    });

    it('allows snake_case parameter when configured', () => {
      const filePath = path.join(testDir, 'sym-param-ok.ts');
      const source =
        'export function g(good_name: string): void {\n  void good_name;\n}\n';
      fs.writeFileSync(filePath, source);
      const { index } = projectIndexBuildSync({
        files: [filePath],
        dir: testDir,
      });
      const { rule, context } = contextNew(filePath, source, index, {
        symbols: { parameter: ['camelCase', 'snake_case'] },
      });
      expect(enforceCasingCheck(rule, context)).toHaveLength(0);
    });

    it.each(badSymbolKindCases)(
      'flags non-compliant $label names for enforce-casing',
      ({ fileName, source, symbols, expectedName, expectedKind }) => {
        const violations = symbolViolations(fileName, source, symbols);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain(expectedName);
        expect(violations[0].message).toContain(expectedKind);
      },
    );

    it.each(goodSymbolKindCases)('accepts compliant $label names for enforce-casing', ({ fileName, source, symbols }) => {
      const violations = symbolViolations(fileName, source, symbols);

      expect(violations).toHaveLength(0);
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

    it('emits cross-file workspace edits for matching import names and references', () => {
      const depPath = path.join(testDir, 'rename-dep.ts');
      fs.writeFileSync(
        depPath,
        'export function BAD_NAME() { return 1; }\n',
      );
      const consumerPath = path.join(testDir, 'rename-consumer.ts');
      const consumerSource = [
        "import { BAD_NAME } from './rename-dep';",
        'const value = BAD_NAME();',
        '',
      ].join('\n');
      fs.writeFileSync(consumerPath, consumerSource);

      const { index } = projectIndexBuildSync({
        files: [depPath, consumerPath],
        dir: testDir,
      });
      const { rule, context } = contextNew(depPath, fs.readFileSync(depPath, 'utf8'), index, {
        symbols: { function: ['camelCase'] },
      });

      const v = enforceCasingCheck(rule, context);
      expect(v).toHaveLength(1);
      expect(v[0].fix?.text).toBe('badName');
      expect(v[0].fix?.edits).toBeDefined();

      const edits = v[0].fix!.edits!;
      const depEdits = edits.filter((edit) => edit.filePath === depPath);
      const consumerEdits = edits.filter((edit) => edit.filePath === consumerPath);

      expect(depEdits).toHaveLength(1);
      expect(consumerEdits).toHaveLength(2);
      expect(consumerEdits.every((edit) => edit.text === 'badName')).toBe(true);
    });

    it('renames aliased import specifiers without renaming alias references', () => {
      const depPath = path.join(testDir, 'rename-alias-dep.ts');
      fs.writeFileSync(
        depPath,
        'export function BAD_NAME() { return 1; }\n',
      );
      const consumerPath = path.join(testDir, 'rename-alias-consumer.ts');
      const consumerSource = [
        "import { BAD_NAME as goodAlias } from './rename-alias-dep';",
        'const value = goodAlias();',
        '',
      ].join('\n');
      fs.writeFileSync(consumerPath, consumerSource);

      const { index } = projectIndexBuildSync({
        files: [depPath, consumerPath],
        dir: testDir,
      });
      const { rule, context } = contextNew(depPath, fs.readFileSync(depPath, 'utf8'), index, {
        symbols: { function: ['camelCase'] },
      });

      const v = enforceCasingCheck(rule, context);
      expect(v).toHaveLength(1);
      const consumerEdits = v[0].fix!.edits!.filter(
        (edit) => edit.filePath === consumerPath,
      );

      expect(consumerEdits).toHaveLength(1);
      expect(consumerEdits[0]?.text).toBe('badName');
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
