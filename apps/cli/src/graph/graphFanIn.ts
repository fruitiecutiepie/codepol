/**
 * `codepol graph fan-in` — rank files by `importerCount`.
 *
 * When a file path is supplied, only that file's metrics are reported.
 * Otherwise the command emits the top-N files (default 20) by importer
 * count, ties broken by URI for determinism.
 */
import { graphFileUriResolve } from './graphPathResolve';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';
import type { WorkspaceDependencyGraphNode } from '@codepol/core';

export type GraphFanInOptions = {
  cwd: string;
  configPath: string;
  filePath?: string;
  top?: number;
  format: string | undefined;
};

type FanEntry = {
  uri: string;
  workspaceRelativePath: string;
  importerCount: number;
  importeeCount: number;
};

function fanEntriesSelect(
  nodes: WorkspaceDependencyGraphNode[],
  metric: 'importerCount' | 'importeeCount',
  focusUri: string | undefined,
  top: number,
): FanEntry[] {
  const entries: FanEntry[] = [];
  for (const node of nodes) {
    if (focusUri && node.uri !== focusUri) continue;
    entries.push({
      uri: node.uri,
      workspaceRelativePath: node.workspaceRelativePath,
      importerCount: node.metrics?.importerCount ?? 0,
      importeeCount: node.metrics?.importeeCount ?? 0,
    });
  }
  entries.sort((left, right) => {
    const leftMetric = left[metric];
    const rightMetric = right[metric];
    if (leftMetric !== rightMetric) return rightMetric - leftMetric;
    return left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0;
  });
  if (focusUri) return entries;
  return entries.slice(0, top);
}

export async function graphFanInRun(options: GraphFanInOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);
  const top = options.top !== undefined && options.top > 0 ? options.top : 20;
  const focusUri = options.filePath
    ? graphFileUriResolve(options.cwd, options.filePath)
    : undefined;

  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const graph = await session.service.queryDependencyGraph({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
    });
    const entries = fanEntriesSelect(graph.nodes, 'importerCount', focusUri, top);

    if (format === 'json') {
      console.log(graphJsonStringify({ entries }));
    } else if (entries.length === 0) {
      console.log('No matching files');
    } else {
      for (const entry of entries) {
        console.log(`${entry.importerCount}\t${entry.workspaceRelativePath}`);
      }
    }
    return 0;
  } finally {
    await session.close();
  }
}
