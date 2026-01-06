import type { SyntaxNode } from 'web-tree-sitter';
import type { LoggerConfig, PolicyPlugin, PolicyRule, PolicyScanContext, PolicyViolation } from './policyTypes';
import { parserInit, parserGetForFile } from '../parser/parserInit';
import { isErr } from '../result/result';

const blockNodeTypes = new Set(['statement_block', 'block', 'function_body']);

/**
 * Extracts the function name from a syntax node.
 */
function functionNameGet(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name');
  if (nameNode) {
    return nameNode.text;
  }
  const parent = node.parent;
  if (parent && parent.type === 'method_definition') {
    const methodName = parent.childForFieldName('name');
    if (methodName) {
      return methodName.text;
    }
  }
  return '<anonymous>';
}

/**
 * Checks if a node is a call expression matching logger.method().
 */
function loggerIsCallExpr(
  source: string,
  node: SyntaxNode,
  loggerId: string,
  method: string
): boolean {
  if (node.type !== 'call_expression' && node.type !== 'call_expression_v2') {
    return false;
  }
  const start = node.child(0);
  if (!start) {
    return false;
  }
  const calleeText = source.slice(start.startIndex, start.endIndex).replace(/\s+/g, '');
  return calleeText === `${loggerId}.${method}`;
}

/**
 * Checks if the first statement in a block is a logger.enter() call.
 */
function loggerFindEnterStatement(
  source: string,
  block: SyntaxNode,
  loggerId: string,
  method: string
): boolean {
  for (const child of block.namedChildren) {
    if (child.type === 'expression_statement') {
      const expression = child.namedChildren[0];
      if (expression && loggerIsCallExpr(source, expression, loggerId, method)) {
        return true;
      }
    }
    if (child.type !== 'comment') {
      break;
    }
  }
  return false;
}

/**
 * Checks if a try statement's finally block contains a logger.exit() call.
 */
function loggerHasExitInFinally(
  source: string,
  tryNode: SyntaxNode,
  loggerId: string,
  method: string
): boolean {
  const finalizer = tryNode.childForFieldName('finalizer');
  if (!finalizer) {
    return false;
  }
  const block = finalizer.namedChildren.find(child => blockNodeTypes.has(child.type));
  if (!block) {
    return false;
  }
  for (const statement of block.namedChildren) {
    if (statement.type === 'expression_statement') {
      const expression = statement.namedChildren[0];
      if (expression && loggerIsCallExpr(source, expression, loggerId, method)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Finds a try_statement within a block.
 */
function trySurroundingFind(
  block: SyntaxNode
): SyntaxNode | undefined {
  for (const child of block.namedChildren) {
    if (child.type === 'try_statement') {
      return child;
    }
  }
  return undefined;
}

type FunctionAnalysisResult = {
  enterPresent: boolean;
  exitPresent: boolean;
};

/**
 * Analyzes a function node for proper logger instrumentation.
 */
function functionAnalysisGet(
  source: string,
  node: SyntaxNode,
  logger: LoggerConfig
): FunctionAnalysisResult {
  const body = node.childForFieldName('body');
  if (!body) {
    return { enterPresent: false, exitPresent: false };
  }

  if (!blockNodeTypes.has(body.type)) {
    return { enterPresent: false, exitPresent: false };
  }

  const hasEnter = loggerFindEnterStatement(source, body, logger.identifier, logger.enterMethod);
  const tryNode = trySurroundingFind(body);
  const hasExit = tryNode
    ? loggerHasExitInFinally(source, tryNode, logger.identifier, logger.exitMethod)
    : false;

  return { enterPresent: hasEnter, exitPresent: hasExit };
}

/**
 * Recursively visits all function nodes in a syntax tree.
 */
function functionsVisit(
  node: SyntaxNode,
  visitor: (fnNode: SyntaxNode) => void
): void {
  if (
    node.type === 'function_declaration' ||
    node.type === 'function_expression' ||
    node.type === 'arrow_function' ||
    node.type === 'method_definition'
  ) {
    visitor(node);
  }
  for (const child of node.namedChildren) {
    functionsVisit(child, visitor);
  }
}

function loggerRuleScan(
  rule: PolicyRule,
  context: PolicyScanContext
): PolicyViolation[] {
  const parserResult = parserGetForFile(context.filePath);
  if (isErr(parserResult)) {
    return []; // Error already logged in parserGetForFile
  }
  const parser = parserResult.Ok;
  const tree = parser.parse(context.source);
  const violations: PolicyViolation[] = [];
  const logger = context.policy.logger;

  functionsVisit(tree.rootNode, fnNode => {
    const { enterPresent, exitPresent } = functionAnalysisGet(context.source, fnNode, logger);
    if (!enterPresent || !exitPresent) {
      const name = functionNameGet(fnNode);
      const missing: string[] = [];
      if (!enterPresent) {
        missing.push(`${logger.identifier}.${logger.enterMethod}`);
      }
      if (!exitPresent) {
        missing.push(`${logger.identifier}.${logger.exitMethod}`);
      }
      const firstMissing = missing.join(' & ');
      const { row: row, column: column } = fnNode.startPosition;
      violations.push({
        ruleId: rule.id,
        filePath: context.filePath,
        message: `Function ${name} is missing ${firstMissing}`,
        line: row + 1,
        column: column + 1,
      });
    }
  });

  return violations;
}

export const policyPluginLogger: PolicyPlugin = {
  id: 'logger',
  version: '1.0.0',
  languages: ['typescript', 'tsx'],
  init: parserInit,
  scan: loggerRuleScan,
};

policyPluginLogger.capabilities = {
  treeScanProvider: policyPluginLogger,
};
