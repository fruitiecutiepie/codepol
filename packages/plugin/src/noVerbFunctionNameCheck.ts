import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
} from '@codepol/core';
import { parserGetForFile, isErr, parserParseDebug } from '@codepol/core';
import type { SyntaxNode } from 'web-tree-sitter';
import { parseJsTsSource } from './lib/jsTsTree';
import { identifierSplitByCasing } from './lib/identifierSplitByCasing';

type NoVerbFunctionNameArgs = {
  verbs: string[];
};

type FunctionMatch = {
  name: string;
  line: number;
  column: number;
};

function functionMatchAdd(
  matches: FunctionMatch[],
  nameNode: SyntaxNode | null | undefined,
): void {
  if (!nameNode) {
    return;
  }
  matches.push({
    name: nameNode.text,
    line: nameNode.startPosition.row + 1,
    column: nameNode.startPosition.column + 1,
  });
}

export function functionMatchesTsGet(
  source: string,
  filePath = 'temp.ts',
): FunctionMatch[] {
  const { root } = parseJsTsSource(filePath, source);
  const matches: FunctionMatch[] = [];

  function visit(node: SyntaxNode): void {
    if (
      (node.type === 'function_declaration' ||
        node.type === 'generator_function_declaration') &&
      node.childForFieldName('name')
    ) {
      functionMatchAdd(matches, node.childForFieldName('name'));
    }

    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const valueNode = node.childForFieldName('value');
      if (
        nameNode?.type === 'identifier' &&
        valueNode &&
        (valueNode.type === 'arrow_function' ||
          valueNode.type === 'function_expression' ||
          valueNode.type === 'generator_function')
      ) {
        functionMatchAdd(matches, nameNode);
      }
    }

    if (node.type === 'method_definition') {
      functionMatchAdd(matches, node.childForFieldName('name'));
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);
  return matches;
}

function isDunderName(name: string): boolean {
  return name.startsWith('__') && name.endsWith('__');
}

function functionDefinitionsVisit(
  node: SyntaxNode,
  visitor: (fnNode: SyntaxNode) => void
): void {
  if (node.type === 'function_definition') {
    visitor(node);
  }
  for (const child of node.namedChildren) {
    functionDefinitionsVisit(child, visitor);
  }
}

export function functionMatchesPyGet(source: string): FunctionMatch[] {
  const parserResult = parserGetForFile('temp.py');
  if (isErr(parserResult)) {
    throw new Error(`Python parser not available: ${parserResult.Err}`);
  }

  const parser = parserResult.Ok;
  const tree = parserParseDebug(parser, source, {
    filePath: 'temp.py',
    callSite: 'noVerbFunctionNameCheck.functionMatchesPyGet',
  });
  const matches: FunctionMatch[] = [];

  functionDefinitionsVisit(tree.rootNode, (fnNode) => {
    const nameNode = fnNode.childForFieldName('name');
    if (nameNode && !isDunderName(nameNode.text)) {
      matches.push({
        name: nameNode.text,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column + 1,
      });
    }
  });

  return matches;
}

export function functionMatchesGet(source: string, filePath: string = 'temp.ts'): FunctionMatch[] {
  if (filePath.endsWith('.py')) {
    return functionMatchesPyGet(source);
  }
  const tsFilePath = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/u.test(filePath)
    ? filePath
    : 'temp.ts';
  return functionMatchesTsGet(source, tsFilePath);
}

export function verbSetGet(args: NoVerbFunctionNameArgs | undefined): Set<string> {
  if (!args?.verbs || args.verbs.length === 0) {
    return new Set();
  }
  return new Set(args.verbs.map((v) => v.toLowerCase()));
}

export function startsWithVerb(functionName: string, verbs: Set<string>): string | null {
  const segments = identifierSplitByCasing(functionName);
  if (segments.length === 0) return null;

  const firstSegment = segments[0];
  if (verbs.has(firstSegment)) {
    return firstSegment;
  }
  return null;
}

export function noVerbFunctionNameCheck(
  rule: PolicyRule,
  context: PolicyCheckContext
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const args = context.ruleArgs as NoVerbFunctionNameArgs | undefined;
  const verbs = verbSetGet(args);

  const functions = functionMatchesGet(context.source, context.filePath);

  for (const fn of functions) {
    const matchedVerb = startsWithVerb(fn.name, verbs);
    if (matchedVerb) {
      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath: context.filePath,
        message: `Function name '${fn.name}' starts with verb '${matchedVerb}'`,
        line: fn.line,
        column: fn.column,
      });
    }
  }

  return violations;
}
