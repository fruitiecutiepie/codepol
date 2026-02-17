import ts from 'typescript';

type InterfaceReplacement = {
  start: number;
  end: number;
  replacement: string;
};

/**
 * Fix source by converting interface declarations to type aliases.
 * Handles extends clauses: `interface Foo extends Bar, Baz { x: string }`
 * becomes `type Foo = Bar & Baz & { x: string };`
 */
export function noInterfaceFix(source: string): string {
  const sourceFile = ts.createSourceFile(
    'temp.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );

  const replacements: InterfaceReplacement[] = [];

  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node)) {
      const replacement = interfaceToTypeAlias(node, sourceFile, source);
      replacements.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        replacement,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Apply replacements in reverse order to preserve positions
  replacements.sort((a, b) => b.start - a.start);

  let result = source;
  for (const { start, end, replacement } of replacements) {
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}

export function interfaceToTypeAlias(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  source: string
): string {
  const children = node.getChildren(sourceFile);
  const interfaceKeyword = children.find(
    (c) => c.kind === ts.SyntaxKind.InterfaceKeyword
  )!;
  const openBrace = children.find(
    (c) => c.kind === ts.SyntaxKind.OpenBraceToken
  )!;
  const closeBrace = children.find(
    (c) => c.kind === ts.SyntaxKind.CloseBraceToken
  )!;

  const nodeStart = node.getStart(sourceFile);

  // Everything before `interface` keyword (preserves export, declare, etc.)
  const prefix = source.slice(nodeStart, interfaceKeyword.getStart(sourceFile));

  // Name and type parameters: text between `interface` and extends clause or `{`
  const hasHeritageClauses =
    node.heritageClauses && node.heritageClauses.length > 0;
  const nameRegionEnd = hasHeritageClauses
    ? node.heritageClauses![0].getStart(sourceFile)
    : openBrace.getStart(sourceFile);
  const nameAndTypeParams = source
    .slice(interfaceKeyword.getEnd(), nameRegionEnd)
    .trimEnd();

  // Build extends intersection parts
  const extendsParts: string[] = [];
  if (hasHeritageClauses) {
    for (const clause of node.heritageClauses!) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        for (const type of clause.types) {
          extendsParts.push(type.getText(sourceFile));
        }
      }
    }
  }

  // Body from { to } inclusive (preserves interior whitespace)
  const body = source.slice(
    openBrace.getStart(sourceFile),
    closeBrace.getEnd()
  );

  const extendsIntersection =
    extendsParts.length > 0 ? `${extendsParts.join(' & ')} & ` : '';

  return `${prefix}type${nameAndTypeParams} = ${extendsIntersection}${body};`;
}
