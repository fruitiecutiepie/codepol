/**
 * @packageDocumentation
 * Architecture check that enforces a per-file fan-out (importee count)
 * budget. A high fan-out count signals a file that pulls in too many
 * collaborators, often a sign of a missing abstraction layer.
 *
 * One violation is emitted per file whose importee count strictly
 * exceeds {@link MaxFanOutArgs.max}.
 */

import type {
  ArchitectureCheckFn,
  PolicyRule,
  PolicyViolation,
  ArchitectureCheckContext,
} from '@codepol/core';
import { maxFanViolationsCompute, type MaxFanArgs } from './lib/maxFanShared';

export type MaxFanOutArgs = MaxFanArgs;

/**
 * The check function. Iterates every indexed file (filtered by the
 * optional `files` glob), counts importees via the module graph, and
 * reports each file whose count exceeds `args.max`.
 */
export const maxFanOutCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  return maxFanViolationsCompute(rule, context, {
    direction: 'out',
    neighborsGet: (file) => context.moduleGraph.moduleGraphImporteesGet(file),
  });
};
