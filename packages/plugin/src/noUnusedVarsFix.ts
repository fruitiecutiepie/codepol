/**
 * Autofix for {@link noUnusedVarsCheck}: remove unused declarations or prefix
 * parameters/catch bindings with `_` when removal would break syntax.
 */

import type { PolicyViolationFix, SymbolRecord } from '@codepol/core';
import ts from 'typescript';

function scriptKindFromPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  return ts.ScriptKind.TS;
}

function createSourceFile(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFromPath(filePath),
  );
}

function statementTrailingNewlineExtend(source: string, end: number): number {
  let e = end;
  while (e < source.length && (source[e] === ' ' || source[e] === '\t')) {
    e++;
  }
  if (source[e] === '\r') {
    e++;
  }
  if (source[e] === '\n') {
    e++;
  }
  return e;
}

function removeWholeStatement(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  source: string,
): PolicyViolationFix {
  const start = statement.getStart(sourceFile);
  const end = statementTrailingNewlineExtend(source, statement.getEnd());
  return { byteRange: { start, end }, text: '' };
}

function prefixUnderscoreFix(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): PolicyViolationFix | undefined {
  const name = id.text;
  if (name.startsWith('_')) {
    return undefined;
  }
  return {
    byteRange: { start: id.getStart(sourceFile), end: id.getEnd() },
    text: `_${name}`,
  };
}

function bindingIdentifierFind(
  sourceFile: ts.SourceFile,
  symbol: SymbolRecord,
): ts.Identifier | undefined {
  const pos = symbol.byteRange.start;
  let best: ts.Identifier | undefined;
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && node.text === symbol.name) {
      const ns = node.getStart(sourceFile);
      const ne = node.getEnd();
      if (pos >= ns && pos < ne) {
        if (
          !best ||
          ne - ns < best.getEnd() - best.getStart(sourceFile)
        ) {
          best = node;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return best;
}

function removeVariableDeclaration(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  source: string,
): PolicyViolationFix | undefined {
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list)) {
    return undefined;
  }

  const decls = list.declarations;
  const idx = decls.indexOf(decl);
  if (idx < 0) {
    return undefined;
  }

  const parent = list.parent;

  if (ts.isVariableStatement(parent)) {
    if (decls.length === 1) {
      return removeWholeStatement(parent, sourceFile, source);
    }
    if (idx === 0) {
      const next = decls[1];
      return {
        byteRange: {
          start: decl.getStart(sourceFile),
          end: next.getStart(sourceFile),
        },
        text: '',
      };
    }
    const prev = decls[idx - 1];
    return {
      byteRange: { start: prev.getEnd(), end: decl.getEnd() },
      text: '',
    };
  }

  if (
    ts.isForStatement(parent) &&
    parent.initializer === list &&
    decls.length === 1
  ) {
    return {
      byteRange: { start: list.getStart(sourceFile), end: list.getEnd() },
      text: '',
    };
  }

  if (ts.isForStatement(parent) && parent.initializer === list) {
    if (idx === 0) {
      const next = decls[1];
      return {
        byteRange: {
          start: decl.getStart(sourceFile),
          end: next.getStart(sourceFile),
        },
        text: '',
      };
    }
    const prev = decls[idx - 1];
    return {
      byteRange: { start: prev.getEnd(), end: decl.getEnd() },
      text: '',
    };
  }

  if (
    (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
    parent.initializer === list &&
    decls.length === 1
  ) {
    if (ts.isIdentifier(decl.name)) {
      return prefixUnderscoreFix(decl.name, sourceFile);
    }
  }

  return undefined;
}

function removeBindingElement(
  el: ts.BindingElement,
  sourceFile: ts.SourceFile,
  source: string,
): PolicyViolationFix | undefined {
  const nameNode = el.name;
  if (!ts.isIdentifier(nameNode)) {
    return undefined;
  }

  const pattern = el.parent;
  if (!ts.isObjectBindingPattern(pattern) && !ts.isArrayBindingPattern(pattern)) {
    return undefined;
  }

  const elements = pattern.elements;
  const idx = elements.indexOf(el);
  if (idx < 0) {
    return undefined;
  }

  if (elements.length === 1) {
    const list = pattern.parent;
    if (ts.isVariableDeclaration(list) && ts.isVariableDeclarationList(list.parent)) {
      return removeVariableDeclaration(list, sourceFile, source);
    }
    return undefined;
  }

  if (idx === 0) {
    const next = elements[1];
    return {
      byteRange: { start: el.getStart(sourceFile), end: next.getStart(sourceFile) },
      text: '',
    };
  }

  const prev = elements[idx - 1];
  return {
    byteRange: { start: prev.getEnd(), end: el.getEnd() },
    text: '',
  };
}

function removeImportSpecifier(
  spec: ts.ImportSpecifier,
  sourceFile: ts.SourceFile,
  source: string,
): PolicyViolationFix | undefined {
  const named = spec.parent;
  if (!ts.isNamedImports(named)) {
    return undefined;
  }
  const elements = named.elements;
  const idx = elements.indexOf(spec);
  if (idx < 0) {
    return undefined;
  }

  const decl = named.parent.parent;
  if (!ts.isImportDeclaration(decl)) {
    return undefined;
  }

  if (elements.length === 1) {
    return removeWholeStatement(decl, sourceFile, source);
  }

  if (idx === 0) {
    const next = elements[1];
    return {
      byteRange: { start: spec.getStart(sourceFile), end: next.getStart(sourceFile) },
      text: '',
    };
  }

  const prev = elements[idx - 1];
  return {
    byteRange: { start: prev.getEnd(), end: spec.getEnd() },
    text: '',
  };
}

function fixFromIdentifier(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  source: string,
): PolicyViolationFix | undefined {
  const parent = id.parent;

  if (ts.isVariableDeclaration(parent) && parent.name === id) {
    return removeVariableDeclaration(parent, sourceFile, source);
  }

  if (ts.isBindingElement(parent) && parent.name === id) {
    return removeBindingElement(parent, sourceFile, source);
  }

  if (ts.isParameter(parent) && parent.name === id) {
    return prefixUnderscoreFix(id, sourceFile);
  }

  if (ts.isImportSpecifier(parent) && parent.name === id) {
    return removeImportSpecifier(parent, sourceFile, source);
  }

  if (ts.isImportClause(parent) && parent.name === id && parent.parent) {
    const decl = parent.parent;
    if (!ts.isImportDeclaration(decl)) {
      return undefined;
    }
    if (!parent.namedBindings) {
      return removeWholeStatement(decl, sourceFile, source);
    }
    let end = parent.name.getEnd();
    while (end < source.length && (source[end] === ' ' || source[end] === '\t')) {
      end++;
    }
    if (source[end] === ',') {
      end++;
    }
    return { byteRange: { start: id.getStart(sourceFile), end }, text: '' };
  }

  if (ts.isNamespaceImport(parent) && parent.name === id) {
    const decl = parent.parent?.parent;
    if (decl && ts.isImportDeclaration(decl)) {
      return removeWholeStatement(decl, sourceFile, source);
    }
  }

  if (ts.isCatchClause(parent)) {
    const vd = parent.variableDeclaration;
    if (vd && ts.isIdentifier(vd.name) && vd.name === id) {
      return prefixUnderscoreFix(id, sourceFile);
    }
  }

  if (ts.isFunctionDeclaration(parent) && parent.name === id) {
    return removeWholeStatement(parent, sourceFile, source);
  }

  if (ts.isClassDeclaration(parent) && parent.name === id) {
    return removeWholeStatement(parent, sourceFile, source);
  }

  if (ts.isTypeAliasDeclaration(parent) && parent.name === id) {
    return removeWholeStatement(parent, sourceFile, source);
  }

  if (ts.isInterfaceDeclaration(parent) && parent.name === id) {
    return removeWholeStatement(parent, sourceFile, source);
  }

  if (ts.isEnumDeclaration(parent) && parent.name === id) {
    return removeWholeStatement(parent, sourceFile, source);
  }

  return undefined;
}

/**
 * Returns a single-file fix for an unused variable violation, or `undefined`
 * when the binding shape is not safely auto-fixable.
 */
export function noUnusedVarsViolationFixGet(
  source: string,
  filePath: string,
  symbol: SymbolRecord,
): PolicyViolationFix | undefined {
  const sourceFile = createSourceFile(filePath, source);
  const id = bindingIdentifierFind(sourceFile, symbol);
  if (!id) {
    return undefined;
  }
  return fixFromIdentifier(id, sourceFile, source);
}
