/**
 * `codepol graph diff` — compare the live workspace dependency graph
 * against a previously captured baseline.
 *
 * The baseline source is one of:
 *
 * - `--baseline-label <label>` (default: `base`) — read from the
 *   sidecar store at `<cwd>/.codepol/graph-snapshots/<label>.json`
 * - `--baseline-file <path>` — read a raw JSON file containing either a
 *   captured `WorkspaceDependencyGraphResult` (e.g. `codepol graph
 *   export` output from another git ref) or a `GraphSnapshot`. Inline
 *   payloads are useful in CI scripts that prefer not to write to the
 *   workspace's snapshot directory.
 *
 * Exit codes:
 *
 * - `0` — diff produced (regardless of whether anything changed)
 * - `1` — `--fail-on-new-cycle` set and the diff added at least one
 *   cycle (cycles previously present that are still present do not
 *   trigger a failure)
 * - any error path is reported via the parent CLI's standard error
 *   handler with a non-zero exit code
 *
 * The JSON payload is the {@link WorkspaceDependencyDiffResult} shape
 * exactly so panels and CI scripts can consume one schema.
 */
import fs from 'node:fs';
import type {
  GraphSnapshot,
  WorkspaceDependencyDiffResult,
  WorkspaceDependencyGraphResult,
} from '@codepol/core';
import { WorkspaceFault } from '@codepol/core';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphDiffOptions = {
  cwd: string;
  configPath: string;
  baselineLabel?: string;
  baselineFile?: string;
  failOnNewCycle: boolean;
  format: string | undefined;
};

export const GRAPH_DIFF_DEFAULT_BASELINE_LABEL = 'base';

export async function graphDiffRun(options: GraphDiffOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);

  if (options.baselineLabel !== undefined && options.baselineFile !== undefined) {
    throw new WorkspaceFault('Specify only one of --baseline-label or --baseline-file');
  }

  let baselineGraph: WorkspaceDependencyGraphResult | undefined;
  let baselineLabel: string | undefined;
  if (options.baselineFile !== undefined) {
    baselineGraph = graphDiffBaselineFileLoad(options.baselineFile);
  } else {
    baselineLabel = options.baselineLabel ?? GRAPH_DIFF_DEFAULT_BASELINE_LABEL;
  }

  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const result = await session.service.queryDependencyDiff({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
      ...(baselineLabel !== undefined ? { baselineLabel } : {}),
      ...(baselineGraph !== undefined ? { baselineGraph } : {}),
    });

    graphDiffEmit({ format, result });

    if (options.failOnNewCycle && result.newCycles.length > 0) {
      return 1;
    }
    return 0;
  } finally {
    await session.close();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Load a baseline payload from disk. Accepts either a
 * {@link WorkspaceDependencyGraphResult} (from `codepol graph export`)
 * or a {@link GraphSnapshot} (from `codepol graph snapshot`); both
 * shapes carry the structural primitives needed by the diff.
 */
function graphDiffBaselineFileLoad(filePath: string): WorkspaceDependencyGraphResult {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new WorkspaceFault(
      `Failed to read baseline file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkspaceFault(
      `Failed to parse baseline file ${filePath} as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return graphDiffBaselinePayloadNormalize(parsed, filePath);
}

function graphDiffBaselinePayloadNormalize(
  payload: unknown,
  filePath: string,
): WorkspaceDependencyGraphResult {
  if (!payload || typeof payload !== 'object') {
    throw new WorkspaceFault(`Baseline file ${filePath} is not a JSON object`);
  }
  const candidate = payload as Partial<GraphSnapshot> & Partial<WorkspaceDependencyGraphResult>;

  // GraphSnapshot path: nodes carry only the diff-relevant fields, edges
  // use snapshot field names. We map back into the WorkspaceDependency*
  // shape so the workspace-service layer treats both inputs identically.
  if (candidate.schemaVersion === 1 && Array.isArray(candidate.nodes)) {
    return {
      nodes: (candidate.nodes as Array<{ uri: string; workspaceRelativePath: string }>).map(
        (node) => ({
          uri: node.uri,
          workspaceRelativePath: node.workspaceRelativePath,
        }),
      ),
      edges: (candidate.edges ?? []).map((edge) => ({
        fromUri: edge.fromUri,
        toUri: edge.toUri,
      })),
      entryPoints: candidate.entryPoints ?? [],
      cycles: candidate.cycles ?? [],
    };
  }

  // WorkspaceDependencyGraphResult path: pass through.
  if (
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    Array.isArray(candidate.entryPoints) &&
    Array.isArray(candidate.cycles)
  ) {
    return candidate as WorkspaceDependencyGraphResult;
  }

  throw new WorkspaceFault(
    `Baseline file ${filePath} is not a GraphSnapshot or WorkspaceDependencyGraphResult payload`,
  );
}

function graphDiffEmit(input: {
  format: GraphOutputFormat;
  result: WorkspaceDependencyDiffResult;
}): void {
  if (input.format === 'json') {
    console.log(graphJsonStringify(input.result));
    return;
  }

  const { result } = input;
  const lines: string[] = [];
  if (result.baselineLabel !== undefined) {
    lines.push(`Baseline: ${result.baselineLabel}`);
  }
  lines.push(`Added nodes: ${result.addedNodes.length}`);
  for (const node of result.addedNodes) {
    lines.push(`  + ${node.workspaceRelativePath}`);
  }
  lines.push(`Removed nodes: ${result.removedNodes.length}`);
  for (const node of result.removedNodes) {
    lines.push(`  - ${node.workspaceRelativePath}`);
  }
  lines.push(`Added edges: ${result.addedEdges.length}`);
  for (const edge of result.addedEdges) {
    lines.push(`  + ${edge.fromUri} -> ${edge.toUri}`);
  }
  lines.push(`Removed edges: ${result.removedEdges.length}`);
  for (const edge of result.removedEdges) {
    lines.push(`  - ${edge.fromUri} -> ${edge.toUri}`);
  }
  lines.push(`New cycles: ${result.newCycles.length}`);
  for (const cycle of result.newCycles) {
    lines.push(`  + cycle (${cycle.length}): ${cycle.join(' -> ')}`);
  }
  lines.push(`Removed cycles: ${result.removedCycles.length}`);
  for (const cycle of result.removedCycles) {
    lines.push(`  - cycle (${cycle.length}): ${cycle.join(' -> ')}`);
  }
  console.log(lines.join('\n'));
}
