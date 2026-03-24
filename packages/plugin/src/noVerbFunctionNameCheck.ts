import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
} from '@codepol/core';
import ts from 'typescript';
import { identifierSplitByCasing } from './lib/identifierSplitByCasing';

type NoVerbFunctionNameArgs = {
  verbs: string[];
};

export type FunctionMatch = {
  name: string;
  line: number;
  column: number;
};

export function extractFunctionsTypeScript(source: string): FunctionMatch[] {
  const matches: FunctionMatch[] = [];
  const sourceFile = ts.createSourceFile(
    'temp.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );

  function visit(node: ts.Node) {
    // Function declaration: function foo() {}
    if (ts.isFunctionDeclaration(node) && node.name) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
      matches.push({
        name: node.name.text,
        line: line + 1,
        column: character + 1,
      });
    }

    // Variable declaration with arrow/function expression: const foo = () => {} or const foo = function() {}
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
        matches.push({
          name: node.name.text,
          line: line + 1,
          column: character + 1,
        });
      }
    }

    // Method declaration: { foo() {} }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
      matches.push({
        name: node.name.text,
        line: line + 1,
        column: character + 1,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

const PYTHON_DEF_PATTERN = /(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(/gm;

function isDunderName(name: string): boolean {
  return name.startsWith('__') && name.endsWith('__');
}

function lineAndColumnFromOffset(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

/**
 * Regex-based Python function name extractor.
 * This is a compatibility step — the extraction function is isolated
 * so it can be replaced with a tree-sitter-based extractor later.
 */
export function extractFunctionsPython(source: string): FunctionMatch[] {
  const matches: FunctionMatch[] = [];
  const pattern = new RegExp(PYTHON_DEF_PATTERN.source, 'gm');

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1];
    if (isDunderName(name)) continue;

    const nameOffset = match.index + match[0].indexOf(name);
    const { line, column } = lineAndColumnFromOffset(source, nameOffset);

    matches.push({ name, line, column });
  }

  return matches;
}

export function extractFunctions(source: string, filePath: string = 'temp.ts'): FunctionMatch[] {
  if (filePath.endsWith('.py')) {
    return extractFunctionsPython(source);
  }
  return extractFunctionsTypeScript(source);
}

export function buildVerbSet(args: NoVerbFunctionNameArgs | undefined): Set<string> {
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
  const verbs = buildVerbSet(args);

  const functions = extractFunctions(context.source, context.filePath);

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
