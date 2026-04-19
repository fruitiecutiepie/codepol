/**
 * `codepol graph dead` — list modules unreachable from the declared
 * entry points.
 *
 * `--entry <value>` may be repeated. Each value is one of:
 *
 * - a literal file path (relative to `cwd` or absolute), e.g.
 *   `--entry src/index.ts`
 * - a glob pattern matched against the workspace-relative path of every
 *   indexed file, e.g. `--entry "bin/**"` or `--entry "src/cli/**.ts"`
 *
 * When no entries are supplied the workspace's natural entry points
 * (files with no importers) are used.
 *
 * Exits 1 when any unreachable module is found so CI can gate PRs
 * directly. A glob that matches nothing is logged to stderr but does not
 * count as an unreachable module — that lets typo'd patterns produce
 * loud feedback without polluting `unreachable` itself.
 */
import { graphEntryUrisExpand } from './graphEntryGlobExpand';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphDeadOptions = {
  cwd: string;
  configPath: string;
  entries: string[];
  format: string | undefined;
};

export async function graphDeadRun(options: GraphDeadOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);
  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    let entryPointUris: string[] | undefined;
    let unmatchedGlobs: string[] = [];
    if (options.entries.length > 0) {
      const graph = await session.service.queryDependencyGraph({
        clientSessionId: session.clientSessionId,
        workspaceId: session.workspaceId,
      });
      const expansion = graphEntryUrisExpand({
        cwd: options.cwd,
        entries: options.entries,
        nodes: graph.nodes,
      });
      entryPointUris = expansion.uris;
      unmatchedGlobs = expansion.unmatched;
      for (const pattern of unmatchedGlobs) {
        console.error(`warn: --entry "${pattern}" matched no indexed files`);
      }
    }

    const result = await session.service.queryDeadModules({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
      entryPointUris,
    });

    if (format === 'json') {
      console.log(graphJsonStringify(result));
    } else if (result.unreachable.length === 0) {
      console.log('No dead modules detected');
    } else {
      console.log(`Dead modules (${result.unreachable.length}):`);
      for (const uri of result.unreachable) {
        console.log(`  ${uri}`);
      }
    }

    return result.unreachable.length === 0 ? 0 : 1;
  } finally {
    await session.close();
  }
}
