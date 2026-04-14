import type { PolicyViolation } from '@codepol/core';
import {
  exportMatchesGetFromSource,
  type ExportMatch,
  type IdentifierType,
} from './lib/moduleSyntax';

export type { ExportMatch } from './lib/moduleSyntax';

export type NoDuplicateExportsArgs = {
  identifierTypes?: IdentifierType[];
  includeReexports?: boolean;
};

export type FileSource = {
  filePath: string;
  source: string;
};

/**
 * Extract all exports from a TypeScript source file.
 */
export function exportMatchesGetFromTSSourceFile(
  source: string,
  filePath: string,
  includeReexports: boolean = false
): ExportMatch[] {
  return exportMatchesGetFromSource(source, filePath, includeReexports);
}

/**
 * Build the set of identifier types to check based on args.
 */
export function identifierTypesToCheck(
  args: NoDuplicateExportsArgs | undefined
): Set<IdentifierType> {
  if (!args?.identifierTypes || args.identifierTypes.length === 0) {
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

  const filteredExports = allExports.filter((exp) => {
    if (!typesToCheck.has(exp.identifierType)) return false;
    if (!includeReexports && exp.isReexport) return false;
    return true;
  });

  const exportsByName = new Map<string, ExportMatch[]>();
  for (const exp of filteredExports) {
    const existing = exportsByName.get(exp.name) ?? [];
    existing.push(exp);
    exportsByName.set(exp.name, existing);
  }

  for (const [name, exps] of exportsByName) {
    if (exps.length <= 1) {
      continue;
    }

    exps.sort((a, b) => a.filePath.localeCompare(b.filePath));
    const firstExport = exps[0]!;

    for (let index = 1; index < exps.length; index++) {
      const duplicate = exps[index]!;
      violations.push({
        ruleId,
        filePath: duplicate.filePath,
        message: `'${name}' is already exported from '${firstExport.filePath}'`,
        line: duplicate.line,
        column: duplicate.column,
      });
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
  const allExports: ExportMatch[] = [];

  for (const file of files) {
    allExports.push(
      ...exportMatchesGetFromTSSourceFile(
        file.source,
        file.filePath,
        includeReexports,
      ),
    );
  }

  return duplicateExportsDetect(allExports, args, ruleId);
}
