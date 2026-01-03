import fs from 'fs';
import Parser from 'tree-sitter';
import TreeSitterTS from 'tree-sitter-typescript';
import type { LoggerConfig, PolicyFile, PolicyRule, PolicyViolation } from './types';
import { collectRuleMatches } from './policy-loader';

const blockNodeTypes = new Set(['statement_block', 'block', 'function_body']);

/**
 * Creates a Tree-sitter parser configured for the given file type.
 *
 * @param filePath - Path to the file (used to determine .ts vs .tsx)
 * @returns Configured Parser instance
 */
function getParserForFile(filePath: string): Parser {
  const parser = new Parser();
  if (filePath.endsWith('.tsx')) {
    parser.setLanguage(TreeSitterTS.tsx);
  } else {
    parser.setLanguage(TreeSitterTS.typescript);
  }
  return parser;
}

/**
 * Extracts the function name from a syntax node.
 *
 * @param node - The function/method syntax node
 * @returns The function name or '<anonymous>' if not found
 */
function getFunctionName(node: Parser.SyntaxNode): string {
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
function isLoggerCall(source: string, node: Parser.SyntaxNode, loggerId: string, method: string): boolean {
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
function findLoggerEnterStatement(
  source: string,
  block: Parser.SyntaxNode,
  loggerId: string,
  method: string
): boolean {
  for (const child of block.namedChildren) {
    if (child.type === 'expression_statement') {
      const expression = child.namedChildren[0];
      if (expression && isLoggerCall(source, expression, loggerId, method)) {
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
function hasLoggerExitInFinally(
  source: string,
  tryNode: Parser.SyntaxNode,
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
  for (const stmt of block.namedChildren) {
    if (stmt.type === 'expression_statement') {
      const expression = stmt.namedChildren[0];
      if (expression && isLoggerCall(source, expression, loggerId, method)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Finds a try_statement within a block.
 */
function findSurroundingTry(block: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  for (const child of block.namedChildren) {
    if (child.type === 'try_statement') {
      return child;
    }
  }
  return undefined;
}

interface FunctionAnalysisResult {
  enterPresent: boolean;
  exitPresent: boolean;
}

/**
 * Analyzes a function node for proper logger instrumentation.
 */
function analyseFunction(
  source: string,
  node: Parser.SyntaxNode,
  logger: LoggerConfig
): FunctionAnalysisResult {
  const body = node.childForFieldName('body');
  if (!body) {
    return { enterPresent: false, exitPresent: false };
  }

  if (!blockNodeTypes.has(body.type)) {
    return { enterPresent: false, exitPresent: false };
  }

  const hasEnter = findLoggerEnterStatement(source, body, logger.identifier, logger.enterMethod);
  const tryNode = findSurroundingTry(body);
  const hasExit = tryNode ? hasLoggerExitInFinally(source, tryNode, logger.identifier, logger.exitMethod) : false;

  return { enterPresent: hasEnter, exitPresent: hasExit };
}

/**
 * Recursively visits all function nodes in a syntax tree.
 */
function visitFunctions(node: Parser.SyntaxNode, visitor: (fnNode: Parser.SyntaxNode) => void): void {
  if (
    node.type === 'function_declaration' ||
    node.type === 'function_expression' ||
    node.type === 'arrow_function' ||
    node.type === 'method_definition'
  ) {
    visitor(node);
  }
  for (const child of node.namedChildren) {
    visitFunctions(child, visitor);
  }
}

/**
 * Scans a single file for policy violations using Tree-sitter.
 *
 * @param filePath - Absolute path to the file to scan
 * @param rule - The policy rule being checked
 * @param logger - Logger configuration from the policy
 * @returns Array of violations found in the file
 *
 * @example
 * ```typescript
 * import { scanFileForViolations } from '@codepol/core';
 *
 * const violations = scanFileForViolations(
 *   '/path/to/file.ts',
 *   rule,
 *   policy.logger
 * );
 * ```
 */
export function scanFileForViolations(
  filePath: string,
  rule: PolicyRule,
  logger: LoggerConfig
): PolicyViolation[] {
  const parser = getParserForFile(filePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const tree = parser.parse(source);
  const violations: PolicyViolation[] = [];

  visitFunctions(tree.rootNode, fnNode => {
    const { enterPresent, exitPresent } = analyseFunction(source, fnNode, logger);
    if (!enterPresent || !exitPresent) {
      const name = getFunctionName(fnNode);
      const missing: string[] = [];
      if (!enterPresent) {
        missing.push(`${logger.identifier}.${logger.enterMethod}`);
      }
      if (!exitPresent) {
        missing.push(`${logger.identifier}.${logger.exitMethod}`);
      }
      const firstMissing = missing.join(' & ');
      const { row, column } = fnNode.startPosition;
      violations.push({
        ruleId: rule.id,
        filePath,
        message: `Function ${name} is missing ${firstMissing}`,
        line: row + 1,
        column: column + 1,
      });
    }
  });

  return violations;
}

/**
 * Scans all files matching the policy rules for violations.
 *
 * @param policy - The loaded policy file
 * @param cwd - Working directory to resolve file patterns from
 * @returns Array of all violations found across all files
 *
 * @example
 * ```typescript
 * import { loadPolicy, scanWithPolicy } from '@codepol/core';
 *
 * const policy = loadPolicy('./policy.json');
 * const violations = await scanWithPolicy(policy, process.cwd());
 *
 * for (const v of violations) {
 *   console.log(`${v.filePath}:${v.line} - ${v.message}`);
 * }
 * ```
 */
export async function scanWithPolicy(policy: PolicyFile, cwd: string): Promise<PolicyViolation[]> {
  const matches = await collectRuleMatches(policy, cwd);
  const allViolations: PolicyViolation[] = [];
  for (const match of matches) {
    for (const file of match.files) {
      const fileViolations = scanFileForViolations(file, match.rule, policy.logger);
      allViolations.push(...fileViolations);
    }
  }
  return allViolations;
}
