import type { SyntaxNode } from 'web-tree-sitter';
import {
  keywordSpanInRange,
  outerWrapperGet,
  parseJsTsSource,
} from './lib/jsTsTree';

type InterfaceReplacement = {
  start: number;
  end: number;
  replacement: string;
};

function interfaceDeclarationNodesGet(
  source: string,
  filePath: string,
): SyntaxNode[] {
  const { root } = parseJsTsSource(filePath, source);
  const interfaces: SyntaxNode[] = [];

  function visit(node: SyntaxNode): void {
    if (node.type === 'interface_declaration') {
      interfaces.push(node);
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);
  return interfaces;
}

/**
 * Fix source by converting interface declarations to type aliases.
 * Handles extends clauses: `interface Foo extends Bar, Baz { x: string }`
 * becomes `type Foo = Bar & Baz & { x: string };`
 */
export function noInterfaceFix(
  source: string,
  filePath = 'temp.ts',
): string {
  const replacements: InterfaceReplacement[] = interfaceDeclarationNodesGet(source, filePath)
    .map((node) => {
      const container = outerWrapperGet(node);
      return {
        start: container.startIndex,
        end: container.endIndex,
        replacement: interfaceToTypeAlias(node, source),
      };
    });

  replacements.sort((a, b) => b.start - a.start);

  let result = source;
  for (const { start, end, replacement } of replacements) {
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}

export function interfaceToTypeAlias(
  node: SyntaxNode,
  source: string,
): string {
  const container = outerWrapperGet(node);
  const bodyNode = node.childForFieldName('body');
  const extendsNode = node.namedChildren.find(
    (child) => child.type === 'extends_type_clause',
  );

  if (!bodyNode) {
    return source.slice(container.startIndex, container.endIndex);
  }

  const interfaceKeyword = keywordSpanInRange(
    source,
    node.startIndex,
    node.endIndex,
    'interface',
  );
  const prefix = source.slice(container.startIndex, node.startIndex);
  const nameRegionEnd = extendsNode?.startIndex ?? bodyNode.startIndex;
  const nameAndTypeParams = source
    .slice(interfaceKeyword.end, nameRegionEnd)
    .trimEnd();
  const extendsParts = extendsNode
    ? extendsNode.namedChildren.map((child) => child.text)
    : [];
  const body = source.slice(bodyNode.startIndex, bodyNode.endIndex);
  const extendsIntersection =
    extendsParts.length > 0 ? `${extendsParts.join(' & ')} & ` : '';

  return `${prefix}type${nameAndTypeParams} = ${extendsIntersection}${body};`;
}
