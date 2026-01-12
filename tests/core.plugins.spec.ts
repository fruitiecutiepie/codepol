import { describe, expect, it } from 'vitest';
import {
  policyViolationsGetForFile,
  policyViolationsGetFromDir,
  type PolicyFile,
  type PolicyPlugin,
  type PolicyRule,
  type PolicyRuleTarget,
} from '@codepol/core';
import { Ok } from '@codepol/core';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

describe('plugin capability validation', () => {
  it('returns Err when plugin is missing treeCheckProvider capability', async () => {
    // Create a mock plugin without treeCheckProvider
    const mockPlugin: PolicyPlugin = {
      id: 'mock-plugin',
      version: '1.0.0',
      capabilities: {}, // Empty capabilities
    };

    const pluginsMap = new Map();
    pluginsMap.set('mock-plugin', mockPlugin);

    const rule: PolicyRule = {
      id: 'test-rule',
      semantics: { description: 'test', type: 'mock-plugin' },
      targets: [
        { language: 'typescript', files: ['**/*.ts'] }
      ],
    };

    const target = rule.targets[0];
    const policy: PolicyFile = { rules: [rule] };

    // Use dummy file path since we expect failure before file access
    // But to be safe, let's satisfy the read logic if it gets there (it shouldn't)
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
      const mockPlugin: PolicyPlugin = {
        id: 'mock-plugin-lang',
        version: '1.0.0',
        capabilities: {
          treeCheckProvider: {
            languages: ['python'],
            check: () => Ok([]),
          }
        },
      };
  
      const pluginsMap = new Map();
      pluginsMap.set('mock-plugin-lang', mockPlugin);
  
      const rule: PolicyRule = {
        id: 'test-rule',
        semantics: { description: 'test', type: 'mock-plugin-lang' },
        targets: [
          { language: 'typescript', files: ['**/*.ts'] }
        ],
      };
  
      const target = rule.targets[0];
      const policy: PolicyFile = { rules: [rule] };
  
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
