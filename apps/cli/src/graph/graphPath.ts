/**
 * `codepol graph path <from> <to>` — enumerate simple dependency paths
 * from one file to another.
 *
 * Accepts file paths (absolute or relative to `cwd`); they are converted
 * to `file://` URIs before calling {@link WorkspaceService.queryDependencyPath}
 * so the CLI and panels speak one payload shape.
 */
import { graphFileUriResolve } from './graphPathResolve';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphPathOptions = {
  cwd: string;
  configPath: string;
  fromPath: string;
  toPath: string;
  format: string | undefined;
  maxPaths?: number;
};

export async function graphPathRun(options: GraphPathOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);
  const fromUri = graphFileUriResolve(options.cwd, options.fromPath);
  const toUri = graphFileUriResolve(options.cwd, options.toPath);

  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const result = await session.service.queryDependencyPath({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
      fromUri,
      toUri,
      maxPaths: options.maxPaths,
    });

    if (format === 'json') {
      console.log(graphJsonStringify(result));
      return result.paths.length === 0 ? 1 : 0;
    }

    if (result.paths.length === 0) {
      console.log(`No dependency path from ${options.fromPath} to ${options.toPath}`);
      return 1;
    }

    console.log(`Shortest length: ${result.shortestLength}`);
    console.log(`Paths (${result.paths.length}${result.truncated ? ', truncated' : ''}):`);
    for (let index = 0; index < result.paths.length; index += 1) {
      const path = result.paths[index];
      if (!path) continue;
      console.log(`  [${index + 1}] ${path.join(' -> ')}`);
    }
    return 0;
  } finally {
    await session.close();
  }
}
