import type { PolicyViolation } from '@codepol/core';
import ts from 'typescript';

type IdentifierType = 'function' | 'variable' | 'type';

export type ExportMatch = {
  name: string;
  identifierType: IdentifierType;
  filePath: string;
  line: number;
  column: number;
  isReexport: boolean;
};

export type NoDuplicateExportsArgs = {
  identifierTypes?: IdentifierType[];
  includeReexports?: boolean;
};

export type FileSource = {
  filePath: string;
  source: string;
};

/**
 * Check if a node has the export modifier.
 */
function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/**
 * Extract all exports from a TypeScript source file.
 */
export function exportMatchesGetFromTSSourceFile(
  source: string,
  filePath: string,
  includeReexports: boolean = false
): ExportMatch[] {
  const exports: ExportMatch[] = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true
  );

  function addExport(
    name: string,
    identifierType: IdentifierType,
    node: ts.Node,
    isReexport: boolean = false
  ) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart()
    );
    exports.push({
      name,
      identifierType,
      filePath,
      line: line + 1,
      column: character + 1,
      isReexport,
    });
  }

  function visit(node: ts.Node) {
    // Export function declaration: export function foo() {}
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      addExport(node.name.text, 'function', node.name);
    }

    // Export variable declaration: export const foo = ...
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          // Determine if it's a function or variable
          const identifierType: IdentifierType =
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
              ? 'function'
              : 'variable';
          addExport(declaration.name.text, identifierType, declaration.name);
        }
      }
    }

    // Export type alias: export type Foo = ...
    if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
      addExport(node.name.text, 'type', node.name);
    }

    // Export interface: export interface Foo {}
    if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
      addExport(node.name.text, 'type', node.name);
    }

    // Export class: export class Foo {}
    if (ts.isClassDeclaration(node) && node.name && hasExportModifier(node)) {
      addExport(node.name.text, 'type', node.name);
    }

    // Export enum: export enum Foo {}
    if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
      addExport(node.name.text, 'type', node.name);
    }

    // Re-exports: export { foo } from './other' or export { foo as bar } from './other'
    if (includeReexports && ts.isExportDeclaration(node)) {
      // Only handle named re-exports (not export * from)
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          // Use the exported name (could be aliased via 'as')
          const exportedName = element.name.text;
          // We don't know the type from a re-export, so default to 'variable'
          // The duplicate check will match by name across all types anyway
          addExport(exportedName, 'variable', element.name, true);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

/**
 * Build the set of identifier types to check based on args.
 */
export function identifierTypesToCheck(
  args: NoDuplicateExportsArgs | undefined
): Set<IdentifierType> {
  if (!args?.identifierTypes || args.identifierTypes.length === 0) {
    // Default: check all types
    return new Set(['function', 'variable', 'type']);
  }
  return new Set(args.identifierTypes);
}

/**
 * Detect duplicate exports across multiple files.
 */
export function duplicateExportsDetect(
  allExports: ExportMatch[],
  args: NoDuplicateExportsArgs | undefined,
  ruleId: string = 'no-duplicate-exports'
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const typesToCheck = identifierTypesToCheck(args);
  const includeReexports = args?.includeReexports ?? false;

  // Filter exports based on configuration
  const filteredExports = allExports.filter((exp) => {
    if (!typesToCheck.has(exp.identifierType)) return false;
    if (!includeReexports && exp.isReexport) return false;
    return true;
  });

  // Group exports by name
  const exportsByName = new Map<string, ExportMatch[]>();
  for (const exp of filteredExports) {
    const existing = exportsByName.get(exp.name) ?? [];
    existing.push(exp);
    exportsByName.set(exp.name, existing);
  }

  // Report duplicates (flag all but the first occurrence)
  for (const [name, exps] of exportsByName) {
    if (exps.length > 1) {
      // Sort by file path for deterministic ordering
      exps.sort((a, b) => a.filePath.localeCompare(b.filePath));
      const firstExport = exps[0];

      for (let i = 1; i < exps.length; i++) {
        const duplicate = exps[i];
        violations.push({
          ruleId,
          filePath: duplicate.filePath,
          message: `'${name}' is already exported from '${firstExport.filePath}'`,
          line: duplicate.line,
          column: duplicate.column,
        });
      }
    }
  }

  return violations;
}

/**
 * Main check function: extract exports from all files and detect duplicates.
 */
export function noDuplicateExportsCheck(
  files: FileSource[],
  args: NoDuplicateExportsArgs | undefined,
  ruleId: string = 'no-duplicate-exports'
): PolicyViolation[] {
  const includeReexports = args?.includeReexports ?? false;

  // Collect all exports from all files
  const allExports: ExportMatch[] = [];
  for (const file of files) {
    const fileExports = exportMatchesGetFromTSSourceFile(file.source, file.filePath, includeReexports);
    allExports.push(...fileExports);
  }

  // Detect and return duplicates
  return duplicateExportsDetect(allExports, args, ruleId);
}
