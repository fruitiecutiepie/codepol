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

type ByteSpan = {
  start: number;
  end: number;
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

function spanFromNode(sourceFile: ts.SourceFile, node: ts.Node): ByteSpan {
  return {
    start: node.getStart(sourceFile),
    end: node.getEnd(),
  };
}

/** First direct child with the given syntax kind (e.g. keyword token). */
function tokenSpanFirstChildOfKind(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  kind: ts.SyntaxKind,
): ByteSpan | undefined {
  for (const child of node.getChildren(sourceFile)) {
    if (child.kind === kind) {
      return { start: child.getStart(sourceFile), end: child.getEnd() };
    }
  }
  return undefined;
}

function variableDeclarationListKeywordSpan(
  sourceFile: ts.SourceFile,
  list: ts.VariableDeclarationList,
): ByteSpan | undefined {
  return (
    tokenSpanFirstChildOfKind(sourceFile, list, ts.SyntaxKind.VarKeyword) ??
    tokenSpanFirstChildOfKind(sourceFile, list, ts.SyntaxKind.LetKeyword) ??
    tokenSpanFirstChildOfKind(sourceFile, list, ts.SyntaxKind.ConstKeyword)
  );
}

function functionStarKeywordSpan(
  sourceFile: ts.SourceFile,
  node: ts.FunctionDeclaration | ts.FunctionExpression,
): ByteSpan | undefined {
  const fnKw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.FunctionKeyword);
  if (!fnKw) {
    return undefined;
  }
  if (node.asteriskToken) {
    return {
      start: fnKw.start,
      end: node.asteriskToken.getEnd(),
    };
  }
  return fnKw;
}

function propertyNameSpan(
  sourceFile: ts.SourceFile,
  name: ts.PropertyName,
): ByteSpan {
  return spanFromNode(sourceFile, name);
}

function declarationRecordsGet(
  sourceFile: ts.SourceFile,
): DeclarationRecord[] {
  const records: DeclarationRecord[] = [];

  function visit(node: ts.Node): void {
    if (ts.isModuleDeclaration(node)) {
      const kw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.NamespaceKeyword) ??
        tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.ModuleKeyword);
      records.push({
        name: moduleNameTextGet(node.name),
        symbolKind: 'namespace',
        symbolSpan: kw ?? spanFromNode(sourceFile, node),
      });
    } else if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? defaultExportNameGet(node);
      if (name) {
        const classKw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.ClassKeyword);
        const abstractKw = tokenSpanFirstChildOfKind(
          sourceFile,
          node,
          ts.SyntaxKind.AbstractKeyword,
        );
        records.push({
          name,
          symbolKind: 'class',
          syntaxKind: modifierHas(node, ts.SyntaxKind.AbstractKeyword)
            ? 'abstract-class'
            : undefined,
          symbolSpan: classKw ?? spanFromNode(sourceFile, node),
          syntaxSpan: abstractKw,
        });
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      const kw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.InterfaceKeyword);
      records.push({
        name: node.name.text,
        symbolKind: 'interface',
        symbolSpan: kw ?? spanFromNode(sourceFile, node),
      });
    } else if (ts.isTypeAliasDeclaration(node)) {
      const kw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.TypeKeyword);
      records.push({
        name: node.name.text,
        symbolKind: 'type',
        symbolSpan: kw ?? spanFromNode(sourceFile, node),
      });
    } else if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? defaultExportNameGet(node);
      if (name) {
        const fnKw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.FunctionKeyword);
        const genSpan = node.asteriskToken
          ? functionStarKeywordSpan(sourceFile, node)
          : undefined;
        records.push({
          name,
          symbolKind: 'function',
          syntaxKind: node.asteriskToken ? 'generator-function' : undefined,
          symbolSpan: fnKw ?? spanFromNode(sourceFile, node),
          syntaxSpan: genSpan,
        });
      }
    } else if (ts.isMethodDeclaration(node)) {
      records.push({
        name: propertyNameTextGet(node.name, sourceFile),
        symbolKind: 'method',
        symbolSpan: propertyNameSpan(sourceFile, node.name),
      });
    } else if (ts.isPropertyDeclaration(node)) {
      records.push({
        name: propertyNameTextGet(node.name, sourceFile),
        symbolKind: 'field',
        symbolSpan: propertyNameSpan(sourceFile, node.name),
      });
    } else if (ts.isVariableDeclaration(node)) {
      if (ts.isVariableDeclarationList(node.parent)) {
        const list = node.parent;
        const declarationKind = variableDeclarationKindGet(list);
        const symbolKind = declarationKind === 'const' ? 'const' : 'variable';
        const syntaxKind = declarationKind === 'const' ? undefined : declarationKind;
        const keywordSpan = variableDeclarationListKeywordSpan(sourceFile, list);
        const syntaxSpan =
          syntaxKind === 'var' || syntaxKind === 'let' ? keywordSpan : undefined;

        for (const _identifier of bindingIdentifiersGet(node.name)) {
          records.push({
            name: _identifier.text,
            symbolKind,
            syntaxKind,
            symbolSpan: keywordSpan ?? spanFromNode(sourceFile, node),
            syntaxSpan,
          });
        }
      }
    } else if (ts.isParameter(node)) {
      for (const _identifier of bindingIdentifiersGet(node.name)) {
        records.push({
          name: _identifier.text,
          symbolKind: 'parameter',
          symbolSpan: spanFromNode(sourceFile, _identifier),
        });
      }
    } else if (ts.isEnumDeclaration(node)) {
      const kw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.EnumKeyword);
      records.push({
        name: node.name.text,
        symbolKind: 'enum',
        symbolSpan: kw ?? spanFromNode(sourceFile, node),
      });
    } else if (ts.isEnumMember(node)) {
      records.push({
        name: propertyNameTextGet(node.name, sourceFile),
        symbolKind: 'enumMember',
        symbolSpan: propertyNameSpan(sourceFile, node.name),
      });
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      const vd = node.variableDeclaration;
      const catchKw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.CatchKeyword);
      for (const _identifier of bindingIdentifiersGet(vd.name)) {
        records.push({
          name: _identifier.text,
          bindingKind: 'catch',
          bindingSpan: catchKw ?? spanFromNode(sourceFile, vd),
        });
      }
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const { importClause } = node;
      const importKw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.ImportKeyword);
      const importSpan = importKw ?? spanFromNode(sourceFile, node);
      if (importClause.name) {
        records.push({
          name: importClause.name.text,
          bindingKind: 'import',
          bindingSpan: importSpan,
        });
      }

      if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          records.push({
            name: importClause.namedBindings.name.text,
            bindingKind: 'import',
            bindingSpan: importSpan,
          });
        } else {
          for (const element of importClause.namedBindings.elements) {
            records.push({
              name: element.name.text,
              bindingKind: 'import',
              bindingSpan: importSpan,
            });
          }
        }
      }
    } else if (ts.isFunctionExpression(node) && node.name) {
      const fnKw = tokenSpanFirstChildOfKind(sourceFile, node, ts.SyntaxKind.FunctionKeyword);
      records.push({
        name: node.name.text,
        bindingKind: 'function-expression-name',
        bindingSpan: fnKw ?? spanFromNode(sourceFile, node),
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

function spanToViolationColumns(
  sourceFile: ts.SourceFile,
  span: ByteSpan,
): {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
} {
  const start = sourceFile.getLineAndCharacterOfPosition(span.start);
  const end = sourceFile.getLineAndCharacterOfPosition(span.end);
  return {
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
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
    const span =
      record.syntaxSpan ?? record.symbolSpan ?? record.bindingSpan ?? {
        start: 0,
        end: 0,
      };
    const { line, column, endLine, endColumn } = spanToViolationColumns(
      sourceFile,
      span,
    );
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${syntaxLabelGet(record.syntaxKind)}).`,
      line,
      column,
      endLine,
      endColumn,
    };
  }

  if (record.bindingKind && args.bindings?.includes(record.bindingKind)) {
    const span = record.bindingSpan ?? { start: 0, end: 0 };
    const { line, column, endLine, endColumn } = spanToViolationColumns(
      sourceFile,
      span,
    );
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${bindingLabelGet(record.bindingKind)}).`,
      line,
      column,
      endLine,
      endColumn,
    };
  }

  if (record.symbolKind && args.symbols?.includes(record.symbolKind)) {
    const span = record.symbolSpan ?? { start: 0, end: 0 };
    const { line, column, endLine, endColumn } = spanToViolationColumns(
      sourceFile,
      span,
    );
    return {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: `Forbidden declaration '${record.name}' (${symbolLabelGet(record.symbolKind)}).`,
      line,
      column,
      endLine,
      endColumn,
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
