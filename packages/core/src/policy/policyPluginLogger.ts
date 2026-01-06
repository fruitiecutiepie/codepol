import type { SyntaxNode } from 'web-tree-sitter';
import type { LoggerConfig, PolicyPlugin, PolicyRule, PolicyScanContext, PolicyViolation } from './policyTypes';
import { parserInit, parserGetForFile } from '../parser/parserInit';
import { isErr } from '../result/result';

const blockNodeTypes = new Set(['statement_block', 'block', 'function_body']);

/**
 * Extracts the function name from a syntax node.
 */
function functionNameGet(nodeValue: SyntaxNode): string {
  const nameNodeValue = nodeValue.childForFieldName('name');
  if (nameNodeValue) {
    return nameNodeValue.text;
  }
  const parentValue = nodeValue.parent;
  if (parentValue && parentValue.type === 'method_definition') {
    const methodNameValue = parentValue.childForFieldName('name');
    if (methodNameValue) {
      return methodNameValue.text;
    }
  }
  return '<anonymous>';
}

/**
 * Checks if a node is a call expression matching logger.method().
 */
function loggerIsCallExpr(
  sourceValue: string,
  nodeValue: SyntaxNode,
  loggerIdValue: string,
  methodValue: string
): boolean {
  if (nodeValue.type !== 'call_expression' && nodeValue.type !== 'call_expression_v2') {
    return false;
  }
  const startValue = nodeValue.child(0);
  if (!startValue) {
    return false;
  }
  const calleeTextValue = sourceValue.slice(startValue.startIndex, startValue.endIndex).replace(/\s+/g, '');
  return calleeTextValue === `${loggerIdValue}.${methodValue}`;
}

/**
 * Checks if the first statement in a block is a logger.enter() call.
 */
function loggerFindEnterStatement(
  sourceValue: string,
  blockValue: SyntaxNode,
  loggerIdValue: string,
  methodValue: string
): boolean {
  for (const childValue of blockValue.namedChildren) {
    if (childValue.type === 'expression_statement') {
      const expressionValue = childValue.namedChildren[0];
      if (expressionValue && loggerIsCallExpr(sourceValue, expressionValue, loggerIdValue, methodValue)) {
        return true;
      }
    }
    if (childValue.type !== 'comment') {
      break;
    }
  }
  return false;
}

/**
 * Checks if a try statement's finally block contains a logger.exit() call.
 */
function loggerHasExitInFinally(
  sourceValue: string,
  tryNodeValue: SyntaxNode,
  loggerIdValue: string,
  methodValue: string
): boolean {
  const finalizerValue = tryNodeValue.childForFieldName('finalizer');
  if (!finalizerValue) {
    return false;
  }
  const blockValue = finalizerValue.namedChildren.find(childValue => blockNodeTypes.has(childValue.type));
  if (!blockValue) {
    return false;
  }
  for (const statementValue of blockValue.namedChildren) {
    if (statementValue.type === 'expression_statement') {
      const expressionValue = statementValue.namedChildren[0];
      if (expressionValue && loggerIsCallExpr(sourceValue, expressionValue, loggerIdValue, methodValue)) {
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
  blockValue: SyntaxNode
): SyntaxNode | undefined {
  for (const childValue of blockValue.namedChildren) {
    if (childValue.type === 'try_statement') {
      return childValue;
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
  sourceValue: string,
  nodeValue: SyntaxNode,
  loggerValue: LoggerConfig
): FunctionAnalysisResult {
  const bodyValue = nodeValue.childForFieldName('body');
  if (!bodyValue) {
    return { enterPresent: false, exitPresent: false };
  }

  if (!blockNodeTypes.has(bodyValue.type)) {
    return { enterPresent: false, exitPresent: false };
  }

  const hasEnterValue = loggerFindEnterStatement(sourceValue, bodyValue, loggerValue.identifier, loggerValue.enterMethod);
  const tryNodeValue = trySurroundingFind(bodyValue);
  const hasExitValue = tryNodeValue
    ? loggerHasExitInFinally(sourceValue, tryNodeValue, loggerValue.identifier, loggerValue.exitMethod)
    : false;

  return { enterPresent: hasEnterValue, exitPresent: hasExitValue };
}

/**
 * Recursively visits all function nodes in a syntax tree.
 */
function functionsVisit(
  nodeValue: SyntaxNode,
  visitorValue: (fnNodeValue: SyntaxNode) => void
): void {
  if (
    nodeValue.type === 'function_declaration' ||
    nodeValue.type === 'function_expression' ||
    nodeValue.type === 'arrow_function' ||
    nodeValue.type === 'method_definition'
  ) {
    visitorValue(nodeValue);
  }
  for (const childValue of nodeValue.namedChildren) {
    functionsVisit(childValue, visitorValue);
  }
}

function loggerRuleScan(
  ruleValue: PolicyRule,
  contextValue: PolicyScanContext
): PolicyViolation[] {
  const parserResult = parserGetForFile(contextValue.filePath);
  if (isErr(parserResult)) {
    return []; // Error already logged in parserGetForFile
  }
  const parserValue = parserResult.Ok;
  const treeValue = parserValue.parse(contextValue.source);
  const violationsValue: PolicyViolation[] = [];
  const loggerValue = contextValue.policy.logger;

  functionsVisit(treeValue.rootNode, fnNodeValue => {
    const { enterPresent, exitPresent } = functionAnalysisGet(contextValue.source, fnNodeValue, loggerValue);
    if (!enterPresent || !exitPresent) {
      const nameValue = functionNameGet(fnNodeValue);
      const missingValue: string[] = [];
      if (!enterPresent) {
        missingValue.push(`${loggerValue.identifier}.${loggerValue.enterMethod}`);
      }
      if (!exitPresent) {
        missingValue.push(`${loggerValue.identifier}.${loggerValue.exitMethod}`);
      }
      const firstMissingValue = missingValue.join(' & ');
      const { row: rowValue, column: columnValue } = fnNodeValue.startPosition;
      violationsValue.push({
        ruleId: ruleValue.id,
        filePath: contextValue.filePath,
        message: `Function ${nameValue} is missing ${firstMissingValue}`,
        line: rowValue + 1,
        column: columnValue + 1,
      });
    }
  });

  return violationsValue;
}

export const policyPluginLogger: PolicyPlugin = {
  id: 'logger',
  version: '1.0.0',
  languages: ['typescript', 'tsx'],
  init: parserInit,
  scan: loggerRuleScan,
};
