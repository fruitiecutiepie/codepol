import { describe, it, expect } from 'vitest';
import type { PolicyRule, PolicyCheckContext } from '@codepol/core';
import ts from 'typescript';
import { mixedExportsAnalyze, noMixedExportsCheck } from './noMixedExportsCheck';

type NoMixedExportsArgs = {
  preferredStyle?: 'default' | 'named';
};

function sourceFileFrom(source: string, filePath = 'test.ts'): ts.SourceFile {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
}

describe('mixedExportsAnalyze', () => {
  it('detects named exports only', () => {
    const sf = sourceFileFrom('export const x = 1;\n');
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: false,
      hasNamedExport: true,
    });
  });

  it('detects default export only', () => {
    const sf = sourceFileFrom('export default 42;\n');
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: true,
      hasNamedExport: false,
    });
  });

  it('detects default export function with name', () => {
    const sf = sourceFileFrom('export default function foo() {}\n');
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: true,
      hasNamedExport: false,
    });
  });

  it('detects anonymous default export function', () => {
    const sf = sourceFileFrom('export default function() {}\n');
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: true,
      hasNamedExport: false,
    });
  });

  it('detects default plus named export const', () => {
    const sf = sourceFileFrom(
      'export default 1;\nexport const x = 2;\n',
    );
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: true,
      hasNamedExport: true,
    });
  });

  it('detects default plus export list', () => {
    const sf = sourceFileFrom(
      'const a = 1;\nexport default a;\nexport { a };\n',
    );
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: true,
      hasNamedExport: true,
    });
  });

  it('detects default plus re-export', () => {
    const sf = sourceFileFrom(
      "export default 1;\nexport { foo } from './other';\n",
    );
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: true,
      hasNamedExport: true,
    });
  });

  it('detects default plus star re-export', () => {
    const sf = sourceFileFrom(
      "export default 1;\nexport * from './other';\n",
    );
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: true,
      hasNamedExport: true,
    });
  });

  it('does not treat empty export list as named export', () => {
    const sf = sourceFileFrom('export {};\n');
    expect(mixedExportsAnalyze(sf)).toEqual({
      hasDefaultExport: false,
      hasNamedExport: false,
    });
  });
});

describe('noMixedExportsCheck', () => {
  function contextNew(
    filePath: string,
    source: string,
    ruleArgs: NoMixedExportsArgs = {},
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
        dir: '/',
        target,
        projectIndex: undefined,
        ruleArgs,
      },
    };
  }

  it('returns empty when only named exports', () => {
    const { rule, context } = contextNew('/x.ts', 'export const x = 1;\n');
    expect(noMixedExportsCheck(rule, context)).toHaveLength(0);
  });

  it('returns empty when only default export', () => {
    const { rule, context } = contextNew('/x.ts', 'export default 1;\n');
    expect(noMixedExportsCheck(rule, context)).toHaveLength(0);
  });

  it('returns one violation when mixed, primary on first statement that completes the mix', () => {
    const { rule, context } = contextNew(
      '/x.ts',
      'export default 1;\nexport const x = 2;\n',
    );
    const v = noMixedExportsCheck(rule, context);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
    expect(v[0].column).toBe(1);
    expect(v[0].endLine).toBe(2);
    expect(v[0].endColumn).toBeGreaterThan(1);
    expect(v[0].message).toContain('Do not mix');
    expect(v[0].relatedLocations).toBeUndefined();
  });

  it('includes relatedLocations for later export statements after primary', () => {
    const { rule, context } = contextNew(
      '/x.ts',
      'export default 1;\nexport const x = 2;\nexport const y = 3;\n',
    );
    const v = noMixedExportsCheck(rule, context);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
    expect(v[0].relatedLocations).toHaveLength(1);
    expect(v[0].relatedLocations![0].line).toBe(3);
    expect(v[0].relatedLocations![0].message).toBe('Additional export in mixed module');
  });

  it('anchors the violation on the non-preferred default export when preferredStyle is named', () => {
    const { rule, context } = contextNew(
      '/x.ts',
      'export default 1;\nexport const x = 2;\n',
      { preferredStyle: 'named' },
    );
    const v = noMixedExportsCheck(rule, context);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
    expect(v[0].message).toContain('prefer named exports');
    expect(v[0].relatedLocations).toHaveLength(1);
    expect(v[0].relatedLocations![0].line).toBe(2);
  });

  it('anchors the violation on the first non-preferred named export when preferredStyle is default', () => {
    const { rule, context } = contextNew(
      '/x.ts',
      'export const x = 1;\nexport const y = 2;\nexport default 3;\n',
      { preferredStyle: 'default' },
    );
    const v = noMixedExportsCheck(rule, context);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
    expect(v[0].message).toContain('prefer default exports');
    expect(v[0].relatedLocations).toHaveLength(2);
    expect(v[0].relatedLocations![0].line).toBe(2);
    expect(v[0].relatedLocations![1].line).toBe(3);
  });
});
