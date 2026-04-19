/**
 * `codepol graph export` — emit the full workspace dependency graph in
 * the format requested by the user.
 *
 * Default `--format json` is byte-equal to {@link WorkspaceDependencyGraphResult}
 * from `@codepol/core` so panels, CI bots, and tests can consume one
 * payload shape. The `dot`, `mermaid`, and `graphml` formats let users
 * drop the graph straight into Graphviz, Mermaid Live Editor, Gephi, or
 * a docs site without writing custom export code.
 */
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import { graphJsonStringify } from './graphOutputFormat';
import {
  graphExportFormatParse,
  graphExportRenderDot,
  graphExportRenderGraphMl,
  graphExportRenderMermaid,
} from './graphExportRenderers';

export type GraphExportOptions = {
  cwd: string;
  configPath: string;
  format: string | undefined;
};

export async function graphExportRun(options: GraphExportOptions): Promise<number> {
  const format = graphExportFormatParse(options.format);
  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const result = await session.service.queryDependencyGraph({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
    });
    switch (format) {
      case 'json': {
        console.log(graphJsonStringify(result));
        return 0;
      }
      case 'text': {
        const lines: string[] = [];
        lines.push(`nodes: ${result.nodes.length}`);
        lines.push(`edges: ${result.edges.length}`);
        lines.push(`entryPoints: ${result.entryPoints.length}`);
        lines.push(`cycles: ${result.cycles.length}`);
        console.log(lines.join('\n'));
        return 0;
      }
      case 'dot': {
        process.stdout.write(graphExportRenderDot(result));
        return 0;
      }
      case 'mermaid': {
        process.stdout.write(graphExportRenderMermaid(result));
        return 0;
      }
      case 'graphml': {
        process.stdout.write(graphExportRenderGraphMl(result));
        return 0;
      }
    }
  } finally {
    await session.close();
  }
}
