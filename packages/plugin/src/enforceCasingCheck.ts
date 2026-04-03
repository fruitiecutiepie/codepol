import path from 'node:path';
import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
  SymbolKind,
  SymbolRecord,
} from '@codepol/core';
import {
  casingStylesDescribe,
  nameMatchesAnyCasingStyle,
  type CasingStyleName,
} from './lib/casingConvention';

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
): string {
  return `Symbol '${sym.name}' (${sym.kind}) must match one of: ${casingStylesDescribe(allowed)}`;
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
      if (!isEnforceableSymbolKind(sym.kind)) {
        continue;
      }
      const allowed = symbolsConfig[sym.kind];
      if (!allowed || allowed.length === 0) {
        continue;
      }
      if (nameMatchesAnyCasingStyle(sym.name, allowed)) {
        continue;
      }
      const { line, column } = byteOffsetToLineColumn(
        source,
        sym.byteRange.start,
      );
      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath,
        message: symbolViolationMessage(sym, allowed),
        line,
        column,
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
