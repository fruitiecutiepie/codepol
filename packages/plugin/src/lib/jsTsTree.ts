import {
  diagnosticsRuntimeGet,
  isErr,
  parserGetForFile,
  parserParseTrace,
  WorkspaceFault,
} from '@codepol/core';
import type { Diagnostics } from '@codepol/core';
import type { SyntaxNode, Tree } from 'web-tree-sitter';

export type ByteSpan = {
  start: number;
  end: number;
};

export type ParsedJsTsSource = {
  tree: Tree;
  root: SyntaxNode;
  source: string;
  filePath: string;
};

type LineColumn = {
  line: number;
  column: number;
};

export type LineColumns = LineColumn & {
  endLine: number;
  endColumn: number;
};

const WRAPPER_NODE_TYPES = new Set(['ambient_declaration', 'export_statement']);
const IMPORT_STATEMENT = 'import_statement';

// TODO(result-refactor): offer Result-returning parse API and migrate callers (moduleSyntax, checks); backlog in packages/core/src/result/result.ts.

export function parseJsTsSource(
  filePath: string,
  source: string,
  diag?: Diagnostics,
): ParsedJsTsSource {
  const parserResult = parserGetForFile(filePath);
  if (isErr(parserResult)) {
    throw new WorkspaceFault(`Parser not available for "${filePath}": ${parserResult.Err}`);
  }

  const parseDiag = diag
    ?? diagnosticsRuntimeGet().getDiagnostics('plugin.jsTsTree');
  const tree = parserParseTrace(parserResult.Ok, source, parseDiag, {
    filePath,
    callSite: 'jsTsTree.parseJsTsSource',
  });
  return {
    tree,
    root: tree.rootNode,
    source,
    filePath,
  };
}

export function nodeSpan(node: SyntaxNode): ByteSpan {
  return {
    start: node.startIndex,
    end: node.endIndex,
  };
}

export function offsetToLineColumn(
  source: string,
  offset: number,
): LineColumn {
  const safeOffset = Math.min(Math.max(offset, 0), source.length);
  const lines = source.slice(0, safeOffset).split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

export function spanToLineColumns(
  source: string,
  span: ByteSpan,
): LineColumns {
  const start = offsetToLineColumn(source, span.start);
  const end = offsetToLineColumn(source, span.end);
  return {
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

export function nodeToLineColumns(node: SyntaxNode): LineColumns {
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

export function descendantsVisit(
  node: SyntaxNode,
  visitor: (current: SyntaxNode) => void,
): void {
  visitor(node);
  for (const child of node.namedChildren) {
    descendantsVisit(child, visitor);
  }
}

export function outerWrapperGet(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.parent && WRAPPER_NODE_TYPES.has(current.parent.type)) {
    current = current.parent;
  }
  return current;
}

export function keywordSpanInRange(
  source: string,
  start: number,
  end: number,
  keyword: string,
): ByteSpan {
  const found = source.indexOf(keyword, start);
  if (found === -1 || found >= end) {
    return {
      start,
      end: Math.min(end, start + keyword.length),
    };
  }
  return {
    start: found,
    end: found + keyword.length,
  };
}

export function lineStartGet(source: string, byteOffset: number): number {
  let index = Math.min(Math.max(byteOffset, 0), source.length);
  while (index > 0) {
    const ch = source[index - 1];
    if (ch === '\n' || ch === '\r') {
      return index;
    }
    index--;
  }
  return 0;
}

export function statementTrailingNewlineExtend(
  source: string,
  end: number,
): number {
  let cursor = end;
  while (cursor < source.length && (source[cursor] === ' ' || source[cursor] === '\t')) {
    cursor++;
  }
  if (source[cursor] === '\r') {
    cursor++;
  }
  if (source[cursor] === '\n') {
    cursor++;
  }
  return cursor;
}

export function wholeStatementRangeGet(
  source: string,
  statement: SyntaxNode,
): ByteSpan {
  const statementStart = statement.startIndex;
  const startOfLine = lineStartGet(source, statementStart);
  const prefix = source.slice(startOfLine, statementStart);
  const start = /^[ \t]*$/u.test(prefix) ? startOfLine : statementStart;
  const end = statementTrailingNewlineExtend(source, statement.endIndex);
  return { start, end };
}

export function importStatementAt(
  root: SyntaxNode,
  byteOffset: number,
): SyntaxNode | undefined {
  return root.namedChildren.find(
    (node) =>
      node.type === IMPORT_STATEMENT &&
      node.startIndex <= byteOffset &&
      byteOffset < node.endIndex,
  );
}

function identifierLike(node: SyntaxNode): boolean {
  return node.type === 'identifier' ||
    node.type === 'type_identifier' ||
    node.type === 'property_identifier' ||
    node.type === 'private_property_identifier' ||
    node.type === 'shorthand_property_identifier_pattern';
}

export function bindingIdentifierNodesGet(
  node: SyntaxNode | null | undefined,
): SyntaxNode[] {
  if (!node) {
    return [];
  }
  if (identifierLike(node)) {
    return [node];
  }
  if (node.type === 'type_annotation') {
    return [];
  }

  const identifiers: SyntaxNode[] = [];
  for (const child of node.namedChildren) {
    identifiers.push(...bindingIdentifierNodesGet(child));
  }
  return identifiers;
}

export function propertyNameTextGet(node: SyntaxNode): string {
  if (node.type === 'string') {
    return node.text.slice(1, -1);
  }
  return node.text;
}

export function smallestMatchingNodeGet(
  node: SyntaxNode,
  byteOffset: number,
  predicate: (current: SyntaxNode) => boolean,
): SyntaxNode | undefined {
  if (byteOffset < node.startIndex || byteOffset >= node.endIndex) {
    return undefined;
  }

  for (const child of node.namedChildren) {
    const match = smallestMatchingNodeGet(child, byteOffset, predicate);
    if (match) {
      return match;
    }
  }

  if (predicate(node)) {
    return node;
  }
  return undefined;
}

export function nodeMatches(
  left: SyntaxNode | null | undefined,
  right: SyntaxNode | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.type === right.type &&
    left.startIndex === right.startIndex &&
    left.endIndex === right.endIndex,
  );
}
