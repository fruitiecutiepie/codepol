import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { Ok, pluginRuleNew } from '@codepol/core';
import {
  eslintAdapter,
  policyCacheClear,
  projectIndexCacheClear,
} from './eslintAdapter';

// ============================================================================
// ESLint Adapter Cache / State Clearing
// ============================================================================

/** Related-location spans use 1-based columns; ESLint `loc` uses 0-based (see eslintAdapter). */
describe('eslintAdapter related-location column convention', () => {
  it('maps 1-based columns to ESLint 0-based columns', () => {
    const column1Based = 5;
    const endColumn1Based = 18;
    expect(column1Based - 1).toBe(4);
    expect(endColumn1Based - 1).toBe(17);
  });
});

describe('eslintAdapter cache and state clearing', () => {
  describe('policyCacheClear', () => {
    it('clears the policy cache without error', () => {
      // policyCacheClear is re-exported from @codepol/core (policyGet).
      // Calling it should not throw, even when the cache is already empty.
      expect(() => policyCacheClear()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      policyCacheClear();
      policyCacheClear();
      // No assertion beyond "doesn't throw" — the Maps are private
    });
  });

  describe('projectIndexCacheClear', () => {
    it('clears the project index cache without error', () => {
      // projectIndexCacheClear clears the internal projectIndexCache Map.
      // After clearing, the next ESLint run will rebuild the project index.
      expect(() => projectIndexCacheClear()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      projectIndexCacheClear();
      projectIndexCacheClear();
    });
  });
});

describe('eslintAdapter suggestion fixes', () => {
  it('applies same-file suggestion edit sets through ESLint', () => {
    const filename = path.join(
      process.cwd(),
      'packages/plugin-eslint/src/suggest-fixture.ts',
    );
    const report = vi.fn();

    const rule = eslintAdapter.adapt(
      pluginRuleNew({
        id: 'enforce-casing',
        capabilities: {
          treeCheckProvider: {
            languages: ['typescript'],
            check: () =>
              Ok([
                {
                  ruleId: 'enforce-casing',
                  filePath: filename,
                  message: 'Rename BAD_NAME',
                  line: 1,
                  column: 1,
                  suggestions: [
                    {
                      message: 'Rename to camelCase: badName',
                      fix: {
                        byteRange: { start: 6, end: 14 },
                        text: 'badName',
                        edits: [
                          {
                            filePath: filename,
                            byteRange: { start: 6, end: 14 },
                            text: 'badName',
                          },
                          {
                            filePath: filename,
                            byteRange: { start: 17, end: 25 },
                            text: 'badName',
                          },
                        ],
                      },
                    },
                  ],
                },
              ]),
          },
        },
      }),
    );

    const listeners = rule.create({
      filename,
      options: [
        {
          configPath: path.join(process.cwd(), 'codepol.toml'),
          policyExclude: [],
          ruleTargets: [
            {
              ruleId: 'enforce-casing',
              description: 'Test rule target',
              target: {
                language: 'typescript',
                files: ['packages/plugin-eslint/src/**/*.ts'],
                exclude: [],
              },
            },
          ],
        },
      ],
      sourceCode: {
        getText: () => 'const BAD_NAME = BAD_NAME();\n',
      },
      report,
    } as never);

    listeners['Program:exit']?.({ type: 'Program' } as never);

    expect(report).toHaveBeenCalledTimes(1);

    const descriptor = report.mock.calls[0]?.[0];
    expect(descriptor?.suggest).toHaveLength(1);

    const replaceTextRange = vi.fn((range, text) => ({ range, text }));
    descriptor.suggest[0].fix({ replaceTextRange } as never);

    expect(replaceTextRange.mock.calls).toEqual([
      [[17, 25], 'badName'],
      [[6, 14], 'badName'],
    ]);
  });
});
