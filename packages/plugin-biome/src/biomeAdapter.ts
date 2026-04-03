/**
 * @packageDocumentation
 * Biome adapter for TreeCheckProvider.
 *
 * Since Biome has no JavaScript plugin API for custom rules, this adapter
 * wraps a TreeCheckProvider to run its tree-sitter checks directly on JS/TS
 * files and return LintDiagnostic[].
 */

import type {
  TreeCheckLintAdapter,
  TreeCheckAdapterOptions,
  CodepolPluginRule,
  PolicyRule,
  PolicyCheckContext,
  PolicyFile,
  PolicyRuleTarget,
  LintDiagnostic,
} from '@codepol/core';
import {
  violationToLintDiagnostic,
  isErr,
  treeCheckProviderSupportsLanguage,
} from '@codepol/core';
import type { BiomeAdaptedRule } from './biomeTypes';

const BIOME_LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.jsx', 'jsx'],
  ['.ts', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.tsx', 'tsx'],
]);

function biomeLanguageGet(filePath: string): string | null {
  const extensionIndex = filePath.lastIndexOf('.');
  if (extensionIndex === -1) {
    return null;
  }
  return BIOME_LANGUAGE_BY_EXTENSION.get(filePath.slice(extensionIndex).toLowerCase()) ?? null;
}

/**
 * Creates an adapted rule that runs a TreeCheckProvider's check directly
 * on a JS/TS file and returns LintDiagnostic[].
 */
function createAdaptedRule(
  plugin: CodepolPluginRule,
  options?: TreeCheckAdapterOptions
): BiomeAdaptedRule {
  const ruleName = options?.ruleName ?? `biome-check-${plugin.id}`;
  const defaultSeverity = options?.severity ?? 'error';
  const treeCheckProvider = plugin.capabilities.treeCheckProvider;

  return {
    ruleId: plugin.id,
    ruleName,
    check(filePath: string, source: string, ruleArgs?: unknown): LintDiagnostic[] {
      if (!treeCheckProvider) {
        return [];
      }

      const language = biomeLanguageGet(filePath);
      if (!language) {
        return [];
      }

      if (!treeCheckProviderSupportsLanguage(treeCheckProvider, language)) {
        return [];
      }

      const emptyPolicy: PolicyFile = {
        targets: {},
        rules: [],
      };

      const syntheticTarget: PolicyRuleTarget = {
        language,
        files: ['**/*'],
      };

      const checkContext: PolicyCheckContext = {
        filePath,
        source,
        policy: emptyPolicy,
        dir: process.cwd(),
        target: syntheticTarget,
        ruleArgs,
      };

      const syntheticRule: PolicyRule = {
        ruleId: plugin.id,
        targets: ['_synthetic'],
      };

      const result = treeCheckProvider.check(syntheticRule, checkContext);

      if (isErr(result)) {
        return [{
          message: `Tree-check error: ${result.Err}`,
          line: 1,
          column: 1,
          ruleId: plugin.id,
          severity: 'error',
        }];
      }

      return result.Ok.map((violation) =>
        violationToLintDiagnostic(violation, defaultSeverity)
      );
    },
  };
}

/**
 * Biome adapter for TreeCheckProvider.
 *
 * Converts a TreeCheckProvider into a BiomeAdaptedRule that runs
 * tree-sitter based checks directly on JS/TS files.
 */
export const biomeAdapter: TreeCheckLintAdapter<BiomeAdaptedRule> = {
  platform: 'biome',
  adapt: (plugin, options) => createAdaptedRule(plugin, options),
};
