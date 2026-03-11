/**
 * @packageDocumentation
 * Ruff adapter for TreeCheckProvider.
 *
 * Since Ruff is a Rust CLI tool with no JavaScript plugin API, this adapter
 * wraps a TreeCheckProvider to run its tree-sitter checks directly on Python
 * files and return LintDiagnostic[]. The "adapted rule" is a callable that
 * the CLI invokes for each matched Python file.
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
} from '@codepol/core';
import type { RuffAdaptedRule } from './ruffTypes';

/**
 * Creates an adapted rule that runs a TreeCheckProvider's check directly
 * on a Python file and returns LintDiagnostic[].
 */
function createAdaptedRule(
  plugin: CodepolPluginRule,
  options?: TreeCheckAdapterOptions
): RuffAdaptedRule {
  const ruleName = options?.ruleName ?? `ruff-check-${plugin.id}`;
  const defaultSeverity = options?.severity ?? 'error';
  const treeCheckProvider = plugin.capabilities.treeCheckProvider;

  return {
    ruleId: plugin.id,
    ruleName,
    check(filePath: string, source: string, ruleArgs?: unknown): LintDiagnostic[] {
      if (!treeCheckProvider) {
        return [];
      }

      if (!filePath.endsWith('.py') && !filePath.endsWith('.pyw')) {
        return [];
      }

      if (!treeCheckProvider.languages.includes('python')) {
        return [];
      }

      const emptyPolicy: PolicyFile = {
        targets: {},
        rules: [],
      };

      const syntheticTarget: PolicyRuleTarget = {
        language: 'python',
        files: ['**/*.py'],
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

      return result.Ok.map(v => violationToLintDiagnostic(v, defaultSeverity));
    },
  };
}

/**
 * Ruff adapter for TreeCheckProvider.
 *
 * Converts a TreeCheckProvider into a RuffAdaptedRule that runs
 * tree-sitter based checks directly on Python files.
 */
export const ruffAdapter: TreeCheckLintAdapter<RuffAdaptedRule> = {
  platform: 'ruff',
  adapt: (plugin, options) => createAdaptedRule(plugin, options),
};
