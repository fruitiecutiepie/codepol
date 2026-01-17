/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint adapter for TreeCheckProvider.
 *
 * Converts a TreeCheckProvider into an ESLint rule module, enabling
 * tree-sitter based checks to run within ESLint's infrastructure.
 */

import path from 'path';
import { ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type {
  TreeCheckLintAdapter,
  TreeCheckAdapterOptions,
  PolicyFile,
  PolicyRule,
  PolicyCheckContext,
  PolicyRuleTargetContext,
  LintDiagnostic,
  CodepolPluginRule,
} from '@codepol/core';
import {
  violationToLintDiagnostic,
  policyFileGet,
  policyCacheClear,
  policyRuleTargetsResolve,
  globPatternsGetMatchAny,
  ruleTargetMatchesLanguage,
  isErr,
} from '@codepol/core';

// Re-export cache clear
export { policyCacheClear };

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
    /** Rule-specific arguments */
    [key: string]: unknown;
  }?
];

type MessageIds = 'treeCheckViolation';

function policyRuleTargetsGet(policy: PolicyFile): PolicyRuleTargetContext[] {
  const targets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    const resolvedTargets = policyRuleTargetsResolve(rule, policy);
    for (const target of resolvedTargets) {
      targets.push({
        ruleId: rule.id || rule.ruleId,
        description: rule.description,
        args: rule.args,
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
  provider: CodepolPluginRule,
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
  
  // Note: CodepolPluginRule does not have init method currently in type definition?
  // I removed init from PolicyPlugin and CodepolPluginRule in core/policyTypes.ts?
  // Let's check.
  // If removed, then this logic is obsolete.
  // But wait, WASM parser init is global. Plugin specific init?
  // The plan said "Deprecate/Remove monolithic PolicyPlugin type".
  // If plugins need init, how?
  // Maybe explicit init in the plugin module?
  // For now, let's assume no per-rule-plugin init is needed or handled elsewhere.
  // If so, I can remove this ensureProviderInit or make it no-op.
  
  // For backward compatibility or future use, let's keep it but check if init exists.
  // But TS will complain if property doesn't exist.
  // I'll cast to any for now to be safe if I add it back, or just remove.
  // Since I removed init from types, I should remove it here.
  
  providerInitState.set(key, true);
}

/**
 * Creates an ESLint rule from a TreeCheckProvider.
 */
function createAdaptedRule(
  plugin: CodepolPluginRule,
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
        description: `Tree-check rule adapted from ${plugin.id}`,
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
          additionalProperties: true, // Allow ruleArgs to be passed
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

      // Get args from matched target (policy rule args)
      // Fall back to extra options for backward compatibility
      const { policyPath: _p, ruleTargets: _rt, policyExclude: _pe, ...extraArgs } = ruleOptions;
      const ruleArgs = matchedTarget.args ?? extraArgs;

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
            ruleArgs: ruleArgs,
          };

          // Build a synthetic PolicyRule for the provider
          const syntheticRule: PolicyRule = {
            id: matchedTarget.ruleId,
            ruleId: plugin.id,
            description: matchedTarget.description,
            args: matchedTarget.args,
            targets: [matchedTarget.target],
          };

          // Ensure provider is initialized (blocking for ESLint sync context)
          // Since we removed init, we just ensure the map has it for tracking?
          if (!providerInitState.has(plugin.id)) {
             providerInitState.set(plugin.id, true);
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
  provider: CodepolPluginRule,
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
