import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  policyViolationsGetForFile,
  langAdd,
  parserInit,
  pluginRuleNew,
  isOk,
  type PolicyFile,
  type PluginRule,
  type PolicyRule,
  type PolicyRuleTarget,
} from '@codepol/core';
import { Ok } from '@codepol/core';
import { loggerEnterExitRule } from '@codepol/plugin';
import { forbiddenPathWordsRule } from '../packages/plugin/src/forbiddenPathWordsRule';
import { noVerbFunctionNameRule } from '../packages/plugin/src/noVerbFunctionNameRule';
import { writeFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('plugin capability validation', () => {
  it('returns empty violations when plugin is missing treeCheckProvider capability', async () => {
    const mockPlugin: PluginRule = {
      pluginRule: pluginRuleNew({
        id: 'mock-plugin',
        capabilities: {},
      }),
    };

    const pluginsMap = new Map();
    pluginsMap.set('mock-plugin', mockPlugin);

    const target: PolicyRuleTarget = {
      language: 'typescript',
      files: ['**/*.ts'],
    };

    const rule: PolicyRule = {
      id: 'test-rule',
      ruleId: 'mock-plugin',
      description: 'test',
      targets: ['ts-files'],
    };

    const policy: PolicyFile = {
      targets: { 'ts-files': target },
      rules: [rule],
    };

    const filePath = path.join(process.cwd(), 'dummy.ts');

    const result = policyViolationsGetForFile(
      filePath,
      rule,
      target,
      policy,
      pluginsMap,
      process.cwd()
    );

    expect(isOk(result)).toBe(true);
    expect(result.Ok!).toHaveLength(0);
  });

  it('allows target language when plugin omits languages list', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-plugin-any-language-'));
      const filePath = path.join(tempDir, 'script.py');
      writeFileSync(filePath, 'print("ok")\n');

      try {
        const mockPlugin: PluginRule = {
          pluginRule: pluginRuleNew({
            id: 'mock-plugin-any-language',
            capabilities: {
              treeCheckProvider: {
                check: () => Ok([]),
              },
            },
          }),
        };

        const pluginsMap = new Map();
        pluginsMap.set('mock-plugin-any-language', mockPlugin);

        const target: PolicyRuleTarget = {
          language: 'python',
          files: ['**/*.py'],
        };

        const rule: PolicyRule = {
          id: 'test-rule',
          ruleId: 'mock-plugin-any-language',
          description: 'test',
          targets: ['py-files'],
        };

        const policy: PolicyFile = {
          targets: { 'py-files': target },
          rules: [rule],
        };

        const result = policyViolationsGetForFile(
          filePath,
          rule,
          target,
          policy,
          pluginsMap,
          tempDir
        );

        expect(isOk(result)).toBe(true);
        expect(result.Ok!).toHaveLength(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

  it('returns Err when plugin does not support target language', () => {
      // Create a mock plugin with treeCheckProvider but wrong language
      const mockPlugin: PluginRule = {
        pluginRule: pluginRuleNew({
          id: 'mock-plugin-lang',
          capabilities: {
            treeCheckProvider: {
              languages: ['python'],
              check: () => Ok([]),
            }
          },
        }),
      };
  
      const pluginsMap = new Map();
      pluginsMap.set('mock-plugin-lang', mockPlugin);

      const target: PolicyRuleTarget = {
        language: 'typescript',
        files: ['**/*.ts'],
      };
  
      const rule: PolicyRule = {
        id: 'test-rule',
        ruleId: 'mock-plugin-lang',
        description: 'test',
        targets: ['ts-files'],
      };
  
      const policy: PolicyFile = {
        targets: { 'ts-files': target },
        rules: [rule],
      };
  
      // Use dummy file path
      const filePath = path.join(process.cwd(), 'dummy.ts');
  
      // Test policyViolationsGetForFile
      const result = policyViolationsGetForFile(
        filePath,
        rule,
        target,
        policy,
        pluginsMap,
        process.cwd()
      );
  
      expect('Err' in result).toBe(true);
      if ('Err' in result) {
        expect(result.Err).toContain('does not support language typescript');
      }
    });
});

describe('policyViolationsGetForFile with real plugin', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'python', fileExtensions: ['.py'] });
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-plugins-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns Ok with violations for uninstrumented function', () => {
    const filePath = path.join(testDir, 'app.ts');
    writeFileSync(filePath, 'export function run() { return 1; }');

    const loggerArgs = {
      logger: {
        identifier: 'logger',
        enterMethod: 'enter',
        exitMethod: 'exit',
        import: { module: './logger', named: 'logger' },
      },
    };

    const target: PolicyRuleTarget = {
      language: 'typescript',
      files: ['**/*.ts'],
    };

    const rule: PolicyRule = {
      id: 'function-logging',
      ruleId: loggerEnterExitRule.id,
      description: 'Ensure functions include logger enter/exit',
      args: loggerArgs,
      targets: ['src'],
    };

    const policy: PolicyFile = {
      targets: { src: target },
      rules: [rule],
    };

    const pluginsMap = new Map();
    pluginsMap.set(loggerEnterExitRule.id, { pluginRule: loggerEnterExitRule });

    const result = policyViolationsGetForFile(
      filePath,
      rule,
      target,
      policy,
      pluginsMap,
      testDir
    );

    expect(isOk(result)).toBe(true);
    const violations = result.Ok!;
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].ruleId).toBe('function-logging');
    expect(violations[0].message).toContain('run');
    expect(violations[0].filePath).toBe(filePath);
    expect(violations[0].line).toBeGreaterThan(0);
    expect(violations[0].column).toBeGreaterThan(0);
  });

  it('returns Ok with violations for forbidden words in Python paths', () => {
    const filePath = path.join(testDir, 'tmp', 'worker.py');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, 'def run():\n    return 1\n');

    const target: PolicyRuleTarget = {
      language: 'python',
      files: ['**/*.py'],
    };

    const rule: PolicyRule = {
      id: 'python-path-words',
      ruleId: forbiddenPathWordsRule.id,
      description: 'Disallow forbidden words in Python paths',
      args: { words: ['tmp'] },
      targets: ['src'],
    };

    const policy: PolicyFile = {
      targets: { src: target },
      rules: [rule],
    };

    const pluginsMap = new Map();
    pluginsMap.set(forbiddenPathWordsRule.id, {
      pluginRule: forbiddenPathWordsRule,
    });

    const result = policyViolationsGetForFile(
      filePath,
      rule,
      target,
      policy,
      pluginsMap,
      testDir
    );

    expect(isOk(result)).toBe(true);
    const violations = result.Ok!;
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe('python-path-words');
    expect(violations[0].message).toContain("Directory name 'tmp'");
    expect(violations[0].filePath).toBe(filePath);
  });

  it('returns Ok with violations for verb-named functions in Python files', () => {
    const filePath = path.join(testDir, 'service.py');
    writeFileSync(filePath, [
      'def get_data():',
      '    return []',
      '',
      'def data_store():',
      '    pass',
      '',
      'class Repo:',
      '    def __init__(self):',
      '        pass',
      '    def fetch_items(self):',
      '        return []',
    ].join('\n'));

    const target: PolicyRuleTarget = {
      language: 'python',
      files: ['**/*.py'],
    };

    const rule: PolicyRule = {
      id: 'python-verb-names',
      ruleId: noVerbFunctionNameRule.id,
      description: 'Disallow verb-prefixed function names in Python',
      args: { verbs: ['get', 'fetch', 'set', 'init'] },
      targets: ['py-src'],
    };

    const policy: PolicyFile = {
      targets: { 'py-src': target },
      rules: [rule],
    };

    const pluginsMap = new Map();
    pluginsMap.set(noVerbFunctionNameRule.id, {
      pluginRule: noVerbFunctionNameRule,
    });

    const result = policyViolationsGetForFile(
      filePath,
      rule,
      target,
      policy,
      pluginsMap,
      testDir
    );

    expect(isOk(result)).toBe(true);
    const violations = result.Ok!;
    expect(violations).toHaveLength(2);
    expect(violations.map(v => v.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('get_data'),
        expect.stringContaining('fetch_items'),
      ])
    );
    expect(violations[0].ruleId).toBe('python-verb-names');
    expect(violations[0].filePath).toBe(filePath);
    expect(violations[0].line).toBeGreaterThan(0);
    expect(violations[0].column).toBeGreaterThan(0);
  });

  it('runs no-verb-function-name through Ruff adapter for Python', () => {
    const { ruffAdapter } = require('@codepol/plugin-ruff');
    const adapted = ruffAdapter.adapt(noVerbFunctionNameRule);

    const pythonSource = [
      'def get_data():',
      '    return []',
      '',
      'def data_store():',
      '    pass',
      '',
      'class Repo:',
      '    def __init__(self):',
      '        pass',
      '    def fetch_items(self):',
      '        return []',
    ].join('\n');

    const diagnostics = adapted.check(
      '/src/service.py',
      pythonSource,
      { verbs: ['get', 'fetch', 'set', 'init'] }
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d: any) => d.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('get_data'),
        expect.stringContaining('fetch_items'),
      ])
    );
    expect(diagnostics[0].ruleId).toBe('no-verb-function-name');
    expect(diagnostics[0].severity).toBe('error');
  });
});
