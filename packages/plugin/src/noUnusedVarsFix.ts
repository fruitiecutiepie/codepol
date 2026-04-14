/**
 * Autofix for {@link noUnusedVarsCheck}: remove unused declarations or prefix
 * parameters/catch bindings with `_` when removal would break syntax.
 */

import type { PolicyViolationFix, SymbolRecord } from '@codepol/core';
import type { SyntaxNode } from 'web-tree-sitter';
import {
  nodeMatches,
  parseJsTsSource,
  smallestMatchingNodeGet,
  wholeStatementRangeGet,
} from './lib/jsTsTree';

function removeWholeStatement(
  statement: SyntaxNode,
  source: string,
): PolicyViolationFix {
  const range = wholeStatementRangeGet(source, statement);
  return { byteRange: range, text: '' };
}

function prefixUnderscoreFix(
  id: SyntaxNode,
): PolicyViolationFix | undefined {
  const name = id.text;
  if (name.startsWith('_')) {
    return undefined;
  }
  return {
    byteRange: { start: id.startIndex, end: id.endIndex },
    text: `_${name}`,
  };
}

function bindingIdentifierFind(
  root: SyntaxNode,
  symbol: SymbolRecord,
): SyntaxNode | undefined {
  const pos = symbol.byteRange.start;
  return smallestMatchingNodeGet(
    root,
    pos,
    (node) =>
      (node.type === 'identifier' ||
        node.type === 'type_identifier' ||
        node.type === 'shorthand_property_identifier_pattern') &&
      node.text === symbol.name,
  );
}

function variableDeclaratorsGet(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter((child) => child.type === 'variable_declarator');
}

function removeVariableDeclaration(
  declarator: SyntaxNode,
  source: string,
): PolicyViolationFix | undefined {
  const declaration = declarator.parent;
  if (!declaration) {
    return undefined;
  }

  const declarators = variableDeclaratorsGet(declaration);
  const index = declarators.findIndex((candidate) => nodeMatches(candidate, declarator));
  if (index < 0) {
    return undefined;
  }

  const parent = declaration.parent;

  if (
    parent?.type === 'for_statement' &&
    nodeMatches(parent.childForFieldName('initializer'), declaration)
  ) {
    if (declarators.length === 1) {
      return {
        byteRange: { start: declaration.startIndex, end: declaration.endIndex },
        text: '',
      };
    }
    if (index === 0) {
      const next = declarators[1]!;
      return {
        byteRange: { start: declarator.startIndex, end: next.startIndex },
        text: '',
      };
    }
    const prev = declarators[index - 1]!;
    return {
      byteRange: { start: prev.endIndex, end: declarator.endIndex },
      text: '',
    };
  }

  if (declaration.type === 'lexical_declaration' || declaration.type === 'variable_declaration') {
    if (declarators.length === 1) {
      return removeWholeStatement(declaration, source);
    }
    if (index === 0) {
      const next = declarators[1]!;
      return {
        byteRange: { start: declarator.startIndex, end: next.startIndex },
        text: '',
      };
    }
    const prev = declarators[index - 1]!;
    return {
      byteRange: { start: prev.endIndex, end: declarator.endIndex },
      text: '',
    };
  }

  return undefined;
}

function removeBindingElement(
  elementNode: SyntaxNode,
  source: string,
): PolicyViolationFix | undefined {
  let pattern: SyntaxNode | undefined;
  let element = elementNode;

  if (elementNode.parent?.type === 'pair_pattern') {
    pattern = elementNode.parent.parent ?? undefined;
    element = elementNode.parent;
  } else {
    pattern = elementNode.parent ?? undefined;
  }

  if (!pattern || (pattern.type !== 'object_pattern' && pattern.type !== 'array_pattern')) {
    return undefined;
  }

  const elements = pattern.namedChildren;
  const index = elements.findIndex((candidate) => nodeMatches(candidate, element));
  if (index < 0) {
    return undefined;
  }

  if (elements.length === 1) {
    const declarator = pattern.parent;
    if (
      declarator?.type === 'variable_declarator' &&
      declarator.parent &&
      (declarator.parent.type === 'lexical_declaration' ||
        declarator.parent.type === 'variable_declaration')
    ) {
      return removeVariableDeclaration(declarator, source);
    }
    return undefined;
  }

  if (index === 0) {
    const next = elements[1]!;
    return {
      byteRange: { start: element.startIndex, end: next.startIndex },
      text: '',
    };
  }

  const prev = elements[index - 1]!;
  return {
    byteRange: { start: prev.endIndex, end: element.endIndex },
    text: '',
  };
}

function removeImportSpecifier(
  specifier: SyntaxNode,
  source: string,
): PolicyViolationFix | undefined {
  const namedImports = specifier.parent;
  const importStatement = namedImports?.parent?.parent;
  if (!namedImports || !importStatement || namedImports.type !== 'named_imports' || importStatement.type !== 'import_statement') {
    return undefined;
  }

  const elements = namedImports.namedChildren.filter(
    (child) => child.type === 'import_specifier',
  );
  const index = elements.findIndex((candidate) => nodeMatches(candidate, specifier));
  if (index < 0) {
    return undefined;
  }

  if (elements.length === 1) {
    return removeWholeStatement(importStatement, source);
  }

  if (index === 0) {
    const next = elements[1]!;
    return {
      byteRange: { start: specifier.startIndex, end: next.startIndex },
      text: '',
    };
  }

  const prev = elements[index - 1]!;
  return {
    byteRange: { start: prev.endIndex, end: specifier.endIndex },
    text: '',
  };
}

function fixFromIdentifier(
  id: SyntaxNode,
  source: string,
): PolicyViolationFix | undefined {
  const parent = id.parent;
  if (!parent) {
    return undefined;
  }

  if (parent.type === 'variable_declarator' && nodeMatches(parent.childForFieldName('name'), id)) {
    return removeVariableDeclaration(parent, source);
  }

  if (parent.type === 'shorthand_property_identifier_pattern') {
    return removeBindingElement(parent, source);
  }

  if (parent.type === 'pair_pattern' && parent.childForFieldName('value') === id) {
    return removeBindingElement(id, source);
  }

  if (parent.type === 'array_pattern') {
    return removeBindingElement(id, source);
  }

  if (
    (parent.type === 'required_parameter' || parent.type === 'optional_parameter') &&
    nodeMatches(
      parent.namedChildren.find((child) => child.type !== 'type_annotation'),
      id,
    )
  ) {
    return prefixUnderscoreFix(id);
  }

  if (parent.type === 'import_specifier') {
    const localNode = parent.childForFieldName('alias') ?? parent.childForFieldName('name');
    if (nodeMatches(localNode, id)) {
      return removeImportSpecifier(parent, source);
    }
  }

  if (parent.type === 'import_clause' && parent.namedChildren[0] === id) {
    const importStatement = parent.parent;
    if (!importStatement || importStatement.type !== 'import_statement') {
      return undefined;
    }
    const otherBinding = parent.namedChildren.some(
      (child) => child !== id && (child.type === 'named_imports' || child.type === 'namespace_import'),
    );
    if (!otherBinding) {
      return removeWholeStatement(importStatement, source);
    }

    let end = id.endIndex;
    while (end < source.length && (source[end] === ' ' || source[end] === '\t')) {
      end++;
    }
    if (source[end] === ',') {
      end++;
      while (end < source.length && (source[end] === ' ' || source[end] === '\t')) {
        end++;
      }
    }
    return { byteRange: { start: id.startIndex, end }, text: '' };
  }

  if (parent.type === 'namespace_import') {
    const importStatement = parent.parent?.parent;
    if (importStatement?.type === 'import_statement') {
      return removeWholeStatement(importStatement, source);
    }
  }

  if (parent.type === 'catch_clause') {
    const bindingNode = parent.namedChildren.find((child) => child.type !== 'statement_block');
    if (nodeMatches(bindingNode, id)) {
      return prefixUnderscoreFix(id);
    }
  }

  if (
    (parent.type === 'function_declaration' ||
      parent.type === 'generator_function_declaration' ||
      parent.type === 'class_declaration' ||
      parent.type === 'abstract_class_declaration' ||
      parent.type === 'type_alias_declaration' ||
      parent.type === 'interface_declaration' ||
      parent.type === 'enum_declaration') &&
    nodeMatches(parent.childForFieldName('name'), id)
  ) {
    return removeWholeStatement(parent, source);
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
  const { root } = parseJsTsSource(filePath, source);
  const id = bindingIdentifierFind(root, symbol);
  if (!id) {
    return undefined;
  }
  return fixFromIdentifier(id, source);
}
