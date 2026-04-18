/**
 * `codepol graph dead` — list modules unreachable from the declared
 * entry points.
 *
 * `--entry <path>` may be repeated to override the default natural entry
 * points; each value is resolved to a `file://` URI via `cwd`. Exits 1
 * when any unreachable module is found so CI can gate PRs directly.
 */
import { graphFileUriResolve } from './graphPathResolve';
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
  const entryPointUris = options.entries.length > 0
    ? options.entries.map((entry) => graphFileUriResolve(options.cwd, entry))
    : undefined;

  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
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
