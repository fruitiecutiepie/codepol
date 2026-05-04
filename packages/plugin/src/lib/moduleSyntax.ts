import type { SyntaxNode } from 'web-tree-sitter';
import { WorkspaceFault } from '@codepol/core';
import {
  nodeToLineColumns,
  parseJsTsSource,
} from './jsTsTree';

export type IdentifierType = 'function' | 'variable' | 'type';

export type ExportMatch = {
  name: string;
  identifierType: IdentifierType;
  filePath: string;
  line: number;
  column: number;
  isReexport: boolean;
};

export type ExportStyle = 'default' | 'named';

export type MixedExportStatement = {
  index: number;
  stmt: SyntaxNode;
  style: ExportStyle;
};

export type ExportSpecifierMatch = {
  localName: string;
  exportedName: string;
  positionNode: SyntaxNode;
};

export type DeclarationBinding = {
  name: string;
  nameNode: SyntaxNode;
  identifierType: IdentifierType;
};

const DECLARATION_NODE_TYPES = new Set([
  'abstract_class_declaration',
  'class',
  'class_declaration',
  'enum_declaration',
  'function_declaration',
  'function_expression',
  'generator_function_declaration',
  'interface_declaration',
  'lexical_declaration',
  'type_alias_declaration',
  'variable_declaration',
]);

export function exportStatementDeclarationGet(
  statement: SyntaxNode,
): SyntaxNode | undefined {
  return statement.namedChildren.find((child) => DECLARATION_NODE_TYPES.has(child.type));
}

export function exportClauseGet(
  statement: SyntaxNode,
): SyntaxNode | undefined {
  return statement.namedChildren.find((child) => child.type === 'export_clause');
}

export function exportStatementHasSource(
  statement: SyntaxNode,
): boolean {
  return statement.namedChildren.some((child) => child.type === 'string');
}

export function declarationBindingsGet(
  declaration: SyntaxNode,
): DeclarationBinding[] {
  const bindings: DeclarationBinding[] = [];

  switch (declaration.type) {
    case 'function_declaration':
    case 'generator_function_declaration':
    case 'function_expression': {
      const nameNode = declaration.childForFieldName('name');
      if (nameNode) {
        bindings.push({
          name: nameNode.text,
          nameNode,
          identifierType: 'function',
        });
      }
      break;
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const declarator of declaration.namedChildren.filter(
        (child) => child.type === 'variable_declarator',
      )) {
        const nameNode = declarator.childForFieldName('name');
        if (!nameNode || nameNode.type !== 'identifier') {
          continue;
        }
        const valueNode = declarator.childForFieldName('value');
        const identifierType: IdentifierType =
          valueNode &&
          (valueNode.type === 'arrow_function' ||
            valueNode.type === 'function_expression' ||
            valueNode.type === 'generator_function')
            ? 'function'
            : 'variable';
        bindings.push({
          name: nameNode.text,
          nameNode,
          identifierType,
        });
      }
      break;
    }
    case 'type_alias_declaration':
    case 'interface_declaration':
    case 'class_declaration':
    case 'abstract_class_declaration':
    case 'enum_declaration':
    case 'class': {
      const nameNode = declaration.childForFieldName('name');
      if (nameNode) {
        bindings.push({
          name: nameNode.text,
          nameNode,
          identifierType: 'type',
        });
      }
      break;
    }
    default:
      break;
  }

  return bindings;
}

export function exportSpecifiersGet(
  exportClause: SyntaxNode,
): ExportSpecifierMatch[] {
  return exportClause.namedChildren
    .filter((child) => child.type === 'export_specifier')
    .map((specifier) => {
      const localNode = specifier.childForFieldName('name');
      const aliasNode = specifier.childForFieldName('alias');
      const positionNode = aliasNode ?? localNode;
      if (!localNode || !positionNode) {
        throw new WorkspaceFault('Malformed export specifier');
      }
      return {
        localName: localNode.text,
        exportedName: (aliasNode ?? localNode).text,
        positionNode,
      };
    });
}

export function statement_export_style_get(
  statement: SyntaxNode,
  source: string,
): ExportStyle | undefined {
  if (statement.type !== 'export_statement') {
    return undefined;
  }

  const text = source.slice(statement.startIndex, statement.endIndex);
  if (/^export\s+default\b/u.test(text)) {
    return 'default';
  }

  const exportClause = exportClauseGet(statement);
  if (exportClause) {
    return exportClause.namedChildren.length > 0 ? 'named' : undefined;
  }

  if (exportStatementHasSource(statement)) {
    return 'named';
  }

  return exportStatementDeclarationGet(statement) ? 'named' : undefined;
}

export function export_statements_collect(
  root: SyntaxNode,
  source: string,
): MixedExportStatement[] {
  const statements: MixedExportStatement[] = [];
  for (let index = 0; index < root.namedChildren.length; index++) {
    const stmt = root.namedChildren[index]!;
    const style = statement_export_style_get(stmt, source);
    if (!style) {
      continue;
    }
    statements.push({
      index,
      stmt,
      style,
    });
  }
  return statements;
}

export function primary_export_statement_get(
  exportStatements: MixedExportStatement[],
  preferredStyle: ExportStyle | undefined,
): MixedExportStatement | undefined {
  const hasDefaultExport = exportStatements.some((stmt) => stmt.style === 'default');
  const hasNamedExport = exportStatements.some((stmt) => stmt.style === 'named');
  if (!hasDefaultExport || !hasNamedExport) {
    return undefined;
  }

  if (preferredStyle) {
    return exportStatements.find((stmt) => stmt.style !== preferredStyle);
  }

  let seenDefault = false;
  let seenNamed = false;
  for (const exportStatement of exportStatements) {
    const wasMixed = seenDefault && seenNamed;
    if (exportStatement.style === 'default') {
      seenDefault = true;
    } else {
      seenNamed = true;
    }
    if (!wasMixed && seenDefault && seenNamed) {
      return exportStatement;
    }
  }

  return undefined;
}

export function mixedExportsAnalyze(
  source: string,
  filePath = 'temp.ts',
): {
  hasDefaultExport: boolean;
  hasNamedExport: boolean;
} {
  const { root } = parseJsTsSource(filePath, source);
  const exportStatements = export_statements_collect(root, source);
  return {
    hasDefaultExport: exportStatements.some((stmt) => stmt.style === 'default'),
    hasNamedExport: exportStatements.some((stmt) => stmt.style === 'named'),
  };
}

export function exportMatchesGetFromSource(
  source: string,
  filePath: string,
  includeReexports = false,
): ExportMatch[] {
  const { root } = parseJsTsSource(filePath, source);
  const exports: ExportMatch[] = [];

  for (const statement of root.namedChildren) {
    if (statement.type !== 'export_statement') {
      continue;
    }

    if (statement_export_style_get(statement, source) === 'default') {
      continue;
    }

    const exportClause = exportClauseGet(statement);
    if (exportClause) {
      const isReexport = exportStatementHasSource(statement);
      if (!isReexport || includeReexports) {
        for (const specifier of exportSpecifiersGet(exportClause)) {
          const location = nodeToLineColumns(specifier.positionNode);
          exports.push({
            name: specifier.exportedName,
            identifierType: 'variable',
            filePath,
            line: location.line,
            column: location.column,
            isReexport,
          });
        }
      }
      continue;
    }

    const declaration = exportStatementDeclarationGet(statement);
    if (!declaration) {
      continue;
    }

    for (const binding of declarationBindingsGet(declaration)) {
      const location = nodeToLineColumns(binding.nameNode);
      exports.push({
        name: binding.name,
        identifierType: binding.identifierType,
        filePath,
        line: location.line,
        column: location.column,
        isReexport: false,
      });
    }
  }

  return exports;
}

export function localNamedExportStatementsGet(
  root: SyntaxNode,
  source: string,
): SyntaxNode[] {
  return root.namedChildren.filter((statement) =>
    statement_export_style_get(statement, source) === 'named' &&
    !exportStatementHasSource(statement),
  );
}

export function localNamedExportBindingCountGet(
  root: SyntaxNode,
  source: string,
): number {
  let count = 0;
  for (const statement of localNamedExportStatementsGet(root, source)) {
    const declaration = exportStatementDeclarationGet(statement);
    if (!declaration) {
      continue;
    }
    count += declarationBindingsGet(declaration).length;
  }
  return count;
}

export function singleLocalNamedExportNameGet(
  statement: SyntaxNode,
): string | undefined {
  const declaration = exportStatementDeclarationGet(statement);
  if (!declaration) {
    return undefined;
  }
  const bindings = declarationBindingsGet(declaration);
  if (bindings.length !== 1) {
    return undefined;
  }
  return bindings[0]!.name;
}
