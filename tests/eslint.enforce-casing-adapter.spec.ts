import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eslintAdapter } from '../packages/plugin-eslint/src/index';
import {
  pluginRuleNew,
  treeCheckProviderNew,
} from '../packages/core/src/index';

function report_descriptors_get(params: {
  adapted_rule: ReturnType<typeof eslintAdapter.adapt>;
  filename: string;
}): any[] {
  const reports: any[] = [];
  const adapted_rule = params.adapted_rule;
  const listeners = adapted_rule.create({
    filename: params.filename,
    options: [
      {
        ruleTargets: [
          {
            ruleId: 'fake-rule',
            description: 'fake rule',
            target: {
              language: 'typescript',
              files: ['src/**/*.ts'],
            },
          },
        ],
        policyExclude: [],
      },
    ],
    sourceCode: {
      getText: () => 'const source = true;\n',
    },
    report: (descriptor: any) => {
      reports.push(descriptor);
    },
  } as any);
  const program_exit = listeners['Program:exit'];
  expect(program_exit).toBeTypeOf('function');
  if (typeof program_exit !== 'function') {
    throw new Error('Expected Program:exit listener');
  }
  program_exit({ type: 'Program' } as any);
  return reports;
}

describe('eslint enforce-casing tree-check adapter', () => {
  const filename = path.join(process.cwd(), 'src', 'example.ts');

  it('exposes suggestions support on adapted rule meta', () => {
    const adapted_rule = eslintAdapter.adapt(
      pluginRuleNew({
        id: 'fake-rule',
        capabilities: {
          treeCheckProvider: treeCheckProviderNew({
            languages: ['typescript'],
            check: () => [],
          }),
        },
      }),
    );

    expect(adapted_rule.meta?.hasSuggestions).toBe(true);
    expect(adapted_rule.meta?.messages).toHaveProperty('treeCheckSuggestion');
  });

  it('reports a single autofix when a violation has fix data', () => {
    const adapted_rule = eslintAdapter.adapt(
      pluginRuleNew({
        id: 'fake-rule',
        capabilities: {
          treeCheckProvider: treeCheckProviderNew({
            languages: ['typescript'],
            check: () => [
              {
                ruleId: 'fake-rule',
                filePath: filename,
                message: 'rename it',
                line: 1,
                column: 1,
                fix: {
                  byteRange: { start: 0, end: 5 },
                  text: 'fixed',
                },
              },
            ],
          }),
        },
      }),
    );

    const reports = report_descriptors_get({
      adapted_rule,
      filename,
    });

    expect(reports).toHaveLength(1);
    expect(reports[0].fix).toBeTypeOf('function');
    expect(reports[0].suggest).toBeUndefined();
  });

  it('does not emit an autofix when a violation is suggestion-only', () => {
    const adapted_rule = eslintAdapter.adapt(
      pluginRuleNew({
        id: 'fake-rule',
        capabilities: {
          treeCheckProvider: treeCheckProviderNew({
            languages: ['typescript'],
            check: () => [
              {
                ruleId: 'fake-rule',
                filePath: filename,
                message: 'choose a rename',
                line: 1,
                column: 1,
                suggestions: [
                  {
                    message: 'Rename to camelCase: fooBar',
                    fix: {
                      byteRange: { start: 0, end: 7 },
                      text: 'fooBar',
                    },
                  },
                  {
                    message: 'Rename to SCREAMING_SNAKE_CASE: FOO_BAR',
                    fix: {
                      byteRange: { start: 0, end: 7 },
                      text: 'FOO_BAR',
                    },
                  },
                ],
              },
            ],
          }),
        },
      }),
    );

    const reports = report_descriptors_get({
      adapted_rule,
      filename,
    });

    expect(reports).toHaveLength(1);
    expect(reports[0].fix).toBeUndefined();
    expect(reports[0].messageId).toBe('treeCheckViolation');
  });
});
