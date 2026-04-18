/**
 * `codepol graph impact <path>` — emit the neighborhood of a file.
 *
 * Thin wrapper around {@link WorkspaceService.queryImpactRadius}. JSON
 * output is byte-equal to {@link WorkspaceDependencyGraphResult} so
 * panels and CLI share one render pipeline.
 */
import type { WorkspaceImpactRadiusDirection } from '@codepol/core';
import { graphFileUriResolve } from './graphPathResolve';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphImpactOptions = {
  cwd: string;
  configPath: string;
  filePath: string;
  direction: WorkspaceImpactRadiusDirection;
  depth?: number;
  format: string | undefined;
};

export async function graphImpactRun(options: GraphImpactOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);
  const uri = graphFileUriResolve(options.cwd, options.filePath);

  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const result = await session.service.queryImpactRadius({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
      uri,
      direction: options.direction,
      depth: options.depth,
    });

    if (format === 'json') {
      console.log(graphJsonStringify(result));
      return 0;
    }
    console.log(`direction: ${options.direction}`);
    console.log(`nodes: ${result.nodes.length}`);
    console.log(`edges: ${result.edges.length}`);
    return 0;
  } finally {
    await session.close();
  }
}
