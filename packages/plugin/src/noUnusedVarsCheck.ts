import type {
  PolicyCheckContext,
  PolicyRule,
  PolicyViolation,
  ProjectIndex,
  ReferencesRelation,
  SymbolRecord,
} from '@codepol/core';
import { ReferenceUsage, SymbolFlags } from '@codepol/core';
import { noUnusedVarsViolationFixGet } from './noUnusedVarsFix';

export type NoUnusedVarsArgs = {
  args?: 'after-used' | 'all' | 'none';
  argsIgnorePattern?: string;
  caughtErrors?: 'all' | 'none';
  caughtErrorsIgnorePattern?: string;
  destructuredArrayIgnorePattern?: string;
  ignoreRestSiblings?: boolean;
  reportUsedIgnorePattern?: boolean;
  vars?: 'all' | 'local';
  varsIgnorePattern?: string;
};

type UsageFacts = {
  hasAssignedValue: boolean;
  hasRuntimeRead: boolean;
  hasTypeRead: boolean;
  hasEffectiveUse: boolean;
};

type IgnoreMatchKind = 'args' | 'array' | 'caught errors' | 'vars';

type IgnoreMatch = {
  kind: IgnoreMatchKind;
  regex: RegExp;
};

function offsetToLineColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
  const safeOffset = Math.min(Math.max(offset, 0), source.length);
  const textBefore = source.slice(0, safeOffset);
  const lines = textBefore.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

function regexFromPattern(pattern?: string): RegExp | undefined {
  if (!pattern) return undefined;
  return new RegExp(pattern, 'u');
}

function symbolRefsGet(
  projectIndex: ProjectIndex,
  symbol: SymbolRecord,
): ReferencesRelation[] {
  return projectIndex.referencesInFileGet(symbol.file).filter((ref) =>
    ref.resolvedSymbolId === symbol.id || ref.localSymbolId === symbol.id
  );
}

function symbolShouldCheck(
  projectIndex: ProjectIndex,
  symbol: SymbolRecord,
): boolean {
  if (symbol.binding?.bindingKind === 'function-expression-name') {
    return false;
  }

  if ((symbol.flags & SymbolFlags.Exported) !== 0) {
    return false;
  }

  if (projectIndex.exportLocationsGet(symbol.id).length > 0) {
    return false;
  }

  if (symbol.kind === 'field' ||
      symbol.kind === 'method' ||
      symbol.kind === 'enumMember' ||
      symbol.kind === 'namespace') {
    return false;
  }

  return true;
}

function symbolTypeOnlyUseCountsAsUsed(symbol: SymbolRecord): boolean {
  if (symbol.binding?.bindingKind === 'import') {
    return true;
  }

  return symbol.kind === 'class' ||
    symbol.kind === 'enum' ||
    symbol.kind === 'interface' ||
    symbol.kind === 'type';
}

function usageFactsGet(
  symbol: SymbolRecord,
  refs: ReferencesRelation[],
): UsageFacts {
  const hasAssignedValue =
    symbol.binding?.initialized === true ||
    refs.some((ref) => ((ref.usage ?? 0) & ReferenceUsage.Write) !== 0);

  const hasRuntimeRead = refs.some((ref) => {
    const usage = ref.usage ?? 0;
    return (usage & ReferenceUsage.Read) !== 0 &&
      (usage & ReferenceUsage.Type) === 0 &&
      (usage & ReferenceUsage.SelfUpdate) === 0;
  });

  const hasTypeRead = refs.some((ref) => {
    const usage = ref.usage ?? 0;
    return (usage & ReferenceUsage.Type) !== 0 &&
      (usage & ReferenceUsage.SelfUpdate) === 0;
  });

  const hasEffectiveUse =
    hasRuntimeRead ||
    (hasTypeRead && symbolTypeOnlyUseCountsAsUsed(symbol));

  return {
    hasAssignedValue,
    hasRuntimeRead,
    hasTypeRead,
    hasEffectiveUse,
  };
}

function ignoreMatchGet(
  symbol: SymbolRecord,
  args: NoUnusedVarsArgs,
): IgnoreMatch | undefined {
  if (symbol.binding?.pattern === 'array') {
    const regex = regexFromPattern(args.destructuredArrayIgnorePattern);
    if (regex?.test(symbol.name)) {
      return { kind: 'array', regex };
    }
  }

  if (symbol.binding?.bindingKind === 'catch') {
    const regex = regexFromPattern(args.caughtErrorsIgnorePattern);
    if (regex?.test(symbol.name)) {
      return { kind: 'caught errors', regex };
    }
    return undefined;
  }

  if (symbol.kind === 'parameter') {
    const regex = regexFromPattern(args.argsIgnorePattern);
    if (regex?.test(symbol.name)) {
      return { kind: 'args', regex };
    }
    return undefined;
  }

  const regex = regexFromPattern(args.varsIgnorePattern);
  if (regex?.test(symbol.name)) {
    return { kind: 'vars', regex };
  }

  return undefined;
}

function ignoredButUsedMessage(
  symbol: SymbolRecord,
  ignore: IgnoreMatch,
): string {
  const regexLiteral = ignore.regex.toString();

  if (ignore.kind === 'array') {
    return `'${symbol.name}' is marked as ignored but is used. Used elements of array destructuring must not match ${regexLiteral}.`;
  }

  return `'${symbol.name}' is marked as ignored but is used. Used ${ignore.kind} must not match ${regexLiteral}.`;
}

function unusedMessage(
  symbol: SymbolRecord,
  facts: UsageFacts,
): string {
  const verb = facts.hasAssignedValue ? 'assigned a value' : 'defined';
  if (facts.hasTypeRead && !facts.hasRuntimeRead && !symbolTypeOnlyUseCountsAsUsed(symbol)) {
    return `'${symbol.name}' is ${verb} but only used as a type.`;
  }
  return `'${symbol.name}' is ${verb} but never used.`;
}

function parameterLastUsedIndexGet(
  symbols: SymbolRecord[],
  usageBySymbolId: Map<string, UsageFacts>,
): number {
  let lastUsed = -1;

  for (const symbol of symbols) {
    if (symbol.kind !== 'parameter') continue;

    const usage = usageBySymbolId.get(symbol.id);
    const parameterIndex = symbol.binding?.parameterIndex;
    if (!usage?.hasEffectiveUse || parameterIndex == null) continue;

    lastUsed = Math.max(lastUsed, parameterIndex);
  }

  return lastUsed;
}

function symbolLocationGet(
  source: string,
  symbol: SymbolRecord,
): { line: number; column: number; endLine: number; endColumn: number } {
  const range = symbol.byteRange;
  const start = offsetToLineColumn(source, range.start);
  const end = offsetToLineColumn(source, range.end);
  return {
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

export function noUnusedVarsCheck(
  rule: PolicyRule,
  context: PolicyCheckContext,
): PolicyViolation[] {
  const projectIndex = context.projectIndex;
  if (!projectIndex) {
    return [];
  }

  const args: NoUnusedVarsArgs = {
    args: 'after-used',
    caughtErrors: 'all',
    ignoreRestSiblings: false,
    reportUsedIgnorePattern: false,
    vars: 'all',
    ...((context.ruleArgs as NoUnusedVarsArgs | undefined) ?? {}),
  };
  const fileSymbols = projectIndex.symbolsInFileGet(context.filePath)
    .filter((symbol) => symbolShouldCheck(projectIndex, symbol));

  const usageBySymbolId = new Map<string, UsageFacts>();
  for (const symbol of fileSymbols) {
    usageBySymbolId.set(symbol.id, usageFactsGet(symbol, symbolRefsGet(projectIndex, symbol)));
  }

  const lastUsedParameterIndex = parameterLastUsedIndexGet(fileSymbols, usageBySymbolId);
  const violations: PolicyViolation[] = [];

  for (const symbol of fileSymbols) {
    const usage = usageBySymbolId.get(symbol.id);
    if (!usage) continue;

    if (symbol.binding?.hasRestSibling && !symbol.binding?.isRest && args.ignoreRestSiblings) {
      continue;
    }

    if (symbol.binding?.bindingKind === 'catch' && args.caughtErrors === 'none') {
      continue;
    }

    if (symbol.kind === 'parameter') {
      if (args.args === 'none') {
        continue;
      }

      if (args.args === 'after-used') {
        const parameterIndex = symbol.binding?.parameterIndex;
        if (parameterIndex != null && parameterIndex < lastUsedParameterIndex && !usage.hasEffectiveUse) {
          continue;
        }
      }
    }

    const ignore = ignoreMatchGet(symbol, args);
    if (ignore) {
      if (args.reportUsedIgnorePattern && usage.hasEffectiveUse) {
    const loc = symbolLocationGet(context.source, symbol);
    violations.push({
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: ignoredButUsedMessage(symbol, ignore),
      ...loc,
    });
      }
      continue;
    }

    if (usage.hasEffectiveUse) {
      continue;
    }

    const loc = symbolLocationGet(context.source, symbol);
    const fix = noUnusedVarsViolationFixGet(
      context.source,
      context.filePath,
      symbol,
    );
    violations.push({
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: unusedMessage(symbol, usage),
      ...loc,
      ...(fix ? { fix } : {}),
    });
  }

  return violations;
}
