/**
 * @packageDocumentation
 * Architecture check that enforces a per-file fan-in (importer count)
 * budget. A high fan-in count signals a "god module" — many parts of
 * the codebase depend on it, which makes changes risky and slow.
 *
 * One violation is emitted per file whose importer count strictly
 * exceeds {@link MaxFanInArgs.max}. Use the optional `files` glob to
 * scope the budget to a subset of the codebase (e.g. only `src/lib/**`).
 */

import type {
  ArchitectureCheckFn,
  PolicyRule,
  PolicyViolation,
  ArchitectureCheckContext,
} from '@codepol/core';
import { maxFanViolationsCompute, type MaxFanArgs } from './lib/maxFanShared';

export type MaxFanInArgs = MaxFanArgs;

/**
 * The check function. Iterates every indexed file (filtered by the
 * optional `files` glob), counts importers via the module graph, and
 * reports each file whose count exceeds `args.max`.
 */
export const maxFanInCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  return maxFanViolationsCompute(rule, context, {
    direction: 'in',
    neighborsGet: (file) => context.moduleGraph.moduleGraphImportersGet(file),
  });
};
