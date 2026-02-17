import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
} from '@codepol/core';
import ts from 'typescript';
import { interfaceToTypeAlias } from './noInterfaceFix';

export function noInterfaceCheck(
  rule: PolicyRule,
  context: PolicyCheckContext
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const sourceFile = ts.createSourceFile(
    'temp.ts',
    context.source,
    ts.ScriptTarget.Latest,
    true
  );

  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node)) {
      // Find the 'interface' keyword token
      const interfaceKeyword = node
        .getChildren(sourceFile)
        .find((child) => child.kind === ts.SyntaxKind.InterfaceKeyword);
      const keywordPos = interfaceKeyword
        ? interfaceKeyword.getStart(sourceFile)
        : node.getStart(sourceFile);
      const { line, character } =
        sourceFile.getLineAndCharacterOfPosition(keywordPos);

      // Generate the fix replacement text
      const replacement = interfaceToTypeAlias(node, sourceFile, context.source);

      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath: context.filePath,
        message: `Use 'type' instead of 'interface' for '${node.name.text}'`,
        line: line + 1,
        column: character + 1,
        fix: {
          byteRange: {
            start: node.getStart(sourceFile),
            end: node.getEnd(),
          },
          text: replacement,
        },
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}
