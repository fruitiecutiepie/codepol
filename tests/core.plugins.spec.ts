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
import { writeFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('plugin capability validation', () => {
  it('returns Err when plugin is missing treeCheckProvider capability', async () => {
    // Create a mock plugin without treeCheckProvider
    const mockPlugin: PluginRule = {
      pluginRule: pluginRuleNew({
        id: 'mock-plugin',
        capabilities: {}, // Empty capabilities
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

    // Use dummy file path since we expect failure before file access
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
      expect(result.Err).toContain('does not support tree checks');
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
});
