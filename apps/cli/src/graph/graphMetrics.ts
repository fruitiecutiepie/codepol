/**
 * `codepol graph metrics` — emit the Phase 8 architecture health
 * metrics carried on `WorkspaceArchitectureSummaryResult`:
 * `instability`, `longestChain`, `sccSizeDistribution`, and
 * `complexityHotspots`.
 *
 * The JSON output equals the workspace-service result exactly so
 * doc-site widgets, CI bots, and the panel can parse one payload. Text
 * output is grouped, deterministic, and prints `(none)` for missing /
 * empty sections rather than omitting them — that keeps the rendered
 * shape stable for snapshot tests and grep-based CI scripts.
 *
 * `--top <n>` only affects text output; it caps the instability and
 * complexity-hotspot sections so terminals do not get flooded on
 * monorepos. `--fail-on-cycle` exits non-zero whenever the workspace
 * has any cycle so CI gates can use this command without re-shelling
 * `codepol graph cycles`.
 */
import type { WorkspaceArchitectureSummaryResult } from '@codepol/core';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphMetricsOptions = {
  cwd: string;
  configPath: string;
  format: string | undefined;
  top?: number;
  failOnCycle?: boolean;
};

/**
 * Default top-N caps for text output. Match the workspace-service
 * payload caps so the text rendering never silently drops rows that the
 * JSON consumer would have seen.
 */
const GRAPH_METRICS_TEXT_INSTABILITY_TOP_N_DEFAULT = 10;
const GRAPH_METRICS_TEXT_COMPLEXITY_TOP_N_DEFAULT = 5;

export async function graphMetricsRun(options: GraphMetricsOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);
  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const summary = await session.service.queryArchitectureSummary({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
    });

    if (format === 'json') {
      console.log(graphJsonStringify(summary));
    } else {
      console.log(graphMetricsTextRender(summary, options.top));
    }

    if (options.failOnCycle && graphMetricsHasCycle(summary)) {
      return 1;
    }
    return 0;
  } finally {
    await session.close();
  }
}

/**
 * Whether the workspace has at least one cycle. Read off
 * `cycleCount` (always present) so the gate works even when the
 * workspace service omits the optional `sccSizeDistribution`.
 */
function graphMetricsHasCycle(summary: WorkspaceArchitectureSummaryResult): boolean {
  if (summary.cycleCount > 0) return true;
  if (summary.sccSizeDistribution) {
    for (const count of Object.values(summary.sccSizeDistribution)) {
      if (count > 0) return true;
    }
  }
  return false;
}

/**
 * Pure text renderer for the metrics summary. Section headers are
 * always emitted even when the underlying field is absent; missing
 * values render as `(none)` so CI scripts can grep for a stable shape.
 */
export function graphMetricsTextRender(
  summary: WorkspaceArchitectureSummaryResult,
  topOverride?: number,
): string {
  const lines: string[] = [];
  lines.push(
    `Indexed files: ${summary.indexedFileCount}` +
      `\tSymbols: ${summary.symbolCount}` +
      `\tCycles: ${summary.cycleCount}`,
  );

  const instabilityTop =
    topOverride !== undefined && topOverride > 0
      ? topOverride
      : GRAPH_METRICS_TEXT_INSTABILITY_TOP_N_DEFAULT;
  const complexityTop =
    topOverride !== undefined && topOverride > 0
      ? topOverride
      : GRAPH_METRICS_TEXT_COMPLEXITY_TOP_N_DEFAULT;

  lines.push('');
  lines.push(`Instability (top ${instabilityTop}):`);
  if (!summary.instability || summary.instability.length === 0) {
    lines.push('  (none)');
  } else {
    for (const row of summary.instability.slice(0, instabilityTop)) {
      lines.push(
        `  I=${row.value.toFixed(2)}` +
          `\tCe=${row.importeeCount}` +
          `\tCa=${row.importerCount}` +
          `\t${row.workspaceRelativePath}`,
      );
    }
  }

  lines.push('');
  if (summary.longestChain && summary.longestChain.uriPath.length > 0) {
    lines.push(`Longest chain (${summary.longestChain.length} hops):`);
    summary.longestChain.workspaceRelativePathPath.forEach((relativePath, index) => {
      lines.push(`  ${index + 1}. ${relativePath}`);
    });
  } else {
    lines.push('Longest chain:');
    lines.push('  (none)');
  }

  lines.push('');
  lines.push('SCC size distribution:');
  if (!summary.sccSizeDistribution) {
    lines.push('  (none)');
  } else {
    const rows = Object.entries(summary.sccSizeDistribution)
      .map(([key, count]) => ({ size: Number(key), count }))
      .filter((row) => Number.isFinite(row.size) && row.count > 0)
      .sort((left, right) => right.size - left.size);
    if (rows.length === 0) {
      lines.push('  (none)');
    } else {
      for (const row of rows) {
        lines.push(`  size=${row.size}\tcount=${row.count}`);
      }
    }
  }

  lines.push('');
  lines.push(`Complexity hotspots (top ${complexityTop}):`);
  if (!summary.complexityHotspots || summary.complexityHotspots.length === 0) {
    lines.push('  (none)');
  } else {
    for (const hotspot of summary.complexityHotspots.slice(0, complexityTop)) {
      lines.push(
        `  score=${hotspot.score}` +
          `\tcomplexity=${hotspot.aggregateCyclomaticComplexity}` +
          `\timporters=${hotspot.importerCount}` +
          `\t${hotspot.workspaceRelativePath}`,
      );
    }
  }

  return lines.join('\n');
}
