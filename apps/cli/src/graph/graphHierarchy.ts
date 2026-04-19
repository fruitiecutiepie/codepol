/**
 * `codepol graph hierarchy <symbolId>` — emit the symbol-level type
 * hierarchy for a stable symbol id.
 *
 * Phase 9.4 / 9.5 / Gap 3. JSON output is byte-equal to
 * {@link WorkspaceDependencyGraphResult} so panels, CI consumers, and
 * tests share one payload shape. With `--include-structural`, edges
 * may carry `typeRelationConfidence: 'structural-shape'`. With
 * `--require-type-aware`, the command exits non-zero when no
 * {@link TypeAwareTypeHierarchySource} is registered for the seed
 * symbol's language — useful as a CI gate that confirms a language
 * server binding is active.
 */
import type {
  WorkspaceTypeHierarchyDirection,
  WorkspaceTypeHierarchyEdgeConfidence,
} from '@codepol/core';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphHierarchyOptions = {
  cwd: string;
  configPath: string;
  symbolId: string;
  direction: WorkspaceTypeHierarchyDirection;
  depth: number | undefined;
  includeStructural: boolean;
  minConfidence: WorkspaceTypeHierarchyEdgeConfidence | undefined;
  requireTypeAware: boolean;
  format: string | undefined;
};

export async function graphHierarchyRun(
  options: GraphHierarchyOptions,
): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);

  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    let result;
    try {
      result = await session.service.queryTypeHierarchy({
        clientSessionId: session.clientSessionId,
        workspaceId: session.workspaceId,
        symbolId: options.symbolId,
        direction: options.direction,
        depth: options.depth,
        includeStructural: options.includeStructural,
        minConfidence: options.minConfidence,
        requireTypeAware: options.requireTypeAware,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'type-aware-source-missing') {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        return 2;
      }
      throw error;
    }

    if (format === 'json') {
      console.log(graphJsonStringify(result));
      return 0;
    }

    if (result.nodes.length === 0) {
      console.log(`No type-hierarchy nodes for ${options.symbolId}`);
      return 0;
    }
    console.log(`direction: ${options.direction}`);
    console.log(`nodes: ${result.nodes.length}`);
    console.log(`edges: ${result.edges.length}`);
    for (const edge of result.edges) {
      const confidence = edge.typeRelationConfidence ?? 'declared';
      console.log(
        `  ${edge.fromUri} -> ${edge.toUri} [${confidence}]`,
      );
    }
    return 0;
  } finally {
    await session.close();
  }
}
