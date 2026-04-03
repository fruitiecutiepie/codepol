import { describe, it, expect } from 'vitest';
import { pluginRuleNew, Ok } from '@codepol/core';
import { biomeAdapter } from './biomeAdapter';

describe('biomeAdapter', () => {
  it('has platform identifier "biome"', () => {
    expect(biomeAdapter.platform).toBe('biome');
  });

  it('adapt() returns a BiomeAdaptedRule with correct defaults', () => {
    const rule = pluginRuleNew({
      id: 'test-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['typescript'],
          check: () => Ok([]),
        },
      },
    });

    const adapted = biomeAdapter.adapt(rule);

    expect(adapted.ruleId).toBe('test-rule');
    expect(adapted.ruleName).toBe('biome-check-test-rule');
    expect(typeof adapted.check).toBe('function');
  });

  it('adapt() uses custom ruleName from options', () => {
    const rule = pluginRuleNew({
      id: 'my-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['typescript'],
          check: () => Ok([]),
        },
      },
    });

    const adapted = biomeAdapter.adapt(rule, { ruleName: 'custom-name' });

    expect(adapted.ruleName).toBe('custom-name');
  });

  it('adapts TypeScript violations into diagnostics and forwards ruleArgs', () => {
    let capturedArgs: unknown;
    const rule = pluginRuleNew({
      id: 'no-double-equals',
      capabilities: {
        treeCheckProvider: {
          languages: ['typescript'],
          check: (_rule, context) => {
            capturedArgs = context.ruleArgs;
            return Ok([
              {
                ruleId: 'no-double-equals',
                filePath: context.filePath,
                message: 'Use === instead of ==',
                line: 2,
                column: 7,
              },
            ]);
          },
        },
      },
    });

    const adapted = biomeAdapter.adapt(rule);
    const diagnostics = adapted.check(
      '/src/app.ts',
      'export const value = a == b;\n',
      { enforce: true }
    );

    expect(capturedArgs).toEqual({ enforce: true });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: 'no-double-equals',
      message: 'Use === instead of ==',
      line: 2,
      column: 7,
      severity: 'error',
    });
  });

  it('supports JavaScript files when the provider declares javascript', () => {
    const rule = pluginRuleNew({
      id: 'js-only-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['javascript'],
          check: (_rule, context) => Ok([
            {
              ruleId: 'js-only-rule',
              filePath: context.filePath,
              message: 'issue',
              line: 1,
              column: 1,
            },
          ]),
        },
      },
    });

    const adapted = biomeAdapter.adapt(rule, { severity: 'warning' });
    const diagnostics = adapted.check('/src/app.js', 'const value = 1;\n');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('returns empty diagnostics for unsupported file types and languages', () => {
    const rule = pluginRuleNew({
      id: 'ts-only-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['typescript'],
          check: () => Ok([
            {
              ruleId: 'ts-only-rule',
              filePath: '/src/app.ts',
              message: 'issue',
              line: 1,
              column: 1,
            },
          ]),
        },
      },
    });

    const adapted = biomeAdapter.adapt(rule);

    expect(adapted.check('/src/app.json', '{"ok":true}')).toEqual([]);
    expect(adapted.check('/src/app.jsx', '<App />')).toEqual([]);
  });
});
