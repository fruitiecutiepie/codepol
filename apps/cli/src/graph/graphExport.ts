/**
 * `codepol graph export` — emit the full workspace dependency graph.
 *
 * JSON output is byte-equal to {@link WorkspaceDependencyGraphResult}
 * from `@codepol/core` so panels, CI bots, and tests can consume one
 * payload shape.
 */
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphExportOptions = {
  cwd: string;
  configPath: string;
  format: string | undefined;
};

export async function graphExportRun(options: GraphExportOptions): Promise<number> {
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
    if (format === 'json') {
      console.log(graphJsonStringify(result));
      return 0;
    }
    const lines: string[] = [];
    lines.push(`nodes: ${result.nodes.length}`);
    lines.push(`edges: ${result.edges.length}`);
    lines.push(`entryPoints: ${result.entryPoints.length}`);
    lines.push(`cycles: ${result.cycles.length}`);
    console.log(lines.join('\n'));
    return 0;
  } finally {
    await session.close();
  }
}
