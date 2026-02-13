/**
 * @packageDocumentation
 * @codepol/plugin - Logger plugin capabilities for codepol.
 *
 * Provides ESLint rule definitions plus tree-sitter check integration.
 */

import path from 'path';
import { ESLintUtils, TSESLint, TSESTree } from '@typescript-eslint/utils';
import type {
  CodepolPluginRule,
  LintProvider,
  LintProviderContext,
  EslintProviderConfig,
  LoggerConfig,
  PolicyFile,
  PolicyRuleTargetContext,
} from '@codepol/core';
import {
  policyCacheClear,
  policyRuleTargetsResolve,
  globPatternsGetMatchAny,
  ruleTargetMatchesLanguage,
  pluginRuleNew,
  configGetSync,
  configGetFromPathSync,
} from '@codepol/core';
import { loggerTreeCheckProvider } from './policyPluginLogger';
import { unusedExportsRule } from './unusedExportsRule';
import { unusedExportsCheck } from './unusedExportsCheck';

// Re-export cache clear for backwards compatibility
export { policyCacheClear };

// Re-export the unused exports rule and check function
export { unusedExportsRule };
export { unusedExportsCheck };

/**
 * Rule options for require-logger-enter-exit.
 */
type Options = [
  {
    /** Path to the config file (auto-discovered if not specified) */
    configPath?: string;
    /** Resolved rule targets passed from the CLI */
    ruleTargets?: PolicyRuleTargetContext[];
    /** Global exclude patterns from the policy */
    policyExclude?: string[];
    /** Logger configuration */
    logger?: LoggerConfig;
  }?
];

const RULE_URL =
  'https://github.com/fruitiecutiepie/codepol/blob/master/docs/rules/require-logger-enter-exit.md';

const createRule = ESLintUtils.RuleCreator(() => RULE_URL);

const loggerRuleId = 'require-logger-enter-exit';

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

function policyFileGetMatch(
  ruleTargets: PolicyRuleTargetContext[],
  policyExclude: string[],
  filePath: string,
  cwd?: string,
): PolicyRuleTargetContext | undefined {
  const relative = path.relative(cwd ?? process.cwd(), filePath);
  if (globPatternsGetMatchAny(policyExclude, relative)) {
    return undefined;
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
  return undefined;
}

// ... logger AST helpers (same as before) ...
function loggerIsMemberExpression(
  node: TSESTree.Expression,
  logger: LoggerConfig,
  method: string
): boolean {
  if (node.type === TSESTree.AST_NODE_TYPES.MemberExpression && !node.computed) {
    const object = node.object;
    const property = node.property;
    if (
      object.type === TSESTree.AST_NODE_TYPES.Identifier &&
      object.name === logger.identifier &&
      property.type === TSESTree.AST_NODE_TYPES.Identifier &&
      property.name === method
    ) {
      return true;
    }
  }
  return false;
}

function loggerHasEnter(block: TSESTree.BlockStatement, logger: LoggerConfig): boolean {
  for (const statement of block.body) {
    if (statement.type === TSESTree.AST_NODE_TYPES.ExpressionStatement) {
      const expression = statement.expression;
      if (
        expression.type === TSESTree.AST_NODE_TYPES.CallExpression &&
        loggerIsMemberExpression(expression.callee, logger, logger.enterMethod)
      ) {
        return true;
      }
    }
    if (statement.type !== TSESTree.AST_NODE_TYPES.EmptyStatement) {
      break;
    }
  }
  return false;
}

function loggerExitHas(block: TSESTree.BlockStatement, logger: LoggerConfig): boolean {
  const tryStatement = block.body.find(
    statement => statement.type === TSESTree.AST_NODE_TYPES.TryStatement
  ) as TSESTree.TryStatement | undefined;
  if (!tryStatement || !tryStatement.finalizer) {
    return false;
  }
  for (const statement of tryStatement.finalizer.body) {
    if (statement.type === TSESTree.AST_NODE_TYPES.ExpressionStatement) {
      const expression = statement.expression;
      if (
        expression.type === TSESTree.AST_NODE_TYPES.CallExpression &&
        loggerIsMemberExpression(expression.callee, logger, logger.exitMethod)
      ) {
        return true;
      }
    }
  }
  return false;
}

function loggerHasImport(sourceCode: TSESLint.SourceCode, logger: LoggerConfig): boolean {
  for (const statement of sourceCode.ast.body) {
    if (statement.type === TSESTree.AST_NODE_TYPES.ImportDeclaration) {
      if (statement.source.value === logger.import.module) {
        for (const specifier of statement.specifiers) {
          if (
            specifier.type === TSESTree.AST_NODE_TYPES.ImportSpecifier &&
            specifier.imported.type === TSESTree.AST_NODE_TYPES.Identifier &&
            specifier.imported.name === logger.import.named &&
            specifier.local.type === TSESTree.AST_NODE_TYPES.Identifier &&
            specifier.local.name === logger.identifier
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function replacementGetForBlock(
  sourceCode: TSESLint.SourceCode,
  block: TSESTree.BlockStatement,
  logger: LoggerConfig
): string {
  const innerText = sourceCode.text.slice(block.range[0] + 1, block.range[1] - 1);
  const trimmed = innerText.trim();
  const lines = trimmed ? trimmed.split('\n') : [];
  const indented = lines
    .map(line => `    ${line.trimStart()}`)
    .join('\n');
  const tryBody = indented ? `${indented}\n` : '';
  const segments = [
    '{',
    `  ${logger.identifier}.${logger.enterMethod}();`,
    '  try {',
  ];
  if (tryBody) {
    segments.push(tryBody.trimEnd());
  }
  segments.push('  } finally {');
  segments.push(`    ${logger.identifier}.${logger.exitMethod}();`);
  segments.push('  }');
  segments.push('}');
  return segments.join('\n');
}

function replacementGetForArrow(
  sourceCode: TSESLint.SourceCode,
  node: TSESTree.ArrowFunctionExpression,
  logger: LoggerConfig
): string {
  if (node.body.type === TSESTree.AST_NODE_TYPES.BlockStatement) {
    return replacementGetForBlock(sourceCode, node.body, logger);
  }
  const expressionText = sourceCode.getText(node.body);
  const segments = [
    '{',
    `  ${logger.identifier}.${logger.enterMethod}();`,
    '  try {',
    `    return ${expressionText};`,
    '  } finally {',
    `    ${logger.identifier}.${logger.exitMethod}();`,
    '  }',
    '}',
  ];
  return segments.join('\n');
}

type MessageIds = 'missingLogger';

type RuleContext = Readonly<TSESLint.RuleContext<MessageIds, Options>>;

function reportMissing(
  context: RuleContext,
  sourceCode: TSESLint.SourceCode,
  logger: LoggerConfig,
  node: TSESTree.Node,
  block: TSESTree.BlockStatement | undefined
): void {
  context.report({
    node,
    messageId: 'missingLogger',
    data: {
      enter: `${logger.identifier}.${logger.enterMethod}`,
      exit: `${logger.identifier}.${logger.exitMethod}`,
    },
    fix: fixer => {
      const fixes: TSESLint.RuleFix[] = [];
      if (node.type === TSESTree.AST_NODE_TYPES.ArrowFunctionExpression) {
        const replacement = replacementGetForArrow(sourceCode, node, logger);
        fixes.push(fixer.replaceText(node.body, replacement));
      } else if (block) {
        const replacement = replacementGetForBlock(sourceCode, block, logger);
        fixes.push(fixer.replaceText(block, replacement));
      }

      if (!loggerHasImport(sourceCode, logger)) {
        const importBinding =
          logger.import.named === logger.identifier
            ? logger.import.named
            : `${logger.import.named} as ${logger.identifier}`;
        const importStatement = `import { ${importBinding} } from '${logger.import.module}';\n`;
        const firstNode = sourceCode.ast.body[0];
        if (firstNode) {
          fixes.push(fixer.insertTextBefore(firstNode, importStatement));
        } else {
          fixes.push(fixer.insertTextBeforeRange([0, 0], importStatement));
        }
      }

      return fixes;
    },
  });
}

function checkBlock(
  context: RuleContext,
  sourceCode: TSESLint.SourceCode,
  logger: LoggerConfig,
  node: TSESTree.Node,
  block: TSESTree.BlockStatement | undefined
): void {
  if (!block) {
    reportMissing(context, sourceCode, logger, node, undefined);
    return;
  }
  const hasEnter = loggerHasEnter(block, logger);
  const hasExit = loggerExitHas(block, logger);
  if (!hasEnter || !hasExit) {
    reportMissing(context, sourceCode, logger, node, block);
  }
}

/**
 * ESLint rule that enforces logger.enter/exit instrumentation on all functions.
 */
const requireLoggerRule = createRule<Options, MessageIds>({
  name: 'require-logger-enter-exit',
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Ensure functions call logger.enter and logger.exit via try/finally',
    },
    hasSuggestions: true,
    fixable: 'code',
    messages: {
      missingLogger: 'Functions must invoke {{enter}} and {{exit}} within a try/finally block.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          configPath: {
            type: 'string',
            description: 'Path to the config file (auto-discovered if not specified)',
          },
          ruleTargets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ruleId: { type: 'string' },
                description: { type: 'string' },
                args: { type: 'object' },
                target: {
                  type: 'object',
                  properties: {
                    language: { type: 'string' },
                    parser: { type: 'string' },
                    files: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    exclude: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
          },
          policyExclude: {
            type: 'array',
            items: { type: 'string' },
          },
          logger: {
            type: 'object',
            properties: {
              identifier: { type: 'string' },
              enterMethod: { type: 'string' },
              exitMethod: { type: 'string' },
              import: {
                type: 'object',
                properties: {
                  module: { type: 'string' },
                  named: { type: 'string' },
                },
                required: ['module', 'named'],
              },
            },
            required: ['identifier', 'enterMethod', 'exitMethod', 'import'],
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
    let option: NonNullable<Options[0]> = {};
    if (context.options[0] !== undefined) {
      option = context.options[0];
    }
    // When ruleTargets and logger are both provided explicitly,
    // config loading is optional (enables standalone / test usage).
    const hasExplicitContext = option.ruleTargets !== undefined && option.logger !== undefined;

    // Config loading: explicit path > auto-discover
    // Uses sync loading since ESLint's create() must be synchronous
    let loadedConfig: PolicyFile | undefined;
    try {
      if (option.configPath) {
        const result = configGetFromPathSync(option.configPath);
        loadedConfig = result.config;
      } else {
        const result = configGetSync(process.cwd());
        loadedConfig = result.config;
      }
    } catch {
      // No config found — only fatal if we need config to resolve targets/logger
      if (!hasExplicitContext) {
        return {};
      }
    }
    
    let policyExclude: string[] = [];
    let ruleTargets: PolicyRuleTargetContext[] = [];
    if (option.ruleTargets !== undefined) {
      ruleTargets = option.ruleTargets;
      if (option.policyExclude !== undefined) {
        policyExclude = option.policyExclude;
      }
    }
    const policyFile: PolicyFile | undefined = loadedConfig;
    if (ruleTargets.length === 0) {
      if (!policyFile) {
        return {};
      }
      policyExclude = policyFile.exclude ?? [];
      ruleTargets = policyRuleTargetsGet(policyFile);
    }
    
    // Filter ruleTargets that are relevant to this plugin rule.
    // Two matching strategies:
    //   1. Direct ruleId match (handles pre-resolved targets from explicit options / tests)
    //   2. Policy lookup (handles user-defined IDs that map to this plugin via policyFile.rules)
    const relevantRuleTargets = ruleTargets.filter(rt => {
      // Direct match: ruleId is already the plugin rule ID (short or namespaced)
      if (rt.ruleId === loggerRuleId || rt.ruleId.endsWith(`/${loggerRuleId}`)) {
        return true;
      }
      // Policy lookup: ruleId is a user-defined ID; resolve via policyFile.rules
      const policyRule = policyFile?.rules.find(r => (r.id || r.ruleId) === rt.ruleId);
      if (!policyRule) return false;
      const policyRuleId = policyRule.ruleId;
      return policyRuleId === loggerRuleId || policyRuleId.endsWith(`/${loggerRuleId}`);
    });

    const matchedTarget = policyFileGetMatch(relevantRuleTargets, policyExclude, filename, context.cwd);
    if (!matchedTarget) {
      return {};
    }

    // Fallback to policy args if not provided via ESLint options
    const argsFromPolicy = matchedTarget.args as { logger?: LoggerConfig } | undefined;
    const logger = option.logger ?? argsFromPolicy?.logger;
    if (!logger) {
      console.error('Logger configuration missing. Configure @codepol/plugin with rule args.logger in codepol.config.ts or ESLint options.');
      return {};
    }
    
    const sourceCode = context.sourceCode;

    return {
      FunctionDeclaration(node) {
        let body: TSESTree.BlockStatement | undefined = undefined;
        if (node.body !== undefined) {
          body = node.body;
        }
        checkBlock(context, sourceCode, logger, node, body);
      },
      FunctionExpression(node) {
        // Skip when parent is MethodDefinition — already handled by MethodDefinition visitor
        if (node.parent?.type === TSESTree.AST_NODE_TYPES.MethodDefinition) return;
        let body: TSESTree.BlockStatement | undefined = undefined;
        if (node.body !== undefined) {
          body = node.body;
        }
        checkBlock(context, sourceCode, logger, node, body);
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === TSESTree.AST_NODE_TYPES.BlockStatement) {
          checkBlock(context, sourceCode, logger, node, node.body);
        } else {
          reportMissing(context, sourceCode, logger, node, undefined);
        }
      },
      MethodDefinition(node) {
        if (node.value && node.value.type === TSESTree.AST_NODE_TYPES.FunctionExpression) {
          let body: TSESTree.BlockStatement | undefined = undefined;
          if (node.value.body !== undefined) {
            body = node.value.body;
          }
          checkBlock(context, sourceCode, logger, node.value, body);
        }
      },
    };
  },
});

const eslintRules = {
  'require-logger-enter-exit': requireLoggerRule,
};

const eslintProviderConfig: EslintProviderConfig = {
  rules: eslintRules,
  ruleOptions: (ctx: LintProviderContext) => {
    const ruleArgs =
      ctx.ruleArgs && typeof ctx.ruleArgs === 'object' ? ctx.ruleArgs : {};
    return {
      configPath: ctx.configPath,  // Pass config path to rule options
      ruleTargets: ctx.ruleTargets,
      policyExclude: ctx.policy.exclude,
      ...(ruleArgs as Record<string, unknown>),
    };
  },
};

export const loggerLintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintProviderConfig,
};

export const loggerEnterExitRule: CodepolPluginRule = pluginRuleNew({
  id: loggerRuleId,
  capabilities: {
    lintProviders: [loggerLintProvider],
    treeCheckProvider: loggerTreeCheckProvider,
  },
});

export default [loggerEnterExitRule, unusedExportsRule];
