/**
 * @packageDocumentation
 * @codepol/plugin - Logger plugin capabilities for codepol.
 *
 * Provides ESLint rule definitions plus tree-sitter check integration.
 */

import path from 'path';
import { ESLintUtils, TSESLint, TSESTree } from '@typescript-eslint/utils';
import type {
  CodepolRulePlugin,
  LintProvider,
  LintProviderContext,
  EslintProviderConfig,
  LoggerConfig,
  PolicyFile,
  PolicyRuleTargetContext,
} from '@codepol/core';
import {
  policyFileGet,
  policyCacheClear,
  globPatternsGetMatchAny,
  ruleTargetMatchesLanguage,
} from '@codepol/core';
import { loggerTreeCheckProvider } from './policyPluginLogger';

// Re-export cache clear for backwards compatibility
export { policyCacheClear };

/**
 * Rule options for require-logger-enter-exit.
 */
type Options = [
  {
    /** Path to the policy.json file */
    policyPath?: string;
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
    for (const target of rule.targets) {
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
  block: TSESTree.BlockStatement | null
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
  block: TSESTree.BlockStatement | null
): void {
  if (!block) {
    reportMissing(context, sourceCode, logger, node, null);
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
          policyPath: {
            type: 'string',
            description: 'Path to the policy.json file',
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
    if (context.options[0] != null) {
      option = context.options[0];
    }
    let policyPath = path.resolve(process.cwd(), 'policy.json');
    if (option.policyPath != null) {
      policyPath = option.policyPath;
    }
    let policyExclude: string[] = [];
    let ruleTargets: PolicyRuleTargetContext[] = [];
    if (option.ruleTargets != null) {
      ruleTargets = option.ruleTargets;
      if (option.policyExclude != null) {
        policyExclude = option.policyExclude;
      }
    }
    let policyFile: PolicyFile | null = null;
    if (ruleTargets.length === 0) {
      policyFile = policyFileGet(policyPath);
      policyExclude = policyFile.exclude ?? [];
      ruleTargets = policyRuleTargetsGet(policyFile);
    }
    
    // We only care about rule targets that map to THIS plugin rule.
    // In strict sense, we should filter by ruleId matching this plugin's ID (or what the policy says).
    // But here we rely on the policy saying "for this ruleId use this plugin".
    // For ESLint, we are inside a rule execution, so we are checking "is this file targeted by any rule that maps to ME?"
    // However, ESLint config (eslintProviderConfig) already filters ruleTargets per rule? 
    // No, it passes ctx.ruleTargets which contains ALL rules.
    // We should filter targets where the rule definition points to this plugin rule.
    // BUT, we don't have the rule definition (PolicyRule) here easily to know which one maps to us, unless we look at policy.rules.
    // Wait, context.options contains ruleTargets which has { ruleId, target }.
    // We also need to know which policy rules map to this ESLint rule.
    // The policy.json says: rule "function-logging" -> ruleId "@codepol/plugin/require-logger-enter-exit".
    // So we should filter ruleTargets where rule.ruleId == loggerRuleId.
    // BUT `PolicyRuleTargetContext` doesn't have `ruleIdPlugin`.
    // We need to look it up in `policyFile`.
    
    if (policyFile == null) {
      policyFile = policyFileGet(policyPath);
    }
    
    // Filter ruleTargets that are relevant to this plugin rule
    // Support both short IDs (e.g., "require-logger-enter-exit") and
    // namespaced IDs (e.g., "@codepol/plugin/require-logger-enter-exit")
    const relevantRuleTargets = ruleTargets.filter(rt => {
      // Find the rule in the policy
      const policyRule = policyFile!.rules.find(r => (r.id || r.ruleId) === rt.ruleId);
      if (!policyRule) return false;
      const policyRuleId = policyRule.ruleId;
      // Match if exact or if namespaced version ends with our short ID
      return policyRuleId === loggerRuleId || policyRuleId.endsWith(`/${loggerRuleId}`);
    });

    const matchedTarget = policyFileGetMatch(relevantRuleTargets, policyExclude, filename);
    if (!matchedTarget) {
      return {};
    }

    // Fallback to policy args if not provided via ESLint options
    const argsFromPolicy = matchedTarget.args as { logger?: LoggerConfig } | undefined;
    const logger = option.logger ?? argsFromPolicy?.logger;
    if (!logger) {
      console.error('Logger configuration missing. Configure @codepol/plugin with rule args.logger in policy.json or ESLint options.');
      return {};
    }
    
    const sourceCode = context.sourceCode;

    return {
      FunctionDeclaration(node) {
        let body: TSESTree.BlockStatement | null = null;
        if (node.body != null) {
          body = node.body;
        }
        checkBlock(context, sourceCode, logger, node, body);
      },
      FunctionExpression(node) {
        let body: TSESTree.BlockStatement | null = null;
        if (node.body != null) {
          body = node.body;
        }
        checkBlock(context, sourceCode, logger, node, body);
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === TSESTree.AST_NODE_TYPES.BlockStatement) {
          checkBlock(context, sourceCode, logger, node, node.body);
        } else {
          reportMissing(context, sourceCode, logger, node, null);
        }
      },
      MethodDefinition(node) {
        if (node.value && node.value.type === TSESTree.AST_NODE_TYPES.FunctionExpression) {
          let body: TSESTree.BlockStatement | null = null;
          if (node.value.body != null) {
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
  pluginName: 'codepol',
  rules: eslintRules,
  rulesConfigGet: (ctx: LintProviderContext) => {
    const ruleArgs =
      ctx.ruleArgs && typeof ctx.ruleArgs === 'object' ? ctx.ruleArgs : {};
    return {
      'codepol/require-logger-enter-exit': [
        'error',
        {
          policyPath: ctx.policyPath,
          ruleTargets: ctx.ruleTargets,
          policyExclude: ctx.policy.exclude,
          ...(ruleArgs as Record<string, unknown>),
        },
      ],
    };
  },
};

export const loggerLintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintProviderConfig,
};

export const loggerEnterExitRule: CodepolRulePlugin = {
  id: loggerRuleId,
  capabilities: {
    lintProviders: [loggerLintProvider],
    treeCheckProvider: loggerTreeCheckProvider,
  },
};

export default [loggerEnterExitRule];
