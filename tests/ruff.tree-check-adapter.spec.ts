import { beforeAll, describe, expect, it } from 'vitest';
import { ruffAdapter, ruffDiagnosticToViolation } from '@codepol/plugin-ruff';
import type { RuffDiagnostic } from '@codepol/plugin-ruff';
import { langAdd, parserInit, pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { forbiddenWordsCheck } from '../packages/plugin/src/forbiddenWordsCheck';

const forbiddenWordsRule = pluginRuleNew({
  id: 'forbidden-words',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx', 'python'],
      check: forbiddenWordsCheck,
    }),
  },
});

beforeAll(async () => {
  langAdd({ langId: 'python', fileExtensions: ['.py'] });
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();
});

describe('ruff tree-check adapter', () => {
  it('adapter has correct platform identifier', () => {
    expect(ruffAdapter.platform).toBe('ruff');
  });

  it('adapts forbidden-words rule for Python files', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule, {
      ruleName: 'forbidden-words',
    });

    expect(adapted).toBeDefined();
    expect(adapted.ruleId).toBe('forbidden-words');
    expect(adapted.ruleName).toBe('forbidden-words');
    expect(typeof adapted.check).toBe('function');
  });

  it('detects forbidden words in Python function names', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule);

    const pythonSource = `
def get_temp_data():
    pass

def process_items():
    pass
`;

    const diagnostics = adapted.check(
      '/src/utils.py',
      pythonSource,
      { words: ['temp'] }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("'get_temp_data'");
    expect(diagnostics[0].message).toContain("'temp'");
    expect(diagnostics[0].ruleId).toBe('forbidden-words');
    expect(diagnostics[0].severity).toBe('error');
  });

  it('detects forbidden words in Python class names', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule);

    const pythonSource = `
class TempManager:
    pass

class UserService:
    pass
`;

    const diagnostics = adapted.check(
      '/src/models.py',
      pythonSource,
      { words: ['temp'] }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("'TempManager'");
  });

  it('detects forbidden words in Python variable assignments', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule);

    const pythonSource = `
temp_value = 42
normal_var = "hello"
`;

    const diagnostics = adapted.check(
      '/src/config.py',
      pythonSource,
      { words: ['temp'] }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("'temp_value'");
  });

  it('returns no diagnostics when no forbidden words match', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule);

    const pythonSource = `
def calculate_total():
    pass

class OrderService:
    pass
`;

    const diagnostics = adapted.check(
      '/src/service.py',
      pythonSource,
      { words: ['temp', 'hack'] }
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('returns no diagnostics for non-Python files', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule);

    const tsSource = 'function getTempData() { return null; }';

    const diagnostics = adapted.check(
      '/src/service.ts',
      tsSource,
      { words: ['temp'] }
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('returns no diagnostics when words list is empty', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule);

    const diagnostics = adapted.check(
      '/src/app.py',
      'temp_var = 1',
      { words: [] }
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('uses warning severity when configured', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule, {
      severity: 'warning',
    });

    const diagnostics = adapted.check(
      '/src/app.py',
      'def temp_func():\n    pass',
      { words: ['temp'] }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('detects multiple forbidden words in the same file', () => {
    const adapted = ruffAdapter.adapt(forbiddenWordsRule);

    const pythonSource = `
def get_temp_data():
    pass

hack_value = 42

class TempProcessor:
    pass
`;

    const diagnostics = adapted.check(
      '/src/bad.py',
      pythonSource,
      { words: ['temp', 'hack'] }
    );

    expect(diagnostics).toHaveLength(3);
  });
});

describe('ruffDiagnosticToViolation', () => {
  it('converts a full ruff diagnostic to PolicyViolation', () => {
    const diag: RuffDiagnostic = {
      cell: null,
      code: 'E501',
      message: 'Line too long (120 > 88)',
      filename: '/project/src/main.py',
      location: { row: 15, column: 1 },
      end_location: { row: 15, column: 121 },
      fix: null,
      noqa_row: 15,
      url: 'https://docs.astral.sh/ruff/rules/line-too-long',
    };

    const violation = ruffDiagnosticToViolation(diag);

    expect(violation.ruleId).toBe('E501');
    expect(violation.filePath).toBe('/project/src/main.py');
    expect(violation.message).toBe('Line too long (120 > 88)');
    expect(violation.line).toBe(15);
    expect(violation.column).toBe(1);
  });

  it('converts a diagnostic with fix information', () => {
    const diag: RuffDiagnostic = {
      cell: null,
      code: 'F401',
      message: '`os` imported but unused',
      filename: '/project/src/app.py',
      location: { row: 1, column: 1 },
      end_location: { row: 1, column: 10 },
      fix: {
        applicability: 'safe',
        message: 'Remove unused import: `os`',
        edits: [{
          content: '',
          location: { row: 1, column: 1 },
          end_location: { row: 2, column: 1 },
        }],
      },
      noqa_row: 1,
      url: 'https://docs.astral.sh/ruff/rules/unused-import',
    };

    const violation = ruffDiagnosticToViolation(diag);

    expect(violation.ruleId).toBe('F401');
    expect(violation.message).toBe('`os` imported but unused');
  });
});

describe('ruff adapter with custom TreeCheckProvider', () => {
  it('works with a custom provider targeting Python', () => {
    const customRule = pluginRuleNew({
      id: 'no-pass-statement',
      capabilities: {
        treeCheckProvider: treeCheckProviderNew({
          languages: ['python'],
          check: (_rule, ctx) => {
            const violations = [];
            const lines = ctx.source.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim() === 'pass') {
                violations.push({
                  ruleId: 'no-pass-statement',
                  filePath: ctx.filePath,
                  message: 'Avoid empty pass statements',
                  line: i + 1,
                  column: lines[i].indexOf('pass') + 1,
                });
              }
            }
            return violations;
          },
        }),
      },
    });

    const adapted = ruffAdapter.adapt(customRule);

    const diagnostics = adapted.check(
      '/src/empty.py',
      'def noop():\n    pass\n\ndef real():\n    return 42\n'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe('Avoid empty pass statements');
    expect(diagnostics[0].line).toBe(2);
  });
});
