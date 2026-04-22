/**
 * @packageDocumentation
 * Architecture check that flags classes which satisfy an interface
 * by shape (Phase 9.4 cross-file member-shape comparison) but do not
 * declare an `implements` clause for it.
 *
 * Catches the "accidental implementer" failure mode — a class whose
 * public surface happens to match an interface used elsewhere in the
 * codebase. Without this rule the architecture graph silently treats
 * the class as a participant in the interface contract, which makes
 * future renames and signature changes ripple in ways the author did
 * not consent to.
 *
 * The rule is opt-in via `[[rules]]` in `codepol.toml`. Defaults
 * scan every interface; narrow scope with `args.interfaces` (glob
 * patterns matched against interface names) and exempt implementer
 * classes with `args.ignoreImplementers` or implementer files with
 * `args.ignore`.
 */

import path from 'node:path';
import { minimatch } from 'minimatch';
import type {
  ArchitectureCheckContext,
  ArchitectureCheckFn,
  PolicyDiagnosticLocation,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';

/**
 * Configurable arguments for the `no-undeclared-implementer`
 * architecture rule.
 *
 * - `interfaces`: glob patterns matched against interface symbol
 *   names. Only interfaces whose name matches at least one pattern
 *   produce violations. Default: every interface in the index.
 * - `ignore`: glob patterns (relative to the policy `cwd`) for
 *   implementer files to exempt. A class declared in a matching
 *   file never triggers a violation, even if it shape-matches a
 *   monitored interface.
 * - `ignoreImplementers`: glob patterns matched against implementer
 *   class names. Useful for naming-convention-based opt-outs (e.g.
 *   `*Mock`, `*Stub`, `Test*`) where the structural match is
 *   intentional.
 */
export type NoUndeclaredImplementerArgs = {
  interfaces?: string[];
  ignore?: string[];
  ignoreImplementers?: string[];
};

function nameMatchesAny(globs: string[] | undefined, name: string): boolean {
  if (!globs || globs.length === 0) return false;
  return globs.some((pattern) => minimatch(name, pattern, { dot: true }));
}

function fileMatchesAny(
  globs: string[] | undefined,
  cwd: string,
  file: string,
): boolean {
  if (!globs || globs.length === 0) return false;
  const relative = path.relative(cwd, file);
  return globs.some((pattern) => minimatch(relative, pattern, { dot: true }));
}

function undeclaredImplementerMessage(
  contractFile: string,
  implementerName: string,
  contractName: string,
): string {
  if (path.extname(contractFile) === '.py' || path.extname(contractFile) === '.pyw') {
    return (
      `Class \`${implementerName}\` satisfies protocol ` +
      `\`${contractName}\` by shape only. Inherit from \`${contractName}\` ` +
      `to make the relationship explicit, or rename a member to break ` +
      `the accidental match.`
    );
  }
  return (
    `Class \`${implementerName}\` satisfies interface ` +
    `\`${contractName}\` by shape only. Add \`implements ${contractName}\` ` +
    `to make the relationship explicit, or rename a member to break ` +
    `the accidental match.`
  );
}

/**
 * The check function. Walks every interface symbol in the index,
 * pulls its full subtype set via `subTypesGet({ confidence: 'all' })`,
 * and emits a violation per implementer whose relationship is
 * structural-shape only (no declared `implements`).
 */
export const noUndeclaredImplementerCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  const args = (context.ruleArgs as NoUndeclaredImplementerArgs | undefined) ?? {};
  const ruleId = rule.id || rule.ruleId;

  // Default: monitor every interface. When the user passes an
  // explicit `interfaces` glob list, only matching names produce
  // violations — useful when a workspace has many internal
  // interfaces and policy only wants to enforce the rule on the
  // "public contract" subset.
  const interfaceFilter = args.interfaces;
  const wantsAllInterfaces = !interfaceFilter || interfaceFilter.length === 0;

  const violations: PolicyViolation[] = [];

  // Iterate every interface symbol in the index. Type-alias-of-object
  // owners also produce shape relations (Phase 9.4) but the rule
  // intentionally focuses on `interface` declarations — they're the
  // standard contract surface and the ones whose accidental
  // satisfaction is most surprising to authors.
  const interfaceSymbols = context.projectIndex.symbolsGet({ kind: 'interface' });

  // Sort by symbol id so violation ordering is deterministic across
  // runs over byte-identical input.
  const sortedInterfaces = [...interfaceSymbols].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  for (const iface of sortedInterfaces) {
    if (!wantsAllInterfaces && !nameMatchesAny(interfaceFilter, iface.name)) {
      continue;
    }

    const allSubtypes = context.projectIndex.subTypesGet(iface.id, {
      confidence: 'all',
    });
    if (allSubtypes.length === 0) continue;

    // Filter to structural-shape relations only. Declared
    // `implements` and `extends` are by definition fine — that's
    // the whole point of the rule.
    for (const relation of allSubtypes) {
      if (relation.confidence !== 'structural-shape') continue;

      const implementerSymbol = context.projectIndex.symbolGet(relation.symbolId);
      if (!implementerSymbol) continue;

      if (
        fileMatchesAny(args.ignore, context.cwd, implementerSymbol.file)
      ) {
        continue;
      }
      if (nameMatchesAny(args.ignoreImplementers, implementerSymbol.name)) {
        continue;
      }

      const related: PolicyDiagnosticLocation[] = [
        {
          filePath: iface.file,
          line: 1,
          column: 1,
          message:
            path.extname(iface.file) === '.py' || path.extname(iface.file) === '.pyw'
              ? 'protocol declaration'
              : 'interface declaration',
        },
      ];
      violations.push({
        ruleId,
        filePath: implementerSymbol.file,
        message: undeclaredImplementerMessage(
          iface.file,
          implementerSymbol.name,
          iface.name,
        ),
        line: 1,
        column: 1,
        relatedLocations: related,
      });
    }
  }

  return violations;
};
