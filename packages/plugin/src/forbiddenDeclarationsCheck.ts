import type {
  PolicyCheckContext,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';
import ts from 'typescript';

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
  symbolAnchorStart?: number;
  bindingAnchorStart?: number;
  syntaxAnchorStart?: number;
};

function scriptKindFromPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
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

function argsHasWork(args: ForbiddenDeclarationsArgs | undefined): boolean {
  return Boolean(
    args?.symbols?.length ||
    args?.bindings?.length ||
    args?.syntax?.length,
  );
}

function propertyNameTextGet(
  name: ts.PropertyName,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isPrivateIdentifier(name)) {
    return name.getText(sourceFile);
  }
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText(sourceFile);
}

function moduleNameTextGet(
  name: ts.ModuleName,
): string {
  return name.text;
}

function bindingIdentifiersGet(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) {
    return [name];
  }

  const identifiers: ts.Identifier[] = [];
  const patternElements = ts.isObjectBindingPattern(name)
    ? name.elements
    : name.elements.filter((element): element is ts.BindingElement => ts.isBindingElement(element));

  for (const element of patternElements) {
    identifiers.push(...bindingIdentifiersGet(element.name));
  }

  return identifiers;
}

function modifiersGet(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function modifierHas(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiersGet(node).some((modifier) => modifier.kind === kind);
}

function keywordStartGet(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  keywords: ts.SyntaxKind[],
): number {
  const children = node.getChildren(sourceFile);
  for (const child of children) {
    if (keywords.includes(child.kind)) {
      return child.getStart(sourceFile);
    }
  }
  return node.getStart(sourceFile);
}

function variableDeclarationKindGet(
  declarations: ts.VariableDeclarationList,
): 'const' | 'let' | 'var' {
  if ((declarations.flags & ts.NodeFlags.Const) !== 0) {
    return 'const';
  }
  if ((declarations.flags & ts.NodeFlags.Let) !== 0) {
    return 'let';
  }
  return 'var';
}

function defaultExportNameGet(node: ts.Node): string | undefined {
  return modifierHas(node, ts.SyntaxKind.DefaultKeyword) ? 'default' : undefined;
}

function declarationRecordsGet(
  sourceFile: ts.SourceFile,
): DeclarationRecord[] {
  const records: DeclarationRecord[] = [];

  function visit(node: ts.Node): void {
    if (ts.isModuleDeclaration(node)) {
        records.push({
        name: moduleNameTextGet(node.name),
        symbolKind: 'namespace',
        symbolAnchorStart: node.name.getStart(sourceFile),
      });
    } else if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? defaultExportNameGet(node);
      if (name) {
        records.push({
          name,
          symbolKind: 'class',
          syntaxKind: modifierHas(node, ts.SyntaxKind.AbstractKeyword)
            ? 'abstract-class'
            : undefined,
          symbolAnchorStart: node.name
            ? node.name.getStart(sourceFile)
            : keywordStartGet(node, sourceFile, [ts.SyntaxKind.ClassKeyword]),
          syntaxAnchorStart: modifierHas(node, ts.SyntaxKind.AbstractKeyword)
            ? keywordStartGet(node, sourceFile, [ts.SyntaxKind.AbstractKeyword])
            : undefined,
        });
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      records.push({
        name: node.name.text,
        symbolKind: 'interface',
        symbolAnchorStart: node.name.getStart(sourceFile),
      });
    } else if (ts.isTypeAliasDeclaration(node)) {
      records.push({
        name: node.name.text,
        symbolKind: 'type',
        symbolAnchorStart: node.name.getStart(sourceFile),
      });
    } else if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? defaultExportNameGet(node);
      if (name) {
        records.push({
          name,
          symbolKind: 'function',
          syntaxKind: node.asteriskToken ? 'generator-function' : undefined,
          symbolAnchorStart: node.name
            ? node.name.getStart(sourceFile)
            : keywordStartGet(node, sourceFile, [ts.SyntaxKind.FunctionKeyword]),
          syntaxAnchorStart: node.asteriskToken
            ? keywordStartGet(node, sourceFile, [ts.SyntaxKind.FunctionKeyword])
            : undefined,
        });
      }
    } else if (ts.isMethodDeclaration(node)) {
      records.push({
        name: propertyNameTextGet(node.name, sourceFile),
        symbolKind: 'method',
        symbolAnchorStart: node.name.getStart(sourceFile),
      });
    } else if (ts.isPropertyDeclaration(node)) {
      records.push({
        name: propertyNameTextGet(node.name, sourceFile),
        symbolKind: 'field',
        symbolAnchorStart: node.name.getStart(sourceFile),
      });
    } else if (ts.isVariableDeclaration(node)) {
      if (ts.isVariableDeclarationList(node.parent)) {
        const declarationKind = variableDeclarationKindGet(node.parent);
        const symbolKind = declarationKind === 'const' ? 'const' : 'variable';
        const syntaxKind = declarationKind === 'const' ? undefined : declarationKind;
        const syntaxAnchorStart = syntaxKind === 'var'
          ? keywordStartGet(node.parent, sourceFile, [ts.SyntaxKind.VarKeyword])
          : syntaxKind === 'let'
            ? keywordStartGet(node.parent, sourceFile, [ts.SyntaxKind.LetKeyword])
            : undefined;

        for (const identifier of bindingIdentifiersGet(node.name)) {
          records.push({
            name: identifier.text,
            symbolKind,
            syntaxKind,
            symbolAnchorStart: identifier.getStart(sourceFile),
            syntaxAnchorStart,
          });
        }
      }
    } else if (ts.isParameter(node)) {
      for (const identifier of bindingIdentifiersGet(node.name)) {
        records.push({
          name: identifier.text,
          symbolKind: 'parameter',
          symbolAnchorStart: identifier.getStart(sourceFile),
        });
      }
    } else if (ts.isEnumDeclaration(node)) {
      records.push({
        name: node.name.text,
        symbolKind: 'enum',
        symbolAnchorStart: node.name.getStart(sourceFile),
      });
    } else if (ts.isEnumMember(node)) {
      records.push({
        name: propertyNameTextGet(node.name, sourceFile),
        symbolKind: 'enumMember',
        symbolAnchorStart: node.name.getStart(sourceFile),
      });
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      for (const identifier of bindingIdentifiersGet(node.variableDeclaration.name)) {
        records.push({
          name: identifier.text,
          bindingKind: 'catch',
          bindingAnchorStart: identifier.getStart(sourceFile),
        });
      }
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const { importClause } = node;
      if (importClause.name) {
        records.push({
          name: importClause.name.text,
          bindingKind: 'import',
          bindingAnchorStart: importClause.name.getStart(sourceFile),
        });
      }

      if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          records.push({
            name: importClause.namedBindings.name.text,
            bindingKind: 'import',
            bindingAnchorStart: importClause.namedBindings.name.getStart(sourceFile),
          });
        } else {
          for (const element of importClause.namedBindings.elements) {
            records.push({
              name: element.name.text,
              bindingKind: 'import',
              bindingAnchorStart: element.name.getStart(sourceFile),
            });
          }
        }
      }
    } else if (ts.isFunctionExpression(node) && node.name) {
      records.push({
        name: node.name.text,
        bindingKind: 'function-expression-name',
        bindingAnchorStart: node.name.getStart(sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
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

function offsetToLineColumn(
  sourceFile: ts.SourceFile,
  offset: number,
): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset);
  return {
    line: line + 1,
    column: character + 1,
  };
}

function violationForRecordGet(
  rule: PolicyRule,
  context: PolicyCheckContext,
  sourceFile: ts.SourceFile,
  record: DeclarationRecord,
  args: ForbiddenDeclarationsArgs,
): PolicyViolation | undefined {
  if (record.syntaxKind && args.syntax?.includes(record.syntaxKind)) {
    const start = record.syntaxAnchorStart ?? record.symbolAnchorStart ?? record.bindingAnchorStart ?? 0;
    const { line, column } = offsetToLineColumn(sourceFile, start);
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${syntaxLabelGet(record.syntaxKind)}).`,
      line,
      column,
    };
  }

  if (record.bindingKind && args.bindings?.includes(record.bindingKind)) {
    const start = record.bindingAnchorStart ?? 0;
    const { line, column } = offsetToLineColumn(sourceFile, start);
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${bindingLabelGet(record.bindingKind)}).`,
      line,
      column,
    };
  }

  if (record.symbolKind && args.symbols?.includes(record.symbolKind)) {
    const start = record.symbolAnchorStart ?? 0;
    const { line, column } = offsetToLineColumn(sourceFile, start);
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${symbolLabelGet(record.symbolKind)}).`,
      line,
      column,
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

  const sourceFile = createSourceFile(context.filePath, context.source);
  const records = declarationRecordsGet(sourceFile);
  const violations: PolicyViolation[] = [];

  for (const record of records) {
    const violation = violationForRecordGet(rule, context, sourceFile, record, args);
    if (violation) {
      violations.push(violation);
    }
  }

  return violations;
}
