import { beforeAll, describe, it, expect } from 'vitest';
import {
  langAdd,
  parserInit,
  type PolicyRule,
  type PolicyCheckContext,
} from '@codepol/core';
import { mixedExportsAnalyze, noMixedExportsCheck } from './noMixedExportsCheck';

type NoMixedExportsArgs = {
  preferredStyle?: 'default' | 'named';
};

beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts', '.tsx', '.js', '.jsx'] });
  await parserInit();
});

describe('mixedExportsAnalyze', () => {
  it('detects named exports only', () => {
    expect(mixedExportsAnalyze('export const x = 1;\n')).toEqual({
      hasDefaultExport: false,
      hasNamedExport: true,
    });
  });

  it('detects default export only', () => {
    expect(mixedExportsAnalyze('export default 42;\n')).toEqual({
      hasDefaultExport: true,
      hasNamedExport: false,
    });
  });

  it('detects default export function with name', () => {
    expect(mixedExportsAnalyze('export default function foo() {}\n')).toEqual({
      hasDefaultExport: true,
      hasNamedExport: false,
    });
  });

  it('detects anonymous default export function', () => {
    expect(mixedExportsAnalyze('export default function() {}\n')).toEqual({
      hasDefaultExport: true,
      hasNamedExport: false,
    });
  });

  it('detects default plus named export const', () => {
    expect(mixedExportsAnalyze(
      'export default 1;\nexport const x = 2;\n',
    )).toEqual({
      hasDefaultExport: true,
      hasNamedExport: true,
    });
  });

  it('detects default plus export list', () => {
    expect(mixedExportsAnalyze(
      'const a = 1;\nexport default a;\nexport { a };\n',
    )).toEqual({
      hasDefaultExport: true,
      hasNamedExport: true,
    });
  });

  it('detects default plus re-export', () => {
    expect(mixedExportsAnalyze(
      "export default 1;\nexport { foo } from './other';\n",
    )).toEqual({
      hasDefaultExport: true,
      hasNamedExport: true,
    });
  });

  it('detects default plus star re-export', () => {
    expect(mixedExportsAnalyze(
      "export default 1;\nexport * from './other';\n",
    )).toEqual({
      hasDefaultExport: true,
      hasNamedExport: true,
    });
  });

  it('does not treat empty export list as named export', () => {
    expect(mixedExportsAnalyze('export {};\n')).toEqual({
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
