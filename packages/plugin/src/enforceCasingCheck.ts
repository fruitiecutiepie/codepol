import path from 'node:path';
import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
  PolicyFixSuggestion,
  PolicyWorkspaceEdit,
  ProjectIndex,
  ImportBindingRelation,
  SymbolKind,
  SymbolRecord,
} from '@codepol/core';
import {
  casingStylesDescribe,
  nameMatchesAnyCasingStyle,
  type CasingStyleName,
} from './lib/casingConvention';
import { importBindingIsTypeOnly } from './lib/importBindingTypeOnly';
import { enforceCasingReplacements } from './enforceCasingFix';

const utf8ByteLength = (s: string): number =>
  new TextEncoder().encode(s).length;

/**
 * Per-symbol-kind allowed casing styles. Omitted kinds are not checked.
 */
export type EnforceCasingSymbolsArgs = Partial<
  Record<
    | 'class'
    | 'interface'
    | 'type'
    | 'function'
    | 'method'
    | 'variable'
    | 'const'
    | 'field'
    | 'parameter'
    | 'enum'
    | 'enumMember',
    CasingStyleName[]
  >
>;

export type EnforceCasingPathsArgs = {
  file?: CasingStyleName[];
  directory?: CasingStyleName[];
  /** default: true */
  ignoreExtensions?: boolean;
  /** default: true */
  checkFiles?: boolean;
  /** default: true */
  checkDirectories?: boolean;
};

export type EnforceCasingArgs = {
  symbols?: EnforceCasingSymbolsArgs;
  paths?: EnforceCasingPathsArgs;
};

const ENFORCEABLE_SYMBOL_KINDS = new Set<keyof EnforceCasingSymbolsArgs>([
  'class',
  'interface',
  'type',
  'function',
  'method',
  'variable',
  'const',
  'field',
  'parameter',
  'enum',
  'enumMember',
]);

function isEnforceableSymbolKind(
  kind: SymbolKind,
): kind is keyof EnforceCasingSymbolsArgs {
  return ENFORCEABLE_SYMBOL_KINDS.has(
    kind as keyof EnforceCasingSymbolsArgs,
  );
}

function byteOffsetToLineColumn(
  source: string,
  byteOffset: number,
): { line: number; column: number } {
  const safeOffset = Math.min(byteOffset, source.length);
  const textBefore = source.slice(0, safeOffset);
  const lines = textBefore.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

type PathSegment = {
  value: string;
  kind: 'file' | 'directory';
};

function pathSegmentsExtract(filePath: string, cwd: string): PathSegment[] {
  const relativePath = path.relative(cwd, filePath);
  const rawSegments = relativePath.split(/[\\/]+/).filter(Boolean);

  if (rawSegments.length === 0) {
    return [];
  }

  const fileSegment = rawSegments[rawSegments.length - 1];
  if (!fileSegment) {
    return [];
  }

  const directories = rawSegments.slice(0, -1).map((segment) => ({
    value: segment,
    kind: 'directory' as const,
  }));

  return [...directories, { value: fileSegment, kind: 'file' as const }];
}

function symbolViolationMessage(
  sym: SymbolRecord,
  allowed: CasingStyleName[],
  kindLabel?: string,
): string {
  const label = kindLabel ?? sym.kind;
  return `Symbol '${sym.name}' (${label}) must match one of: ${casingStylesDescribe(allowed)}`;
}

type SymbolAllowedStyles = {
  allowed: CasingStyleName[];
  kindLabel: string;
  renameStrategy: 'symbol' | 'importAlias';
};

function importBindingIsExplicitAlias(
  binding: ImportBindingRelation,
  localName: string,
): boolean {
  return (
    !binding.isDefault &&
    !binding.isNamespace &&
    binding.importedNameByteRange !== undefined &&
    binding.importedName !== localName
  );
}

/**
 * Import bindings are indexed as `variable`, but this rule only checks
 * explicit local aliases.
 * - `import { Foo as local_name }` → use the resolved export kind
 * - `import type { Foo as local_name }` → use `[rules.args.symbols].type`
 * Plain imports, default imports, and namespace imports are skipped.
 */
function symbolAllowedStylesGet(
  sym: SymbolRecord,
  projectIndex: ProjectIndex,
  source: string,
  symbolsConfig: EnforceCasingSymbolsArgs,
): SymbolAllowedStyles | undefined {
  const binding = projectIndex.importBindingGetForSymbol(sym.id);
  if (binding || sym.binding?.bindingKind === 'import') {
    if (!binding || !importBindingIsExplicitAlias(binding, sym.name)) {
      return undefined;
    }

    if (importBindingIsTypeOnly(source, sym.byteRange.start)) {
      const forTypeImport = symbolsConfig.type;
      if (forTypeImport && forTypeImport.length > 0) {
        return {
          allowed: forTypeImport,
          kindLabel: 'type import',
          renameStrategy: 'importAlias',
        };
      }
      return undefined;
    }

    if (binding.resolvedExportId) {
      const remote = projectIndex.symbolGet(binding.resolvedExportId);
      if (remote && isEnforceableSymbolKind(remote.kind)) {
        const forRemoteKind = symbolsConfig[remote.kind];
        if (forRemoteKind && forRemoteKind.length > 0) {
          return {
            allowed: forRemoteKind,
            kindLabel: remote.kind,
            renameStrategy: 'importAlias',
          };
        }
      }
    }

    return undefined;
  }

  if (!isEnforceableSymbolKind(sym.kind)) {
    return undefined;
  }
  const allowed = symbolsConfig[sym.kind];
  if (!allowed || allowed.length === 0) {
    return undefined;
  }
  return { allowed, kindLabel: sym.kind, renameStrategy: 'symbol' };
}

function pathViolationMessage(
  segmentKind: 'file' | 'directory',
  segmentName: string,
  allowed: CasingStyleName[],
): string {
  const label = segmentKind === 'file' ? 'File' : 'Directory';
  return `${label} name '${segmentName}' must match one of: ${casingStylesDescribe(allowed)}`;
}

function argsHasWork(args: EnforceCasingArgs | undefined): boolean {
  if (!args) {
    return false;
  }
  const sym = args.symbols;
  if (sym) {
    for (const styles of Object.values(sym)) {
      if (Array.isArray(styles) && styles.length > 0) {
        return true;
      }
    }
  }
  const p = args.paths;
  if (p) {
    if (p.file && p.file.length > 0) {
      return true;
    }
    if (p.directory && p.directory.length > 0) {
      return true;
    }
  }
  return false;
}

function workspaceEditKey(edit: PolicyWorkspaceEdit): string {
  return `${edit.filePath}:${edit.byteRange.start}:${edit.byteRange.end}:${edit.text}`;
}

function workspaceEditsDedupe(
  edits: PolicyWorkspaceEdit[],
): PolicyWorkspaceEdit[] {
  const seen = new Set<string>();
  return edits.filter((edit) => {
    const key = workspaceEditKey(edit);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function referenceNameMatchesRenameTarget(
  referenceName: string,
  symbolName: string,
): boolean {
  return (
    referenceName === symbolName ||
    referenceName.endsWith(`.${symbolName}`)
  );
}

function importBindingRenameEditGet(
  projectIndex: ProjectIndex,
  bindingSymbolId: string,
  importedNameByteRange:
    | { start: number; end: number }
    | undefined,
  importedName: string,
  nextName: string,
): PolicyWorkspaceEdit | undefined {
  const localSymbol = projectIndex.symbolGet(bindingSymbolId);
  if (!localSymbol) {
    return undefined;
  }

  const byteRange =
    importedNameByteRange ??
    (localSymbol.name === importedName ? localSymbol.byteRange : undefined);
  if (!byteRange) {
    return undefined;
  }

  return {
    filePath: localSymbol.file,
    byteRange,
    text: nextName,
  };
}

function importAliasWorkspaceEditsCreate(
  sym: SymbolRecord,
  nextName: string,
  declarationByteRange: { start: number; end: number },
  projectIndex: ProjectIndex,
): PolicyWorkspaceEdit[] {
  const edits: PolicyWorkspaceEdit[] = [
    {
      filePath: sym.file,
      byteRange: declarationByteRange,
      text: nextName,
    },
  ];

  for (const ref of projectIndex.referencesInFileGet(sym.file)) {
    if (ref.localSymbolId !== sym.id) {
      continue;
    }
    if (!referenceNameMatchesRenameTarget(ref.name, sym.name)) {
      continue;
    }
    const scope = projectIndex.scopeGet(ref.scopeId);
    if (!scope || scope.file !== sym.file) {
      continue;
    }
    edits.push({
      filePath: scope.file,
      byteRange: ref.byteRange,
      text: nextName,
    });
  }

  return workspaceEditsDedupe(edits);
}

function symbolWorkspaceEditsCreate(
  sym: SymbolRecord,
  nextName: string,
  declarationByteRange: { start: number; end: number },
  projectIndex: ProjectIndex,
): PolicyWorkspaceEdit[] {
  const edits: PolicyWorkspaceEdit[] = [
    {
      filePath: sym.file,
      byteRange: declarationByteRange,
      text: nextName,
    },
  ];

  for (const ref of projectIndex.referencesGet(sym.id)) {
    if (!referenceNameMatchesRenameTarget(ref.name, sym.name)) {
      continue;
    }
    const scope = projectIndex.scopeGet(ref.scopeId);
    if (!scope) {
      continue;
    }
    edits.push({
      filePath: scope.file,
      byteRange: ref.byteRange,
      text: nextName,
    });
  }

  for (const indexedFile of projectIndex.filesGet()) {
    for (const binding of projectIndex.importBindingsGet(indexedFile)) {
      if (
        binding.resolvedExportId !== sym.id ||
        binding.isDefault ||
        binding.isNamespace ||
        binding.importedName !== sym.name
      ) {
        continue;
      }
      const edit = importBindingRenameEditGet(
        projectIndex,
        binding.localSymbolId,
        binding.importedNameByteRange,
        binding.importedName,
        nextName,
      );
      if (edit) {
        edits.push(edit);
      }
    }
  }

  return workspaceEditsDedupe(edits);
}

function symbolWorkspaceEditsForStrategyCreate(
  sym: SymbolRecord,
  nextName: string,
  declarationByteRange: { start: number; end: number },
  projectIndex: ProjectIndex,
  renameStrategy: SymbolAllowedStyles['renameStrategy'],
): PolicyWorkspaceEdit[] {
  if (renameStrategy === 'importAlias') {
    return importAliasWorkspaceEditsCreate(
      sym,
      nextName,
      declarationByteRange,
      projectIndex,
    );
  }

  return symbolWorkspaceEditsCreate(
    sym,
    nextName,
    declarationByteRange,
    projectIndex,
  );
}

export function enforceCasingCheck(
  rule: PolicyRule,
  context: PolicyCheckContext,
): PolicyViolation[] {
  const args = context.ruleArgs as EnforceCasingArgs | undefined;
  if (!argsHasWork(args)) {
    return [];
  }

  const violations: PolicyViolation[] = [];
  const { projectIndex, source, filePath, dir } = context;

  const symbolsConfig = args!.symbols;
  const pathsConfig = args!.paths;

  if (symbolsConfig && projectIndex) {
    const symbols = projectIndex.symbolsInFileGet(filePath);
    for (const sym of symbols) {
      const resolved = symbolAllowedStylesGet(
        sym,
        projectIndex,
        source,
        symbolsConfig,
      );
      if (!resolved) {
        continue;
      }
      const { allowed, kindLabel, renameStrategy } = resolved;
      if (nameMatchesAnyCasingStyle(sym.name, allowed)) {
        continue;
      }

      let offset = sym.byteRange.start;
      let idText = sym.name;
      const searchSpace = source.slice(offset, sym.byteRange.end);
      const escapedName = sym.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`\\b${escapedName}\\b`).exec(searchSpace);
      if (match) {
        offset += match.index;
        idText = match[0];
      } else {
        const fallbackIndex = source.indexOf(sym.name, offset);
        if (fallbackIndex !== -1 && fallbackIndex <= sym.byteRange.end) {
          offset = fallbackIndex;
          idText = sym.name;
        }
      }

      const { line, column } = byteOffsetToLineColumn(
        source,
        offset,
      );

      const replacements = enforceCasingReplacements(sym.name, allowed);
      const byteEnd = offset + utf8ByteLength(idText);

      let fix = undefined;
      let suggestions: PolicyFixSuggestion[] | undefined = undefined;
      if (replacements.length > 0) {
        if (allowed.length === 1 || replacements.length === 1) {
          const r = replacements[0]!;
          const primaryByteRange = { start: offset, end: byteEnd };
          fix = {
            byteRange: primaryByteRange,
            text: r.text,
            edits: symbolWorkspaceEditsForStrategyCreate(
              sym,
              r.text,
              primaryByteRange,
              projectIndex,
              renameStrategy,
            ),
          };
        } else {
          suggestions = replacements.map((r) => ({
            message: `Rename to ${r.style}: ${r.text}`,
            fix: {
              byteRange: { start: offset, end: byteEnd },
              text: r.text,
              edits: symbolWorkspaceEditsForStrategyCreate(
                sym,
                r.text,
                { start: offset, end: byteEnd },
                projectIndex,
                renameStrategy,
              ),
            },
          }));
        }
      }

      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath,
        message: symbolViolationMessage(sym, allowed, kindLabel),
        line,
        column,
        ...(fix ? { fix } : {}),
        ...(suggestions ? { suggestions } : {}),
      });
    }
  }

  if (pathsConfig) {
    const fileAllowed = pathsConfig.file;
    const dirAllowed = pathsConfig.directory;
    const checkFiles = pathsConfig.checkFiles ?? true;
    const checkDirectories = pathsConfig.checkDirectories ?? true;
    const ignoreExtensions = pathsConfig.ignoreExtensions ?? true;

    const segments = pathSegmentsExtract(filePath, dir);

    for (const segment of segments) {
      if (segment.kind === 'file' && !checkFiles) {
        continue;
      }
      if (segment.kind === 'directory' && !checkDirectories) {
        continue;
      }

      const allowed =
        segment.kind === 'file' ? fileAllowed : dirAllowed;
      if (!allowed || allowed.length === 0) {
        continue;
      }

      const segmentName =
        segment.kind === 'file' && ignoreExtensions
          ? path.parse(segment.value).name
          : segment.value;

      if (!segmentName) {
        continue;
      }

      if (nameMatchesAnyCasingStyle(segmentName, allowed)) {
        continue;
      }

      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath,
        message: pathViolationMessage(segment.kind, segmentName, allowed),
        line: 1,
        column: 1,
      });
    }
  }

  return violations;
}
