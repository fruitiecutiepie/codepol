import type {
  PolicyCheckContext,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';
import type { SyntaxNode } from 'web-tree-sitter';
import {
  bindingIdentifierNodesGet,
  keywordSpanInRange,
  parseJsTsSource,
  propertyNameTextGet,
  spanToLineColumns,
  type ByteSpan,
} from './lib/jsTsTree';

export type ForbiddenDeclarationSymbolKind =
  | 'namespace'
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'method'
  | 'field'
  | 'const'
  | 'variable'
  | 'parameter'
  | 'enum'
  | 'enumMember';

export type ForbiddenDeclarationBindingKind =
  | 'import'
  | 'catch'
  | 'function-expression-name';

export type ForbiddenDeclarationSyntaxKind =
  | 'var'
  | 'let'
  | 'abstract-class'
  | 'generator-function';

export type ForbiddenDeclarationsArgs = {
  symbols?: ForbiddenDeclarationSymbolKind[];
  bindings?: ForbiddenDeclarationBindingKind[];
  syntax?: ForbiddenDeclarationSyntaxKind[];
};

type DeclarationRecord = {
  name: string;
  symbolKind?: ForbiddenDeclarationSymbolKind;
  bindingKind?: ForbiddenDeclarationBindingKind;
  syntaxKind?: ForbiddenDeclarationSyntaxKind;
  symbolSpan?: ByteSpan;
  bindingSpan?: ByteSpan;
  syntaxSpan?: ByteSpan;
};

function argsHasWork(args: ForbiddenDeclarationsArgs | undefined): boolean {
  return Boolean(
    args?.symbols?.length ||
    args?.bindings?.length ||
    args?.syntax?.length,
  );
}

function declarationKindGet(
  source: string,
  node: SyntaxNode,
): 'const' | 'let' | 'var' {
  const slice = source.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 8));
  if (/^const\b/u.test(slice)) {
    return 'const';
  }
  if (/^let\b/u.test(slice)) {
    return 'let';
  }
  return 'var';
}

function firstNonTypeChildGet(node: SyntaxNode): SyntaxNode | undefined {
  return node.namedChildren.find((child) => child.type !== 'type_annotation');
}

function declarationRecordsGet(
  source: string,
  root: SyntaxNode,
): DeclarationRecord[] {
  const records: DeclarationRecord[] = [];

  function visit(node: SyntaxNode): void {
    if (node.type === 'internal_module' || node.type === 'module') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const keyword = node.type === 'internal_module' ? 'namespace' : 'module';
        records.push({
          name: nameNode.text,
          symbolKind: 'namespace',
          symbolSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, keyword),
        });
      }
    } else if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: nameNode.text,
          symbolKind: 'class',
          symbolSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'class'),
        });
      }
    } else if (node.type === 'abstract_class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: nameNode.text,
          symbolKind: 'class',
          syntaxKind: 'abstract-class',
          symbolSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'class'),
          syntaxSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'abstract'),
        });
      }
    } else if (node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: nameNode.text,
          symbolKind: 'interface',
          symbolSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'interface'),
        });
      }
    } else if (node.type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: nameNode.text,
          symbolKind: 'type',
          symbolSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'type'),
        });
      }
    } else if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: nameNode.text,
          symbolKind: 'function',
          symbolSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'function'),
        });
      }
    } else if (node.type === 'generator_function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: nameNode.text,
          symbolKind: 'function',
          syntaxKind: 'generator-function',
          symbolSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'function'),
          syntaxSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'function'),
        });
      }
    } else if (node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && nameNode.text !== 'constructor') {
        records.push({
          name: propertyNameTextGet(nameNode),
          symbolKind: 'method',
          symbolSpan: { start: nameNode.startIndex, end: nameNode.endIndex },
        });
      }
    } else if (node.type === 'public_field_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: propertyNameTextGet(nameNode),
          symbolKind: 'field',
          symbolSpan: { start: nameNode.startIndex, end: nameNode.endIndex },
        });
      }
    } else if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      const declarationKind = declarationKindGet(source, node);
      const symbolKind = declarationKind === 'const' ? 'const' : 'variable';
      const syntaxKind = declarationKind === 'const' ? undefined : declarationKind;
      const keywordSpan = keywordSpanInRange(
        source,
        node.startIndex,
        node.endIndex,
        declarationKind,
      );

      for (const declarator of node.namedChildren.filter(
        (child) => child.type === 'variable_declarator',
      )) {
        const nameNode = declarator.childForFieldName('name');
        for (const identifier of bindingIdentifierNodesGet(nameNode)) {
          records.push({
            name: identifier.text,
            symbolKind,
            syntaxKind,
            symbolSpan: keywordSpan,
            syntaxSpan: syntaxKind ? keywordSpan : undefined,
          });
        }
      }
    } else if (
      node.type === 'required_parameter' ||
      node.type === 'optional_parameter'
    ) {
      const bindingNode = firstNonTypeChildGet(node);
      for (const identifier of bindingIdentifierNodesGet(bindingNode)) {
        records.push({
          name: identifier.text,
          symbolKind: 'parameter',
          symbolSpan: { start: identifier.startIndex, end: identifier.endIndex },
        });
      }
    } else if (node.type === 'enum_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: nameNode.text,
          symbolKind: 'enum',
          symbolSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'enum'),
        });
      }
    } else if (node.type === 'enum_body') {
      for (const child of node.namedChildren) {
        if (child.type === 'property_identifier') {
          records.push({
            name: propertyNameTextGet(child),
            symbolKind: 'enumMember',
            symbolSpan: { start: child.startIndex, end: child.endIndex },
          });
        }
      }
    } else if (node.type === 'catch_clause') {
      const bindingNode = node.namedChildren.find((child) => child.type !== 'statement_block');
      const catchSpan = keywordSpanInRange(source, node.startIndex, node.endIndex, 'catch');
      for (const identifier of bindingIdentifierNodesGet(bindingNode)) {
        records.push({
          name: identifier.text,
          bindingKind: 'catch',
          bindingSpan: catchSpan,
        });
      }
    } else if (node.type === 'import_statement') {
      const clause = node.namedChildren.find((child) => child.type === 'import_clause');
      const importSpan = keywordSpanInRange(source, node.startIndex, node.endIndex, 'import');
      if (clause) {
        for (const child of clause.namedChildren) {
          if (child.type === 'identifier') {
            records.push({
              name: child.text,
              bindingKind: 'import',
              bindingSpan: importSpan,
            });
          } else if (child.type === 'namespace_import') {
            const identifier = child.namedChildren.find((namedChild) => namedChild.type === 'identifier');
            if (identifier) {
              records.push({
                name: identifier.text,
                bindingKind: 'import',
                bindingSpan: importSpan,
              });
            }
          } else if (child.type === 'named_imports') {
            for (const specifier of child.namedChildren.filter(
              (namedChild) => namedChild.type === 'import_specifier',
            )) {
              const localNode =
                specifier.childForFieldName('alias') ??
                specifier.childForFieldName('name');
              if (localNode) {
                records.push({
                  name: localNode.text,
                  bindingKind: 'import',
                  bindingSpan: importSpan,
                });
              }
            }
          }
        }
      }
    } else if (node.type === 'function_expression') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        records.push({
          name: nameNode.text,
          bindingKind: 'function-expression-name',
          bindingSpan: keywordSpanInRange(source, node.startIndex, node.endIndex, 'function'),
        });
      }
    } else if (node.type === 'export_statement') {
      const text = source.slice(node.startIndex, node.endIndex);
      if (/^export\s+default\b/u.test(text)) {
        const declaration = node.namedChildren.find(
          (child) =>
            child.type === 'class' ||
            child.type === 'function_expression',
        );
        if (declaration) {
          records.push({
            name: 'default',
            symbolKind: declaration.type === 'class' ? 'class' : 'function',
            symbolSpan: keywordSpanInRange(
              source,
              declaration.startIndex,
              declaration.endIndex,
              declaration.type === 'class' ? 'class' : 'function',
            ),
          });
        }
      }
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);
  return records;
}

function symbolLabelGet(kind: ForbiddenDeclarationSymbolKind): string {
  if (kind === 'enumMember') {
    return 'enum member';
  }
  return kind;
}

function bindingLabelGet(kind: ForbiddenDeclarationBindingKind): string {
  if (kind === 'import') {
    return 'import binding';
  }
  if (kind === 'catch') {
    return 'catch binding';
  }
  return 'function expression name';
}

function syntaxLabelGet(kind: ForbiddenDeclarationSyntaxKind): string {
  if (kind === 'abstract-class') {
    return 'abstract class';
  }
  if (kind === 'generator-function') {
    return 'generator function';
  }
  return kind;
}

function violationForRecordGet(
  rule: PolicyRule,
  context: PolicyCheckContext,
  source: string,
  record: DeclarationRecord,
  args: ForbiddenDeclarationsArgs,
): PolicyViolation | undefined {
  if (record.syntaxKind && args.syntax?.includes(record.syntaxKind)) {
    const span =
      record.syntaxSpan ?? record.symbolSpan ?? record.bindingSpan ?? {
        start: 0,
        end: 0,
      };
    const location = spanToLineColumns(source, span);
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${syntaxLabelGet(record.syntaxKind)}).`,
      line: location.line,
      column: location.column,
      endLine: location.endLine,
      endColumn: location.endColumn,
    };
  }

  if (record.bindingKind && args.bindings?.includes(record.bindingKind)) {
    const span = record.bindingSpan ?? { start: 0, end: 0 };
    const location = spanToLineColumns(source, span);
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${bindingLabelGet(record.bindingKind)}).`,
      line: location.line,
      column: location.column,
      endLine: location.endLine,
      endColumn: location.endColumn,
    };
  }

  if (record.symbolKind && args.symbols?.includes(record.symbolKind)) {
    const span = record.symbolSpan ?? { start: 0, end: 0 };
    const location = spanToLineColumns(source, span);
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${symbolLabelGet(record.symbolKind)}).`,
      line: location.line,
      column: location.column,
      endLine: location.endLine,
      endColumn: location.endColumn,
    };
  }

  return undefined;
}

export function forbiddenDeclarationsCheck(
  rule: PolicyRule,
  context: PolicyCheckContext,
): PolicyViolation[] {
  const args = context.ruleArgs as ForbiddenDeclarationsArgs | undefined;
  if (!args || !argsHasWork(args)) {
    return [];
  }

  const { root } = parseJsTsSource(context.filePath, context.source);
  const records = declarationRecordsGet(context.source, root);
  const violations: PolicyViolation[] = [];

  for (const record of records) {
    const violation = violationForRecordGet(
      rule,
      context,
      context.source,
      record,
      args,
    );
    if (violation) {
      violations.push(violation);
    }
  }

  return violations;
}
