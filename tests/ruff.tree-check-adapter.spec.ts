import { beforeAll, describe, expect, it } from 'vitest';
import { ruffAdapter, ruffDiagnosticToViolation } from '@codepol/plugin-ruff';
import type { RuffDiagnostic } from '@codepol/plugin-ruff';
import { langAdd, parserInit, pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { forbiddenWordsCheck } from '../packages/plugin/src/forbiddenWordsCheck';
import { noVerbFunctionNameRule } from '../packages/plugin/src/noVerbFunctionNameRule';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'py');

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

function noPassStatementRuleCreate(languages?: string[]) {
  return pluginRuleNew({
    id: 'no-pass-statement',
    capabilities: {
      treeCheckProvider: treeCheckProviderNew({
        ...(languages ? { languages } : {}),
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
}

describe('ruff adapter with custom TreeCheckProvider', () => {
  it('works with a custom provider when languages are omitted', () => {
    const adapted = ruffAdapter.adapt(noPassStatementRuleCreate());

    const diagnostics = adapted.check(
      '/src/empty.py',
      'def noop():\n    pass\n\ndef real():\n    return 42\n'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe('Avoid empty pass statements');
    expect(diagnostics[0].line).toBe(2);
  });

  it('works with a custom provider targeting Python', () => {
    const adapted = ruffAdapter.adapt(noPassStatementRuleCreate(['python']));

    const diagnostics = adapted.check(
      '/src/empty.py',
      'def noop():\n    pass\n\ndef real():\n    return 42\n'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe('Avoid empty pass statements');
    expect(diagnostics[0].line).toBe(2);
  });

  it('skips Python files when provider explicitly excludes python', () => {
    const adapted = ruffAdapter.adapt(noPassStatementRuleCreate(['typescript']));

    const diagnostics = adapted.check(
      '/src/empty.py',
      'def noop():\n    pass\n'
    );

    expect(diagnostics).toHaveLength(0);
  });
});

describe('ruff adapter with no-verb-function-name rule', () => {
  it('detects verb-prefixed function names in Python', () => {
    const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);

    const pythonSource = [
      'def get_data():',
      '    return []',
      '',
      'def data_store():',
      '    pass',
    ].join('\n');

    const diagnostics = adapted.check(
      '/src/service.py',
      pythonSource,
      { verbs: ['get', 'set'] }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('get_data');
    expect(diagnostics[0].ruleId).toBe('no-verb-function-name');
    expect(diagnostics[0].severity).toBe('error');
  });

  it('detects verb-prefixed methods inside classes', () => {
    const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);

    const pythonSource = [
      'class UserService:',
      '    def fetch_users(self):',
      '        return []',
      '',
      '    def users_list(self):',
      '        return []',
    ].join('\n');

    const diagnostics = adapted.check(
      '/src/users.py',
      pythonSource,
      { verbs: ['fetch'] }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('fetch_users');
  });

  it('skips dunder methods', () => {
    const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);

    const pythonSource = [
      'class Model:',
      '    def __init__(self):',
      '        pass',
      '    def __getitem__(self, key):',
      '        return None',
      '    def __setattr__(self, name, value):',
      '        pass',
    ].join('\n');

    const diagnostics = adapted.check(
      '/src/model.py',
      pythonSource,
      { verbs: ['init', 'get', 'set'] }
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('returns no diagnostics for non-Python files', () => {
    const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);

    const diagnostics = adapted.check(
      '/src/service.ts',
      'function getData() { return []; }',
      { verbs: ['get'] }
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('returns no diagnostics when no verbs match', () => {
    const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);

    const pythonSource = [
      'def data_handler():',
      '    pass',
      '',
      'def item_processor():',
      '    pass',
    ].join('\n');

    const diagnostics = adapted.check(
      '/src/handlers.py',
      pythonSource,
      { verbs: ['get', 'set', 'fetch'] }
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('detects multiple violations across functions and methods', () => {
    const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);

    const pythonSource = [
      'def get_data():',
      '    return []',
      '',
      'def fetch_items():',
      '    return []',
      '',
      'class Repo:',
      '    def set_value(self, v):',
      '        self.v = v',
    ].join('\n');

    const diagnostics = adapted.check(
      '/src/repo.py',
      pythonSource,
      { verbs: ['get', 'fetch', 'set'] }
    );

    expect(diagnostics).toHaveLength(3);
    const messages = diagnostics.map((d: any) => d.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('get_data'),
        expect.stringContaining('fetch_items'),
        expect.stringContaining('set_value'),
      ])
    );
  });

  it('uses warning severity when configured', () => {
    const adapted = ruffAdapter.adapt(noVerbFunctionNameRule, {
      severity: 'warning',
    });

    const diagnostics = adapted.check(
      '/src/app.py',
      'def get_value():\n    return 1\n',
      { verbs: ['get'] }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
  });
});

function fixtureRead(relativePath: string): { filePath: string; source: string } {
  const filePath = path.join(FIXTURE_DIR, relativePath);
  return { filePath, source: fs.readFileSync(filePath, 'utf8') };
}

describe('ruff adapter with fixture files', () => {
  describe('forbidden-words on fixtures', () => {
    it('detects forbidden words in helpers.py', () => {
      const adapted = ruffAdapter.adapt(forbiddenWordsRule);
      const { filePath, source } = fixtureRead('myapp/services/helpers.py');

      const diagnostics = adapted.check(filePath, source, { words: ['batch'] });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain("'process_batch'");
      expect(diagnostics[0].message).toContain("'batch'");
    });

    it('detects forbidden words in commands.py', () => {
      const adapted = ruffAdapter.adapt(forbiddenWordsRule);
      const { filePath, source } = fixtureRead('myapp/cli/commands.py');

      const diagnostics = adapted.check(filePath, source, { words: ['command'] });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain("'run_command'");
    });

    it('returns no diagnostics for clean fixture file', () => {
      const adapted = ruffAdapter.adapt(forbiddenWordsRule);
      const { filePath, source } = fixtureRead('myapp/__init__.py');

      const diagnostics = adapted.check(filePath, source, { words: ['forbidden'] });

      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('no-verb-function-name on fixtures', () => {
    it('detects verb-prefixed functions in commands.py', () => {
      const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);
      const { filePath, source } = fixtureRead('myapp/cli/commands.py');

      const diagnostics = adapted.check(filePath, source, { verbs: ['run', 'list'] });

      expect(diagnostics).toHaveLength(2);
      const messages = diagnostics.map((d: any) => d.message);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.stringContaining('run_command'),
          expect.stringContaining('list_users'),
        ])
      );
    });

    it('detects verb-prefixed functions in auth.py', () => {
      const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);
      const { filePath, source } = fixtureRead('myapp/services/auth.py');

      const diagnostics = adapted.check(filePath, source, { verbs: ['refresh', 'verify'] });

      expect(diagnostics).toHaveLength(2);
      const messages = diagnostics.map((d: any) => d.message);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.stringContaining('refresh_token'),
          expect.stringContaining('verify_model'),
        ])
      );
    });

    it('detects verb-prefixed functions in helpers.py', () => {
      const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);
      const { filePath, source } = fixtureRead('myapp/services/helpers.py');

      const diagnostics = adapted.check(filePath, source, { verbs: ['process'] });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('process_batch');
    });

    it('skips dunder methods in user.py', () => {
      const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);
      const { filePath, source } = fixtureRead('myapp/models/user.py');

      const diagnostics = adapted.check(filePath, source, { verbs: ['init', 'get'] });

      expect(diagnostics).toHaveLength(0);
    });

    it('detects nothing in standalone.py with non-matching verbs', () => {
      const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);
      const { filePath, source } = fixtureRead('standalone.py');

      const diagnostics = adapted.check(filePath, source, { verbs: ['fetch', 'set'] });

      expect(diagnostics).toHaveLength(0);
    });
  });
});
