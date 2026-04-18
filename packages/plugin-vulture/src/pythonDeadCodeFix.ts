/**
 * Applies aggressive but guarded removals for Vulture-reported dead code using
 * tree-sitter structure. Skips cases that are unsafe without deeper analysis.
 */

import type { SyntaxNode } from 'web-tree-sitter';
import {
  diagnosticsRuntimeGet,
  isErr,
  parserGetForFile,
  parserParseTrace,
} from '@codepol/core';
import type { Diagnostics } from '@codepol/core';
import { vultureFindingsGet } from './vultureRunner';
import type { VultureFinding, VultureProviderConfig } from './vultureTypes';
import { vultureFindingMatchesFile } from './vulturePathMatch';

function lineStartByte(source: string, line: number): number {
  let lineIdx = 1;
  let pos = 0;
  while (pos < source.length && lineIdx < line) {
    if (source[pos] === '\n') {
      lineIdx++;
    }
    pos++;
  }
  return pos;
}

function extendThroughNewlines(source: string, end: number): number {
  let e = end;
  while (e < source.length && (source[e] === '\r' || source[e] === '\n')) {
    e++;
  }
  return e;
}

function hasDecoratorsOnDefinition(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === 'decorator') {
      return true;
    }
  }
  return false;
}

/** True if `node` is a module-level definition (not nested in class or inner function). */
function isTopLevelModuleDefinition(node: SyntaxNode): boolean {
  let p: SyntaxNode | null = node.parent;
  while (p) {
    if (p.type === 'module') {
      return true;
    }
    if (p.type === 'class_definition' || p.type === 'function_definition') {
      return false;
    }
    p = p.parent;
  }
  return false;
}

function findTopLevelFunction(root: SyntaxNode, name: string): SyntaxNode | null {
  function visit(n: SyntaxNode): SyntaxNode | null {
    if (n.type === 'function_definition') {
      const nm = n.childForFieldName('name');
      if (nm?.text === name && isTopLevelModuleDefinition(n)) {
        return n;
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const ch = n.namedChild(i);
      if (ch) {
        const r = visit(ch);
        if (r) {
          return r;
        }
      }
    }
    return null;
  }
  return visit(root);
}

function findTopLevelClass(root: SyntaxNode, name: string): SyntaxNode | null {
  function visit(n: SyntaxNode): SyntaxNode | null {
    if (n.type === 'class_definition') {
      const nm = n.childForFieldName('name');
      if (nm?.text === name && isTopLevelModuleDefinition(n)) {
        return n;
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const ch = n.namedChild(i);
      if (ch) {
        const r = visit(ch);
        if (r) {
          return r;
        }
      }
    }
    return null;
  }
  return visit(root);
}

function findTopLevelAssignmentTarget(root: SyntaxNode, name: string): SyntaxNode | null {
  function visit(n: SyntaxNode): SyntaxNode | null {
    if (n.type === 'expression_statement') {
      for (const child of n.namedChildren) {
        if (child.type === 'assignment') {
          const left = child.childForFieldName('left');
          if (
            left?.type === 'identifier' &&
            left.text === name &&
            isTopLevelModuleDefinition(n)
          ) {
            return n;
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const ch = n.namedChild(i);
      if (ch) {
        const r = visit(ch);
        if (r) {
          return r;
        }
      }
    }
    return null;
  }
  return visit(root);
}

function walkUpToImport(node: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.type === 'import_statement' || cur.type === 'import_from_statement') {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

function walkUpToStatement(node: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.type === 'import_statement' || cur.type === 'import_from_statement') {
      return cur;
    }
    if (cur.type === 'function_definition' || cur.type === 'class_definition') {
      return cur;
    }
    if (cur.type === 'expression_statement') {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

function computeRemovalRange(
  source: string,
  root: SyntaxNode,
  finding: VultureFinding,
): { start: number; end: number } | undefined {
  const kind = finding.type.toLowerCase();
  const name = finding.name;

  if (kind.includes('import')) {
    const idx = lineStartByte(source, finding.line);
    const leaf = root.descendantForIndex(idx);
    if (!leaf) {
      return undefined;
    }
    const imp = walkUpToImport(leaf);
    if (!imp) {
      return undefined;
    }
    const start = imp.startIndex;
    const end = extendThroughNewlines(source, imp.endIndex);
    return { start, end };
  }

  if (kind.includes('function')) {
    const fn = findTopLevelFunction(root, name);
    if (!fn || hasDecoratorsOnDefinition(fn)) {
      return undefined;
    }
    return { start: fn.startIndex, end: extendThroughNewlines(source, fn.endIndex) };
  }

  if (kind.includes('class')) {
    const cls = findTopLevelClass(root, name);
    if (!cls || hasDecoratorsOnDefinition(cls)) {
      return undefined;
    }
    return { start: cls.startIndex, end: extendThroughNewlines(source, cls.endIndex) };
  }

  if (kind.includes('variable') || kind.includes('property') || kind.includes('attribute')) {
    const idx = lineStartByte(source, finding.line);
    const leaf = root.descendantForIndex(idx);
    if (!leaf) {
      return undefined;
    }
    const stmt = walkUpToStatement(leaf);
    if (!stmt) {
      return undefined;
    }
    if (stmt.type === 'expression_statement') {
      const assign = stmt.namedChildren.find(n => n.type === 'assignment');
      if (!assign) {
        return undefined;
      }
      const left = assign.childForFieldName('left');
      if (left?.type !== 'identifier' || left.text !== name) {
        return undefined;
      }
      return { start: stmt.startIndex, end: extendThroughNewlines(source, stmt.endIndex) };
    }
    const assignTarget = findTopLevelAssignmentTarget(root, name);
    if (!assignTarget) {
      return undefined;
    }
    return {
      start: assignTarget.startIndex,
      end: extendThroughNewlines(source, assignTarget.endIndex),
    };
  }

  return undefined;
}

function mergeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (!last || r.start > last.end) {
      out.push({ ...r });
    } else {
      last.end = Math.max(last.end, r.end);
    }
  }
  return out;
}

/**
 * Returns updated source after applying safe structural removals for Vulture findings.
 */
export function pythonDeadCodeFixApply(
  filePath: string,
  source: string,
  config?: VultureProviderConfig,
  diag?: Diagnostics,
): string {
  const findingsResult = vultureFindingsGet([filePath], config);
  if (isErr(findingsResult)) {
    throw new Error(findingsResult.Err);
  }
  const findings = findingsResult.Ok.filter(f => vultureFindingMatchesFile(f.filePath, filePath));
  if (findings.length === 0) {
    return source;
  }

  const parserResult = parserGetForFile(filePath);
  if (isErr(parserResult)) {
    return source;
  }
  const parseDiag = diag
    ?? diagnosticsRuntimeGet().getDiagnostics('plugin.vulture.pythonDeadCodeFix');
  const tree = parserParseTrace(parserResult.Ok, source, parseDiag, {
    filePath,
    callSite: 'pythonDeadCodeFix',
  });
  const ranges: { start: number; end: number }[] = [];
  for (const f of findings) {
    const r = computeRemovalRange(source, tree.rootNode, f);
    if (r) {
      ranges.push(r);
    }
  }
  if (ranges.length === 0) {
    return source;
  }
  const merged = mergeRanges(ranges);
  let out = source;
  for (const { start, end } of merged.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}
