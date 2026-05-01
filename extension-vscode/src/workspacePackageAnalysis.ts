import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  workspacePackageRecordsDiscover,
  type WorkspaceDependencyGraphResult,
  type WorkspacePrepareRenameResult,
  type WorkspaceSemanticHoverField,
  type WorkspaceSemanticHoverResult,
  type WorkspaceSupportedRenameTarget,
} from '@codepol/core';
import type { RenameTargetCandidate } from './discovery';
import type { CodepolProtocolClient } from './protocolClient';

export type WorkspacePackageDependencySummary = {
  packageName: string;
  edgeCount: number;
  fileCount: number;
};

export type WorkspacePackageHierarchySummary =
  | {
      status: 'ready';
      moduleCount: number;
      symbolCount: number;
      entryPointCount: number;
      cycleFileCount: number;
      loc?: number;
    }
  | {
      status: 'unavailable';
      message: string;
    };

export type WorkspacePackageDependencyAnalysis =
  | {
      status: 'ready';
      dependsOn: WorkspacePackageDependencySummary[];
      usedBy: WorkspacePackageDependencySummary[];
    }
  | {
      status: 'unavailable';
      message: string;
    };

export type WorkspacePackageRenameImpact =
  | {
      status: 'ready';
      namespaceId: string;
      impactedSiteCount: number;
      declarationUri?: string;
    }
  | {
      status: 'unavailable';
      message: string;
    };

export type WorkspacePackageSemanticSummary =
  | {
      status: 'ready';
      title: string;
      subtitle?: string;
      summary?: string;
      statusText?: string;
      fields: WorkspaceSemanticHoverField[];
    }
  | {
      status: 'unavailable';
      message: string;
    };

export type WorkspacePackageAnalysis = {
  packageName: string;
  target: WorkspaceSupportedRenameTarget;
  identity: {
    semanticClass: WorkspaceSupportedRenameTarget['semanticClass'];
    packageDir: string;
    packageJsonPath: string;
    entryPointPath: string;
    workspaceRelativePackageDir: string;
    workspaceRelativePackageJsonPath: string;
    workspaceRelativeEntryPointPath: string;
  };
  renameImpact: WorkspacePackageRenameImpact;
  semanticSummary: WorkspacePackageSemanticSummary;
  hierarchy: WorkspacePackageHierarchySummary;
  dependencies: WorkspacePackageDependencyAnalysis;
};

export type WorkspacePackageAnalysisLoader = {
  (candidate: RenameTargetCandidate): Promise<WorkspacePackageAnalysis | null>;
  refresh?(): void;
};

type PackageGraphAggregation = {
  hierarchy: WorkspacePackageHierarchySummary;
  dependencies: WorkspacePackageDependencyAnalysis;
};

function targetPackageNameResolve(targetId: string): string | undefined {
  const prefix = 'package:';
  if (!targetId.startsWith(prefix)) {
    return undefined;
  }
  const packageName = targetId.slice(prefix.length);
  return packageName.length > 0 ? packageName : undefined;
}

function workspaceRelativeLabel(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative.length > 0 ? relative : path.basename(targetPath);
}

function errorMessageResolve(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function optionalRequestRun<T>(
  request: Promise<T | null>,
): Promise<{ value: T | null; errorMessage?: string }> {
  try {
    return { value: await request };
  } catch (error) {
    return {
      value: null,
      errorMessage: errorMessageResolve(error, 'Codepol analysis is unavailable.'),
    };
  }
}

function renameImpactCreate(
  prepare: WorkspacePrepareRenameResult | null,
  errorMessage?: string,
): WorkspacePackageRenameImpact {
  if (!prepare) {
    return {
      status: 'unavailable',
      message: errorMessage ?? 'Rename impact is unavailable right now.',
    };
  }
  if (!prepare.ok) {
    return {
      status: 'unavailable',
      message: prepare.message,
    };
  }
  return {
    status: 'ready',
    namespaceId: prepare.namespaceId,
    impactedSiteCount: prepare.impactedSiteCount,
    declarationUri: prepare.declarationLocation?.uri,
  };
}

function semanticSummaryCreate(
  hover: WorkspaceSemanticHoverResult | null,
  errorMessage?: string,
): WorkspacePackageSemanticSummary {
  if (!hover) {
    return {
      status: 'unavailable',
      message: errorMessage ?? 'No Codepol semantic summary is available yet.',
    };
  }
  return {
    status: 'ready',
    title: hover.title,
    subtitle: hover.subtitle,
    summary: hover.summary,
    statusText: hover.statusText,
    fields: hover.fields,
  };
}

function dependencySummarySort(
  left: WorkspacePackageDependencySummary,
  right: WorkspacePackageDependencySummary,
): number {
  if (right.edgeCount !== left.edgeCount) {
    return right.edgeCount - left.edgeCount;
  }
  return left.packageName.localeCompare(right.packageName);
}

function dependencySummaryCreate(input: {
  packageName: string;
  edgeKeys: Set<string>;
  fileUris: Set<string>;
}): WorkspacePackageDependencySummary {
  return {
    packageName: input.packageName,
    edgeCount: input.edgeKeys.size,
    fileCount: input.fileUris.size,
  };
}

export function workspacePackageGraphAnalysisCreate(
  packageName: string,
  graph: WorkspaceDependencyGraphResult | null,
): PackageGraphAggregation {
  if (!graph) {
    return {
      hierarchy: {
        status: 'unavailable',
        message: 'Workspace dependency graph is unavailable right now.',
      },
      dependencies: {
        status: 'unavailable',
        message: 'Workspace dependency graph is unavailable right now.',
      },
    };
  }

  const nodeByUri = new Map(graph.nodes.map((node) => [node.uri, node]));
  const packageNodes = graph.nodes.filter((node) => node.packageName === packageName);
  const symbolCount = packageNodes.reduce(
    (sum, node) => sum + (node.metrics?.symbolCount ?? 0),
    0,
  );
  const entryPointCount = packageNodes.filter(
    (node) => node.metrics?.isEntryPoint === true,
  ).length;
  const cycleFileCount = packageNodes.filter(
    (node) => node.metrics?.isInCycle === true,
  ).length;
  const locValues = packageNodes
    .map((node) => node.metrics?.loc)
    .filter((value): value is number => typeof value === 'number');
  const loc = locValues.length > 0
    ? locValues.reduce((sum, value) => sum + value, 0)
    : undefined;

  const dependsOnByPackage = new Map<
    string,
    { edgeKeys: Set<string>; fileUris: Set<string> }
  >();
  const usedByByPackage = new Map<
    string,
    { edgeKeys: Set<string>; fileUris: Set<string> }
  >();

  for (const edge of graph.edges) {
    const from = nodeByUri.get(edge.fromUri);
    const to = nodeByUri.get(edge.toUri);
    const fromPackage = from?.packageName;
    const toPackage = to?.packageName;
    if (!fromPackage || !toPackage || fromPackage === toPackage) {
      continue;
    }

    const edgeKey = `${edge.fromUri}\0${edge.toUri}`;
    if (fromPackage === packageName) {
      const entry = dependsOnByPackage.get(toPackage) ?? {
        edgeKeys: new Set<string>(),
        fileUris: new Set<string>(),
      };
      entry.edgeKeys.add(edgeKey);
      entry.fileUris.add(edge.toUri);
      dependsOnByPackage.set(toPackage, entry);
    }
    if (toPackage === packageName) {
      const entry = usedByByPackage.get(fromPackage) ?? {
        edgeKeys: new Set<string>(),
        fileUris: new Set<string>(),
      };
      entry.edgeKeys.add(edgeKey);
      entry.fileUris.add(edge.fromUri);
      usedByByPackage.set(fromPackage, entry);
    }
  }

  const dependsOn = [...dependsOnByPackage.entries()]
    .map(([name, entry]) =>
      dependencySummaryCreate({
        packageName: name,
        edgeKeys: entry.edgeKeys,
        fileUris: entry.fileUris,
      }),
    )
    .sort(dependencySummarySort);
  const usedBy = [...usedByByPackage.entries()]
    .map(([name, entry]) =>
      dependencySummaryCreate({
        packageName: name,
        edgeKeys: entry.edgeKeys,
        fileUris: entry.fileUris,
      }),
    )
    .sort(dependencySummarySort);

  return {
    hierarchy: {
      status: 'ready',
      moduleCount: packageNodes.length,
      symbolCount,
      entryPointCount,
      cycleFileCount,
      ...(loc !== undefined ? { loc } : {}),
    },
    dependencies: {
      status: 'ready',
      dependsOn,
      usedBy,
    },
  };
}

export function workspacePackageAnalysisLoaderCreate(input: {
  rootPath: string;
  protocol: Pick<
    CodepolProtocolClient,
    'prepareRename' | 'querySemanticHover' | 'queryDependencyGraph'
  >;
}): WorkspacePackageAnalysisLoader {
  let graphPromise: Promise<WorkspaceDependencyGraphResult | null> | undefined;
  const graphGet = (): Promise<WorkspaceDependencyGraphResult | null> => {
    graphPromise ??= input.protocol.queryDependencyGraph();
    return graphPromise;
  };

  const load: WorkspacePackageAnalysisLoader = async (
    candidate: RenameTargetCandidate,
  ): Promise<WorkspacePackageAnalysis | null> => {
    if (candidate.kind !== 'workspace_package') {
      return null;
    }

    const packageName = targetPackageNameResolve(candidate.target.targetId);
    if (!packageName) {
      return null;
    }

    const record = workspacePackageRecordsDiscover(input.rootPath).find(
      (candidateRecord) => candidateRecord.name === packageName,
    );
    if (!record) {
      return null;
    }

    const packageDir = path.dirname(record.packageJsonPath);
    const entryPointUri = pathToFileURL(record.entryPointPath).toString();
    const [prepareResult, hoverResult, graphResult] = await Promise.all([
      optionalRequestRun(input.protocol.prepareRename(candidate.target)),
      optionalRequestRun(input.protocol.querySemanticHover(entryPointUri)),
      optionalRequestRun(graphGet()),
    ]);
    const graphAnalysis = workspacePackageGraphAnalysisCreate(
      packageName,
      graphResult.value,
    );

    return {
      packageName,
      target: candidate.target,
      identity: {
        semanticClass: candidate.target.semanticClass,
        packageDir,
        packageJsonPath: record.packageJsonPath,
        entryPointPath: record.entryPointPath,
        workspaceRelativePackageDir: workspaceRelativeLabel(input.rootPath, packageDir),
        workspaceRelativePackageJsonPath: workspaceRelativeLabel(
          input.rootPath,
          record.packageJsonPath,
        ),
        workspaceRelativeEntryPointPath: workspaceRelativeLabel(
          input.rootPath,
          record.entryPointPath,
        ),
      },
      renameImpact: renameImpactCreate(
        prepareResult.value,
        prepareResult.errorMessage,
      ),
      semanticSummary: semanticSummaryCreate(
        hoverResult.value,
        hoverResult.errorMessage,
      ),
      hierarchy: graphAnalysis.hierarchy,
      dependencies: graphResult.errorMessage
        ? {
            status: 'unavailable',
            message: graphResult.errorMessage,
          }
        : graphAnalysis.dependencies,
    };
  };

  load.refresh = (): void => {
    graphPromise = undefined;
  };

  return load;
}
