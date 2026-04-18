/**
 * `codepol graph snapshot` — capture the live workspace dependency
 * graph to a labeled sidecar file under
 * `<cwd>/.codepol/graph-snapshots/<label>.json`.
 *
 * CI flow:
 *
 *   git checkout master
 *   codepol graph snapshot --label base
 *   git checkout pr
 *   codepol graph diff base --fail-on-new-cycle
 *
 * Defaults to label `base` so the most common CI invocation needs zero
 * arguments after `--label` is sticky-defaulted via the env. The
 * snapshot payload is the structural primitives only (URIs, edges,
 * cycles, entry points); enriched per-edge / per-node metadata is
 * regenerated on demand when `codepol graph diff` re-renders the diff.
 */
import {
  fileSystemGraphSnapshotStoreCreate,
  graphSnapshotFromDependencyGraphResult,
  graphSnapshotLabelSanitize,
  graphSnapshotWorkspaceRootIdCompute,
} from '@codepol/workspace-service';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphSnapshotOptions = {
  cwd: string;
  configPath: string;
  label: string;
  format: string | undefined;
};

export async function graphSnapshotRun(options: GraphSnapshotOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);
  // Validate the label early so a typo fails before we pay the cost of
  // building the index.
  const safeLabel = graphSnapshotLabelSanitize(options.label);
  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const graph = await session.service.queryDependencyGraph({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
    });

    const workspaceRootId = graphSnapshotWorkspaceRootIdCompute(options.cwd);
    const snapshot = graphSnapshotFromDependencyGraphResult({
      graph,
      workspaceRootId,
      label: options.label,
    });

    const store = fileSystemGraphSnapshotStoreCreate({ rootPath: options.cwd });
    await store.graphSnapshotWrite({ label: options.label, snapshot });

    if (format === 'json') {
      console.log(
        graphJsonStringify({
          label: options.label,
          fileLabel: safeLabel,
          workspaceRootId,
          nodeCount: snapshot.nodes.length,
          edgeCount: snapshot.edges.length,
          cycleCount: snapshot.cycles.length,
          entryPointCount: snapshot.entryPoints.length,
        }),
      );
    } else {
      console.log(
        `Captured graph snapshot "${options.label}" (` +
          `${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges, ` +
          `${snapshot.cycles.length} cycle(s), ${snapshot.entryPoints.length} entry point(s))`,
      );
    }

    return 0;
  } finally {
    await session.close();
  }
}
