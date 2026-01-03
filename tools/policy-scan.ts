import fs from 'fs';
import path from 'path';
import Parser from 'tree-sitter';
import TreeSitterTS from 'tree-sitter-typescript';
import fg from 'fast-glob';

export interface LoggerImportConfig {
  module: string;
  named: string;
}

export interface LoggerConfig {
  identifier: string;
  enterMethod: string;
  exitMethod: string;
  import: LoggerImportConfig;
}

export interface PolicyRule {
  id: string;
  description: string;
  language: 'typescript' | 'tsx';
  files: string[];
  exclude?: string[];
}

export interface PolicyFile {
  $schema?: string;
  rules: PolicyRule[];
  exclude?: string[];
  logger: LoggerConfig;
}

export interface PolicyViolation {
  ruleId: string;
  filePath: string;
  message: string;
  line: number;
  column: number;
}

const blockNodeTypes = new Set(['statement_block', 'block', 'function_body']);

export function loadPolicy(policyPath: string): PolicyFile {
  const absolutePath = path.resolve(policyPath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw) as PolicyFile;
}

interface RuleMatch {
  rule: PolicyRule;
  files: string[];
}

export async function collectRuleMatches(policy: PolicyFile, cwd: string): Promise<RuleMatch[]> {
  const matches: RuleMatch[] = [];
  const globalExclude = policy.exclude ?? [];
  for (const rule of policy.rules) {
    const ignore = [...globalExclude, ...(rule.exclude ?? [])];
    const files = await fg(rule.files, {
      cwd,
      absolute: true,
      ignore,
      onlyFiles: true,
    });
    const filtered = files.filter(file => {
      if (rule.language === 'tsx') {
        return file.endsWith('.tsx');
      }
      return file.endsWith('.ts') || file.endsWith('.tsx');
    });
    matches.push({ rule, files: filtered });
  }
  return matches;
}

function getParserForFile(filePath: string): Parser {
  const parser = new Parser();
  if (filePath.endsWith('.tsx')) {
    parser.setLanguage(TreeSitterTS.tsx);
  } else {
    parser.setLanguage(TreeSitterTS.typescript);
  }
  return parser;
}

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

function findLoggerEnterStatement(source: string, block: Parser.SyntaxNode, loggerId: string, method: string): boolean {
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

function hasLoggerExitInFinally(source: string, tryNode: Parser.SyntaxNode, loggerId: string, method: string): boolean {
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

function analyseFunction(source: string, node: Parser.SyntaxNode, logger: LoggerConfig): FunctionAnalysisResult {
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

export function scanFileForViolations(filePath: string, rule: PolicyRule, logger: LoggerConfig): PolicyViolation[] {
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
