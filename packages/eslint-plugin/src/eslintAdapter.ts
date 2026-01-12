/**
 * @packageDocumentation
 * ESLint adapter for TreeCheckProvider.
 *
 * Converts a TreeCheckProvider into an ESLint rule module, enabling
 * tree-sitter based checks to run within ESLint's infrastructure.
 */

import path from 'path';
import { ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type {
  TreeCheckProvider,
  TreeCheckLintAdapter,
  TreeCheckAdapterOptions,
  PolicyFile,
  PolicyRule,
  PolicyCheckContext,
  PolicyRuleTargetContext,
  LintDiagnostic,
  PolicyPlugin,
} from '@codepol/core';
import {
  violationToLintDiagnostic,
  policyFileGet,
  policyCacheClear,
  globPatternsGetMatchAny,
  ruleTargetMatchesLanguage,
  isErr,
} from '@codepol/core';

// Re-export cache clear
export { policyCacheClear };
/** @deprecated Use policyCacheClear instead */
export { policyCacheClear as clearPolicyCache };

/**
 * ESLint rule options for tree-check adapted rules.
 */
type AdaptedRuleOptions = [
  {
    /** Path to the policy.json file */
    policyPath?: string;
    /** Resolved rule targets passed from the CLI */
    ruleTargets?: PolicyRuleTargetContext[];
    /** Global exclude patterns from the policy */
    policyExclude?: string[];
  }?
];

type MessageIds = 'treeCheckViolation';

function policyRuleTargetsGet(policy: PolicyFile): PolicyRuleTargetContext[] {
  const targets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    for (const target of rule.targets) {
      targets.push({
        ruleId: rule.id,
        semantics: rule.semantics,
        target,
      });
    }
  }
  return targets;
}

function fileMatchesPolicy(
  ruleTargets: PolicyRuleTargetContext[],
  policyExclude: string[],
  filePath: string
): PolicyRuleTargetContext | null {
  const relative = path.relative(process.cwd(), filePath);
  if (globPatternsGetMatchAny(policyExclude, relative)) {
    return null;
  }
  for (const ruleTarget of ruleTargets) {
    const target = ruleTarget.target;
    if (globPatternsGetMatchAny(target.files, relative)) {
      if (globPatternsGetMatchAny(target.exclude, relative)) {
        continue;
      }
      if (!ruleTargetMatchesLanguage(target, relative)) {
        continue;
      }
      return ruleTarget;
    }
  }
  return null;
}

/**
 * Converts a LintDiagnostic to ESLint's loc format.
 * ESLint uses 1-based lines but 0-based columns.
 */
function diagnosticToEslintLoc(diagnostic: LintDiagnostic): TSESLint.ReportDescriptor<MessageIds>['loc'] {
  return {
    start: {
      line: diagnostic.line,
      column: diagnostic.column - 1, // ESLint uses 0-based columns
    },
    end: {
      line: diagnostic.endLine ?? diagnostic.line,
      column: (diagnostic.endColumn ?? diagnostic.column) - 1,
    },
  };
}

// Singleton for provider initialization state
const providerInitState = new Map<string, Promise<void> | true>();

/**
 * Ensures a provider is initialized (handles async init).
 */
async function ensureProviderInit(
  provider: PolicyPlugin,
  policy: PolicyFile,
  cwd: string
): Promise<void> {
  const key = provider.id;
  const state = providerInitState.get(key);
  
  if (state === true) {
    return; // Already initialized
  }
  
  if (state instanceof Promise) {
    await state; // Wait for in-progress initialization
    return;
  }
  
  if (provider.init) {
    const initPromise = Promise.resolve(provider.init({ cwd, policy })).then(() => {
      providerInitState.set(key, true);
    });
    providerInitState.set(key, initPromise);
    await initPromise;
  } else {
    providerInitState.set(key, true);
  }
}

/**
 * Creates an ESLint rule from a TreeCheckProvider.
 */
function createAdaptedRule(
  plugin: PolicyPlugin,
  options?: TreeCheckAdapterOptions
): TSESLint.RuleModule<MessageIds, AdaptedRuleOptions> {
  const ruleName = options?.ruleName ?? `tree-check-${plugin.id}`;
  const ruleUrl = options?.ruleUrl ?? '';
  const defaultSeverity = options?.severity ?? 'error';

  const createRule = ESLintUtils.RuleCreator(() => ruleUrl);

  const treeCheckProvider = plugin.capabilities.treeCheckProvider;

  return createRule<AdaptedRuleOptions, MessageIds>({
    name: ruleName,
    meta: {
      type: 'problem',
      docs: {
        description: `Tree-check rule adapted from ${plugin.id} (v${plugin.version})`,
      },
      messages: {
        treeCheckViolation: '{{message}}',
      },
      schema: [
        {
          type: 'object',
          properties: {
            policyPath: {
              type: 'string',
              description: 'Path to the policy.json file',
            },
            ruleTargets: {
              type: 'array',
              items: { type: 'object' },
            },
            policyExclude: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          additionalProperties: false,
        },
      ],
    },
    defaultOptions: [{}],
    create(context) {
      const filename = context.filename;
      if (filename === '<input>' || !filename) {
        return {};
      }

      if (!treeCheckProvider) {
        return {};
      }

      // Resolve options
      const ruleOptions = context.options[0] ?? {};
      const policyPath = ruleOptions.policyPath ?? options?.policyPath ?? path.resolve(process.cwd(), 'policy.json');
      
      let policy: PolicyFile;
      try {
        policy = policyFileGet(policyPath);
      } catch {
        // Policy file not found, skip checking
        return {};
      }

      const policyExclude = ruleOptions.policyExclude ?? policy.exclude ?? [];
      const ruleTargets = ruleOptions.ruleTargets ?? policyRuleTargetsGet(policy);

      // Check if file matches any rule target
      const matchedTarget = fileMatchesPolicy(ruleTargets, policyExclude, filename);
      if (!matchedTarget) {
        return {};
      }

      return {
        'Program:exit'(node) {
          const sourceCode = context.sourceCode;
          const source = sourceCode.getText();

          // Build PolicyCheckContext
          const checkContext: PolicyCheckContext = {
            filePath: filename,
            source,
            policy,
            dir: process.cwd(),
            target: matchedTarget.target,
          };

          // Build a synthetic PolicyRule for the provider
          const syntheticRule: PolicyRule = {
            id: matchedTarget.ruleId,
            semantics: matchedTarget.semantics,
            targets: [matchedTarget.target],
          };

          // Ensure provider is initialized (blocking for ESLint sync context)
          // Note: ESLint rules are sync, so we handle init in a blocking manner
          // by assuming init was called before rule execution (via plugin setup)
          if (plugin.init && !providerInitState.has(plugin.id)) {
            // Synchronous fallback - init should be called before linting
            console.warn(
              `[eslint-adapter] Provider ${plugin.id} has async init. ` +
              `Call ensureProviderInit() before running ESLint for best results.`
            );
          }

          // Run the tree-check
          const checkResult = treeCheckProvider.check(syntheticRule, checkContext);
          
          if (isErr(checkResult)) {
            // Report internal check error as a warning/error
            context.report({
              node,
              messageId: 'treeCheckViolation',
              data: {
                message: `Tree-check error: ${checkResult.Err}`,
              },
            });
            return;
          }

          const violations = checkResult.Ok;

          // Report each violation
          for (const violation of violations) {
            const diagnostic = violationToLintDiagnostic(violation, defaultSeverity);
            context.report({
              node,
              loc: diagnosticToEslintLoc(diagnostic),
              messageId: 'treeCheckViolation',
              data: {
                message: diagnostic.message,
              },
            });
          }
        },
      };
    },
  });
}

/**
 * ESLint adapter for TreeCheckProvider.
 *
 * Converts a TreeCheckProvider into an ESLint rule module.
 *
 * @example
 * ```typescript
 * import { eslintAdapter } from '@codepol/eslint-plugin';
 * import { policyPluginLogger } from '@codepol/plugin';
 *
 * const eslintRule = eslintAdapter.adapt(policyPluginLogger, {
 *   ruleName: 'require-logger-enter-exit',
 * });
 *
 * // Use in ESLint config
 * export default {
 *   plugins: { codepol: { rules: { 'require-logger-enter-exit': eslintRule } } },
 *   rules: { 'codepol/require-logger-enter-exit': 'error' },
 * };
 * ```
 */
export const eslintAdapter: TreeCheckLintAdapter<TSESLint.RuleModule<string, unknown[]>> = {
  platform: 'eslint',
  adapt: (plugin, options) => createAdaptedRule(plugin, options) as TSESLint.RuleModule<string, unknown[]>,
};

/**
 * Pre-initialize a TreeCheckProvider for use with ESLint.
 * Call this before running ESLint to ensure async initialization completes.
 *
 * @param provider - The TreeCheckProvider to initialize
 * @param policy - The policy file
 * @param cwd - Current working directory
 */
export async function eslintAdapterInit(
  provider: PolicyPlugin,
  policy: PolicyFile,
  cwd: string
): Promise<void> {
  await ensureProviderInit(provider, policy, cwd);
}

/**
 * Clears the provider initialization state.
 * Useful for testing or when reinitializing providers.
 */
export function providerInitStateClear(): void {
  providerInitState.clear();
}

/** @deprecated Use providerInitStateClear instead */
export const clearProviderInitState = providerInitStateClear;
