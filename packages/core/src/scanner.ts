import fs from 'fs';
import path from 'path';
import Parser, { Language, SyntaxNode } from 'web-tree-sitter';
import type { LoggerConfig, PolicyFile, PolicyRule, PolicyViolation } from './types';
import { collectRuleMatches } from './policy-loader';

const blockNodeTypes = new Set(['statement_block', 'block', 'function_body']);

let typescriptLanguage: Language | null = null;
let tsxLanguage: Language | null = null;

let parserInitialized = false;

/**
 * Resolves the path to a WASM grammar file.
 * Looks in the wasm directory relative to this package.
 */
function getWasmPath(grammarName: string): string {
  return path.resolve(__dirname, '..', 'wasm', `${grammarName}.wasm`);
}

/**
 * Initializes the web-tree-sitter parser and loads language grammars.
 * Must be called before any scanning operations.
 *
 * @example
 * ```typescript
 * import { initParser, scanWithPolicy } from '@codepol/core';
 *
 * await initParser();
 * const violations = await scanWithPolicy(policy, cwd);
 * ```
 */
export async function initParser(): Promise<void> {
  if (parserInitialized) {
    return;
  }

  await Parser.init();

  const [tsLang, tsxLang] = await Promise.all([
    Parser.Language.load(getWasmPath('tree-sitter-typescript')),
    Parser.Language.load(getWasmPath('tree-sitter-tsx')),
  ]);

  typescriptLanguage = tsLang;
  tsxLanguage = tsxLang;
  parserInitialized = true;
}

/**
 * Checks if the parser has been initialized.
 */
export function isParserInitialized(): boolean {
  return parserInitialized;
}

/**
 * Throws if the parser has not been initialized.
 */
function ensureInitialized(): void {
  if (!parserInitialized) {
    throw new Error(
      'Parser not initialized. Call initParser() before scanning files.'
    );
  }
}

/**
 * Creates a Tree-sitter parser configured for the given file type.
 *
 * @param filePath - Path to the file (used to determine .ts vs .tsx)
 * @returns Configured Parser instance
 */
function getParserForFile(filePath: string): Parser {
  ensureInitialized();
  const parser = new Parser();
  if (filePath.endsWith('.tsx')) {
    parser.setLanguage(tsxLanguage);
  } else {
    parser.setLanguage(typescriptLanguage);
  }
  return parser;
}

/**
 * Extracts the function name from a syntax node.
 *
 * @param node - The function/method syntax node
 * @returns The function name or '<anonymous>' if not found
 */
function getFunctionName(node: SyntaxNode): string {
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
function isLoggerCall(
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
function findLoggerEnterStatement(
  source: string,
  block: SyntaxNode,
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
function findSurroundingTry(
  block: SyntaxNode
): SyntaxNode | undefined {
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

  const hasEnter = findLoggerEnterStatement(source, body, logger.identifier, logger.enterMethod);
  const tryNode = findSurroundingTry(body);
  const hasExit = tryNode ? hasLoggerExitInFinally(source, tryNode, logger.identifier, logger.exitMethod) : false;

  return { enterPresent: hasEnter, exitPresent: hasExit };
}

/**
 * Recursively visits all function nodes in a syntax tree.
 */
function visitFunctions(
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
    visitFunctions(child, visitor);
  }
}

function resolveLoggerConfig(policy: PolicyFile): LoggerConfig | undefined {
  return policy.pluginConfig?.logger as LoggerConfig | undefined;
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
 * import { initParser, scanFileForViolations } from '@codepol/core';
 *
 * await initParser();
 * const violations = scanFileForViolations(
 *   '/path/to/file.ts',
 *   rule,
 *   policy.pluginConfig?.logger
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
 * import { initParser, loadPolicy, scanWithPolicy } from '@codepol/core';
 *
 * await initParser();
 * const policy = loadPolicy('./policy.json');
 * const violations = await scanWithPolicy(policy, process.cwd());
 *
 * for (const v of violations) {
 *   console.log(`${v.filePath}:${v.line} - ${v.message}`);
 * }
 * ```
 */
export async function scanWithPolicy(policy: PolicyFile, cwd: string): Promise<PolicyViolation[]> {
  ensureInitialized();
  const matches = await collectRuleMatches(policy, cwd);
  const allViolations: PolicyViolation[] = [];
  const loggerConfig = resolveLoggerConfig(policy);
  for (const match of matches) {
    if (match.rule.type !== 'logger') {
      continue;
    }
    if (!loggerConfig) {
      throw new Error('Logger plugin configuration is required for logger rules.');
    }
    for (const file of match.files) {
      const fileViolations = scanFileForViolations(file, match.rule, loggerConfig);
      allViolations.push(...fileViolations);
    }
  }
  return allViolations;
}
