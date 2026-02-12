import { describe, expect, it } from 'vitest';
import { eslintPluginCreate } from './index';
import { pluginRuleNew } from '@codepol/core';
import type { EslintProviderConfig } from '@codepol/core';
import { Ok } from '@codepol/core';

describe('eslintPluginCreate', () => {
  // ==========================================================================
  // pluginRulesNormalize (tested indirectly through eslintPluginCreate)
  // ==========================================================================

  describe('CJS/ESM interop normalization', () => {
    it('should accept a plain array of plugin rules', () => {
      const rule = pluginRuleNew({
        id: 'test-rule',
        capabilities: {
          lintProviders: [
            {
              platform: 'eslint',
              languages: ['typescript'],
              config: {
                rules: { 'test-rule': { create: () => ({}) } },
              } satisfies EslintProviderConfig,
            },
          ],
        },
      });

      const plugin = eslintPluginCreate([rule]);

      expect(plugin.rules).toBeDefined();
      expect(plugin.rules!['test-rule']).toBeDefined();
    });

    it('should handle CJS interop format { __esModule: true, default: [...] }', () => {
      const rule = pluginRuleNew({
        id: 'cjs-rule',
        capabilities: {
          lintProviders: [
            {
              platform: 'eslint',
              languages: ['typescript'],
              config: {
                rules: { 'cjs-rule': { create: () => ({}) } },
              } satisfies EslintProviderConfig,
            },
          ],
        },
      });

      const cjsWrapped = { __esModule: true, default: [rule] };
      const plugin = eslintPluginCreate(cjsWrapped);

      expect(plugin.rules).toBeDefined();
      expect(plugin.rules!['cjs-rule']).toBeDefined();
    });

    it('should handle { default: [...] } format', () => {
      const rule = pluginRuleNew({
        id: 'default-rule',
        capabilities: {
          lintProviders: [
            {
              platform: 'eslint',
              languages: ['typescript'],
              config: {
                rules: { 'default-rule': { create: () => ({}) } },
              } satisfies EslintProviderConfig,
            },
          ],
        },
      });

      const defaultWrapped = { default: [rule] };
      const plugin = eslintPluginCreate(defaultWrapped);

      expect(plugin.rules).toBeDefined();
      expect(plugin.rules!['default-rule']).toBeDefined();
    });

    it('should handle { pluginRules: [...] } format', () => {
      const rule = pluginRuleNew({
        id: 'plugin-rules-format',
        capabilities: {
          lintProviders: [
            {
              platform: 'eslint',
              languages: ['typescript'],
              config: {
                rules: { 'plugin-rules-format': { create: () => ({}) } },
              } satisfies EslintProviderConfig,
            },
          ],
        },
      });

      const pluginRulesWrapped = { pluginRules: [rule] };
      const plugin = eslintPluginCreate(pluginRulesWrapped);

      expect(plugin.rules).toBeDefined();
      expect(plugin.rules!['plugin-rules-format']).toBeDefined();
    });

    it('should throw for invalid input', () => {
      expect(() => eslintPluginCreate('not an array')).toThrow(
        'eslintPluginCreate expects an array of CodepolPluginRule'
      );

      expect(() => eslintPluginCreate(42)).toThrow(
        'eslintPluginCreate expects an array of CodepolPluginRule'
      );
    });
  });

  // ==========================================================================
  // collectRules — lint providers
  // ==========================================================================

  describe('rule assembly from lintProviders', () => {
    it('should collect ESLint rules from lintProviders with platform "eslint"', () => {
      const mockRule = { create: () => ({}) };
      const rule = pluginRuleNew({
        id: 'lint-provider-rule',
        capabilities: {
          lintProviders: [
            {
              platform: 'eslint',
              languages: ['typescript'],
              config: {
                rules: {
                  'custom-rule-a': mockRule,
                  'custom-rule-b': mockRule,
                },
              } satisfies EslintProviderConfig,
            },
          ],
        },
      });

      const plugin = eslintPluginCreate([rule]);

      expect(plugin.rules!['custom-rule-a']).toBe(mockRule);
      expect(plugin.rules!['custom-rule-b']).toBe(mockRule);
    });

    it('should skip lintProviders with non-eslint platforms', () => {
      const rule = pluginRuleNew({
        id: 'biome-rule',
        capabilities: {
          lintProviders: [
            {
              platform: 'biome',
              languages: ['typescript'],
              config: { rules: { 'biome-only': {} } },
            },
          ],
        },
      });

      const plugin = eslintPluginCreate([rule]);

      expect(plugin.rules!['biome-only']).toBeUndefined();
    });
  });

  // ==========================================================================
  // collectRules — treeCheckProvider adaptation
  // ==========================================================================

  describe('treeCheckProvider adaptation', () => {
    it('should auto-adapt treeCheckProvider-only rules keyed by plugin id', () => {
      const rule = pluginRuleNew({
        id: 'tree-check-only',
        capabilities: {
          treeCheckProvider: {
            languages: ['typescript'],
            check: (_rule, _ctx) => Ok([]),
          },
        },
      });

      const plugin = eslintPluginCreate([rule]);

      // The adapted rule should be keyed by the plugin rule ID
      expect(plugin.rules!['tree-check-only']).toBeDefined();
      // It should be an object with a create function (ESLint rule module)
      expect(typeof plugin.rules!['tree-check-only']).toBe('object');
    });

    it('should not auto-adapt when an ESLint lintProvider already exists', () => {
      const mockRule = { create: () => ({}) };
      const rule = pluginRuleNew({
        id: 'both-providers',
        capabilities: {
          lintProviders: [
            {
              platform: 'eslint',
              languages: ['typescript'],
              config: {
                rules: { 'explicit-eslint-rule': mockRule },
              } satisfies EslintProviderConfig,
            },
          ],
          treeCheckProvider: {
            languages: ['typescript'],
            check: (_rule, _ctx) => Ok([]),
          },
        },
      });

      const plugin = eslintPluginCreate([rule]);

      // The explicit ESLint rule should be present
      expect(plugin.rules!['explicit-eslint-rule']).toBe(mockRule);
      // The treeCheckProvider should NOT be auto-adapted since eslint lintProvider exists
      expect(plugin.rules!['both-providers']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Multiple rules
  // ==========================================================================

  describe('multiple rules', () => {
    it('should collect rules from multiple plugin rules into a single plugin', () => {
      const mockRuleA = { create: () => ({}) };
      const ruleA = pluginRuleNew({
        id: 'rule-a',
        capabilities: {
          lintProviders: [
            {
              platform: 'eslint',
              languages: ['typescript'],
              config: {
                rules: { 'rule-a': mockRuleA },
              } satisfies EslintProviderConfig,
            },
          ],
        },
      });

      const ruleB = pluginRuleNew({
        id: 'rule-b',
        capabilities: {
          treeCheckProvider: {
            languages: ['typescript'],
            check: (_rule, _ctx) => Ok([]),
          },
        },
      });

      const plugin = eslintPluginCreate([ruleA, ruleB]);

      expect(plugin.rules!['rule-a']).toBe(mockRuleA);
      expect(plugin.rules!['rule-b']).toBeDefined();
    });
  });
});
