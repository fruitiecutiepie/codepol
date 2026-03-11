import { describe, it, expect } from 'vitest';
import { ruffAdapter } from './ruffAdapter';
import { ruffDiagnosticToViolation } from './ruffRunner';
import { pluginRuleNew, Ok } from '@codepol/core';
import type { RuffDiagnostic } from './ruffTypes';

describe('ruffAdapter', () => {
  it('has platform identifier "ruff"', () => {
    expect(ruffAdapter.platform).toBe('ruff');
  });

  it('adapt() returns a RuffAdaptedRule with correct ruleId', () => {
    const rule = pluginRuleNew({
      id: 'test-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['python'],
          check: () => Ok([]),
        },
      },
    });

    const adapted = ruffAdapter.adapt(rule);

    expect(adapted.ruleId).toBe('test-rule');
    expect(adapted.ruleName).toBe('ruff-check-test-rule');
    expect(typeof adapted.check).toBe('function');
  });

  it('adapt() uses custom ruleName from options', () => {
    const rule = pluginRuleNew({
      id: 'my-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['python'],
          check: () => Ok([]),
        },
      },
    });

    const adapted = ruffAdapter.adapt(rule, { ruleName: 'custom-name' });

    expect(adapted.ruleName).toBe('custom-name');
  });

  it('adapted rule returns empty diagnostics for non-Python files', () => {
    const rule = pluginRuleNew({
      id: 'test-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['python'],
          check: () => Ok([]),
        },
      },
    });

    const adapted = ruffAdapter.adapt(rule);
    const diagnostics = adapted.check('/src/foo.ts', 'const x = 1;');

    expect(diagnostics).toEqual([]);
  });

  it('adapted rule returns empty diagnostics when provider has no python support', () => {
    const rule = pluginRuleNew({
      id: 'ts-only-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['typescript'],
          check: () => Ok([]),
        },
      },
    });

    const adapted = ruffAdapter.adapt(rule);
    const diagnostics = adapted.check('/src/foo.py', 'x = 1');

    expect(diagnostics).toEqual([]);
  });

  it('adapted rule returns empty diagnostics when no treeCheckProvider', () => {
    const rule = pluginRuleNew({
      id: 'no-provider',
      capabilities: {},
    });

    const adapted = ruffAdapter.adapt(rule);
    const diagnostics = adapted.check('/src/foo.py', 'x = 1');

    expect(diagnostics).toEqual([]);
  });

  it('adapted rule converts violations to LintDiagnostic[]', () => {
    const rule = pluginRuleNew({
      id: 'forbidden-words',
      capabilities: {
        treeCheckProvider: {
          languages: ['python'],
          check: (_r, ctx) => Ok([
            {
              ruleId: 'forbidden-words',
              filePath: ctx.filePath,
              message: 'Found forbidden word "foo"',
              line: 3,
              column: 5,
            },
          ]),
        },
      },
    });

    const adapted = ruffAdapter.adapt(rule);
    const diagnostics = adapted.check('/src/app.py', 'foo = 1\nbar = 2\nfoo_func()');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe('Found forbidden word "foo"');
    expect(diagnostics[0].line).toBe(3);
    expect(diagnostics[0].column).toBe(5);
    expect(diagnostics[0].ruleId).toBe('forbidden-words');
    expect(diagnostics[0].severity).toBe('error');
  });

  it('adapted rule uses custom severity from options', () => {
    const rule = pluginRuleNew({
      id: 'my-rule',
      capabilities: {
        treeCheckProvider: {
          languages: ['python'],
          check: (_r, ctx) => Ok([
            {
              ruleId: 'my-rule',
              filePath: ctx.filePath,
              message: 'issue',
              line: 1,
              column: 1,
            },
          ]),
        },
      },
    });

    const adapted = ruffAdapter.adapt(rule, { severity: 'warning' });
    const diagnostics = adapted.check('/src/app.py', 'x = 1');

    expect(diagnostics[0].severity).toBe('warning');
  });

  it('adapted rule passes ruleArgs through to check context', () => {
    let capturedArgs: unknown;
    const rule = pluginRuleNew({
      id: 'args-test',
      capabilities: {
        treeCheckProvider: {
          languages: ['python'],
          check: (_r, ctx) => {
            capturedArgs = ctx.ruleArgs;
            return Ok([]);
          },
        },
      },
    });

    const adapted = ruffAdapter.adapt(rule);
    adapted.check('/src/app.py', 'x = 1', { words: ['todo'] });

    expect(capturedArgs).toEqual({ words: ['todo'] });
  });

  it('adapted rule handles .pyw files', () => {
    const rule = pluginRuleNew({
      id: 'test-pyw',
      capabilities: {
        treeCheckProvider: {
          languages: ['python'],
          check: (_r, ctx) => Ok([
            {
              ruleId: 'test-pyw',
              filePath: ctx.filePath,
              message: 'found',
              line: 1,
              column: 1,
            },
          ]),
        },
      },
    });

    const adapted = ruffAdapter.adapt(rule);
    const diagnostics = adapted.check('/src/gui.pyw', 'import tkinter');

    expect(diagnostics).toHaveLength(1);
  });
});

describe('ruffDiagnosticToViolation', () => {
  it('maps ruff diagnostic fields to PolicyViolation', () => {
    const diag: RuffDiagnostic = {
      cell: null,
      code: 'F401',
      message: '`os` imported but unused',
      filename: '/src/app.py',
      location: { row: 1, column: 1 },
      end_location: { row: 1, column: 10 },
      fix: {
        applicability: 'safe',
        message: 'Remove unused import',
        edits: [{ content: '', location: { row: 1, column: 1 }, end_location: { row: 2, column: 1 } }],
      },
      noqa_row: 1,
      url: 'https://docs.astral.sh/ruff/rules/unused-import',
    };

    const violation = ruffDiagnosticToViolation(diag);

    expect(violation.ruleId).toBe('F401');
    expect(violation.filePath).toBe('/src/app.py');
    expect(violation.message).toBe('`os` imported but unused');
    expect(violation.line).toBe(1);
    expect(violation.column).toBe(1);
  });

  it('uses "ruff" as ruleId when code is null', () => {
    const diag: RuffDiagnostic = {
      cell: null,
      code: null,
      message: 'syntax error',
      filename: '/src/bad.py',
      location: { row: 5, column: 3 },
      end_location: { row: 5, column: 10 },
      fix: null,
      noqa_row: 5,
      url: null,
    };

    const violation = ruffDiagnosticToViolation(diag);

    expect(violation.ruleId).toBe('ruff');
  });
});
