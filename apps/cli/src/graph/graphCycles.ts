/**
 * `codepol graph cycles` — list module-graph cycles for CI gating.
 *
 * JSON payload shape:
 *
 *   { cycles: string[][], truncated: boolean }
 *
 * Cycles are sorted deterministically by `(-size, first member)` so
 * identical workspaces produce identical output across machines. Exits
 * with code 1 when any cycle is found so `codepol graph cycles` can gate
 * PRs without extra flags.
 */
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphCyclesOptions = {
  cwd: string;
  configPath: string;
  format: string | undefined;
  max?: number;
};

function cyclesSortDeterministic(cycles: string[][]): string[][] {
  const copies = cycles.map((cycle) => [...cycle]);
  for (const cycle of copies) {
    cycle.sort();
  }
  return copies
    .map((cycle): { cycle: string[]; size: number; head: string } => ({
      cycle,
      size: cycle.length,
      head: cycle[0] ?? '',
    }))
    .sort((left, right) => {
      if (left.size !== right.size) return right.size - left.size;
      return left.head < right.head ? -1 : left.head > right.head ? 1 : 0;
    })
    .map((entry) => entry.cycle);
}

export async function graphCyclesRun(options: GraphCyclesOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);
  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const result = await session.service.queryDependencyGraph({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
    });
    const allCycles = cyclesSortDeterministic(result.cycles);
    const limit = options.max !== undefined && options.max > 0 ? options.max : allCycles.length;
    const truncated = allCycles.length > limit;
    const cycles = truncated ? allCycles.slice(0, limit) : allCycles;

    if (format === 'json') {
      console.log(graphJsonStringify({ cycles, truncated }));
    } else {
      if (cycles.length === 0) {
        console.log('No cycles detected');
      } else {
        for (let index = 0; index < cycles.length; index += 1) {
          const cycle = cycles[index];
          if (!cycle) continue;
          console.log(`Cycle ${index + 1} (size ${cycle.length}):`);
          for (const member of cycle) {
            console.log(`  ${member}`);
          }
        }
        if (truncated) {
          console.log(`... ${allCycles.length - cycles.length} more cycle(s) omitted`);
        }
      }
    }

    return allCycles.length === 0 ? 0 : 1;
  } finally {
    await session.close();
  }
}
