import { describe, expect, it } from 'vitest';
import {
  policyViolationsGetForFile,
  type PolicyFile,
  type ResolvedPluginRule,
  type PolicyRule,
  type PolicyRuleTarget,
} from '@codepol/core';
import { Ok } from '@codepol/core';
import path from 'node:path';

describe('plugin capability validation', () => {
  it('returns Err when plugin is missing treeCheckProvider capability', async () => {
    // Create a mock plugin without treeCheckProvider
    const mockPlugin: ResolvedPluginRule = {
      pluginRule: {
        id: 'mock-plugin',
        capabilities: {}, // Empty capabilities
      }
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
      const mockPlugin: ResolvedPluginRule = {
        pluginRule: {
          id: 'mock-plugin-lang',
          capabilities: {
            treeCheckProvider: {
              languages: ['python'],
              check: () => Ok([]),
            }
          },
        }
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
