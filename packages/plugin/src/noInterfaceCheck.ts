import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
} from '@codepol/core';
import type { SyntaxNode } from 'web-tree-sitter';
import {
  keywordSpanInRange,
  outerWrapperGet,
  parseJsTsSource,
  spanToLineColumns,
} from './lib/jsTsTree';
import { interfaceToTypeAlias } from './noInterfaceFix';

export function noInterfaceCheck(
  rule: PolicyRule,
  context: PolicyCheckContext,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const { root } = parseJsTsSource(context.filePath, context.source);

  function visit(node: SyntaxNode): void {
    if (node.type === 'interface_declaration') {
      const keywordSpan = keywordSpanInRange(
        context.source,
        node.startIndex,
        node.endIndex,
        'interface',
      );
      const location = spanToLineColumns(context.source, keywordSpan);
      const nameNode = node.childForFieldName('name');
      const container = outerWrapperGet(node);

      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath: context.filePath,
        message: `Use 'type' instead of 'interface' for '${nameNode?.text ?? 'default'}'`,
        line: location.line,
        column: location.column,
        fix: {
          byteRange: {
            start: container.startIndex,
            end: container.endIndex,
          },
          text: interfaceToTypeAlias(node, context.source),
        },
      });
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);
  return violations;
}
