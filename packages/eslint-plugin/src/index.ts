/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint plugin for enforcing logger instrumentation.
 *
 * This plugin provides a rule that ensures all functions have proper
 * logger.enter() and logger.exit() calls wrapped in a try/finally block.
 *
 * @example ESLint flat config (eslint.config.js)
 * ```javascript
 * import codepolPlugin from '@codepol/eslint-plugin';
 *
 * export default [
 *   {
 *     plugins: {
 *       codepol: codepolPlugin,
 *     },
 *     rules: {
 *       'codepol/require-logger-enter-exit': ['error', {
 *         policyPath: './policy.json'
 *       }],
 *     },
 *   },
 * ];
 * ```
 */

import fs from 'fs';
import path from 'path';
import { ESLintUtils, TSESLint, TSESTree } from '@typescript-eslint/utils';
import { minimatch } from 'minimatch';
import type { LoggerConfig, PolicyFile } from '@codepol/core';

/**
 * Rule options for require-logger-enter-exit.
 */
type Options = [
  {
    /** Path to the policy.json file */
    policyPath?: string;
  }?
];

const RULE_URL = 'https://github.com/fruitiecutiepie/codepol/blob/master/docs/rules/require-logger-enter-exit.md';

const createRule = ESLintUtils.RuleCreator(() => RULE_URL);

const policyCache = new Map<string, PolicyFile>();

/**
 * Loads a policy file with caching.
 */
function loadPolicy(policyPath: string): PolicyFile {
  const resolved = path.resolve(policyPath);
  const cached = policyCache.get(resolved);
  if (cached) {
    return cached;
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw) as PolicyFile;
  policyCache.set(resolved, parsed);
  return parsed;
}

/**
 * Clears the policy cache. Useful for testing.
 */
export function clearPolicyCache(): void {
  policyCache.clear();
}

function matchesAny(patterns: string[] | undefined, relativeFile: string): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  return patterns.some(pattern => minimatch(relativeFile, pattern, { dot: true }));
}

function isFileCovered(policy: PolicyFile, filePath: string): boolean {
  const relative = path.relative(process.cwd(), filePath);
  if (matchesAny(policy.exclude, relative)) {
    return false;
  }
  for (const rule of policy.rules) {
    if (matchesAny(rule.files, relative)) {
      if (matchesAny(rule.exclude, relative)) {
        continue;
      }
      const isTs = relative.endsWith('.ts') || relative.endsWith('.tsx');
      if (!isTs) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function isLoggerMemberExpression(
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

function hasLoggerEnter(block: TSESTree.BlockStatement, logger: LoggerConfig): boolean {
  for (const statement of block.body) {
    if (statement.type === TSESTree.AST_NODE_TYPES.ExpressionStatement) {
      const expression = statement.expression;
      if (
        expression.type === TSESTree.AST_NODE_TYPES.CallExpression &&
        isLoggerMemberExpression(expression.callee, logger, logger.enterMethod)
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

function hasLoggerExit(block: TSESTree.BlockStatement, logger: LoggerConfig): boolean {
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
        isLoggerMemberExpression(expression.callee, logger, logger.exitMethod)
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasLoggerImport(sourceCode: TSESLint.SourceCode, logger: LoggerConfig): boolean {
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

function buildBlockReplacement(
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

function buildArrowReplacement(
  sourceCode: TSESLint.SourceCode,
  node: TSESTree.ArrowFunctionExpression,
  logger: LoggerConfig
): string {
  if (node.body.type === TSESTree.AST_NODE_TYPES.BlockStatement) {
    return buildBlockReplacement(sourceCode, node.body, logger);
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
    '}'
  ];
  return segments.join('\n');
}

type MessageIds = 'missingLogger';

/**
 * ESLint rule that enforces logger.enter/exit instrumentation on all functions.
 *
 * This rule:
 * - Checks that every function has logger.enter() as the first statement
 * - Checks that function body is wrapped in try/finally with logger.exit() in finally
 * - Provides autofix to add the instrumentation
 * - Automatically adds the logger import if missing
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
    const option = context.options[0] ?? {};
    const policyPath = option.policyPath ?? path.resolve(process.cwd(), 'policy.json');
    const policy = loadPolicy(policyPath);
    if (!isFileCovered(policy, filename)) {
      return {};
    }
    const logger = policy.logger;
    const sourceCode = context.sourceCode;

    function reportMissing(node: TSESTree.Node, block: TSESTree.BlockStatement | null) {
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
            const replacement = buildArrowReplacement(sourceCode, node, logger);
            fixes.push(fixer.replaceText(node.body, replacement));
          } else if (block) {
            const replacement = buildBlockReplacement(sourceCode, block, logger);
            fixes.push(fixer.replaceText(block, replacement));
          }

          if (!hasLoggerImport(sourceCode, logger)) {
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

    function checkBlock(node: TSESTree.Node, block: TSESTree.BlockStatement | null) {
      if (!block) {
        reportMissing(node, null);
        return;
      }
      const hasEnter = hasLoggerEnter(block, logger);
      const hasExit = hasLoggerExit(block, logger);
      if (!hasEnter || !hasExit) {
        reportMissing(node, block);
      }
    }

    return {
      FunctionDeclaration(node) {
        checkBlock(node, node.body ?? null);
      },
      FunctionExpression(node) {
        checkBlock(node, node.body ?? null);
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === TSESTree.AST_NODE_TYPES.BlockStatement) {
          checkBlock(node, node.body);
        } else {
          reportMissing(node, null);
        }
      },
      MethodDefinition(node) {
        if (node.value && node.value.type === TSESTree.AST_NODE_TYPES.FunctionExpression) {
          checkBlock(node.value, node.value.body ?? null);
        }
      },
    };
  },
});

/**
 * The ESLint plugin object with all rules.
 */
const plugin = {
  rules: {
    'require-logger-enter-exit': requireLoggerRule,
  },
};

export default plugin;
export const rules = plugin.rules;
