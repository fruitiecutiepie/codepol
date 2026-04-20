/**
 * @packageDocumentation
 * Pure view model for the dedicated dead-modules panel.
 *
 * Inputs are the workspace-service `WorkspaceDeadModulesResult` plus
 * the workspace-relative path lookup the controller already has from
 * `queryDependencyGraph`. The factory is `vscode`-free so it can be
 * unit-tested without a host.
 *
 * Files are grouped by their immediate parent directory
 * (workspace-relative). Sections sort by directory name; files within a
 * section sort lexicographically by basename. Files at the workspace
 * root land in a synthetic group whose `directoryWorkspaceRelativePath`
 * is the empty string — the renderer surfaces that as `/`.
 */

import type { WorkspaceDeadModulesResult } from '@codepol/core';

export type DeadModulesPanelFile = {
  uri: string;
  workspaceRelativePath: string;
  basename: string;
};

export type DeadModulesPanelGroup = {
  /** Empty string for workspace-root files; the renderer renders `/`. */
  directoryWorkspaceRelativePath: string;
  files: DeadModulesPanelFile[];
};

export type DeadModulesPanelViewModel = {
  /** "12 unreachable files in 4 directories" | "0 unreachable files". */
  headline: string;
  /** "Entry points: natural" | "Entry points: src/index.ts, scripts/main.ts". */
  summary: string;
  /** Empty when natural entry points were used. */
  entryPointUris: string[];
  /** Workspace-relative labels for the panel header, in input order. */
  entryPointLabels: string[];
  totalUnreachable: number;
  /** Sorted by `directoryWorkspaceRelativePath` asc. */
  groups: DeadModulesPanelGroup[];
};

export type DeadModulesPanelViewModelInput = {
  result: WorkspaceDeadModulesResult;
  /** Caller-supplied entry points, or `undefined` for natural entries. */
  entryPointUris?: string[];
  /**
   * Resolved by the controller from `queryDependencyGraph().nodes`. When
   * a URI is not in the graph (defensive case) the helper falls back to
   * the URI itself so rendering never blows up.
   */
  nodeWorkspaceRelativePathGet: (uri: string) => string;
};

export function deadModulesPanelViewModelCreate(
  input: DeadModulesPanelViewModelInput,
): DeadModulesPanelViewModel {
  const totalUnreachable = input.result.unreachable.length;

  const files: DeadModulesPanelFile[] = input.result.unreachable.map((uri) => {
    const workspaceRelativePath = input.nodeWorkspaceRelativePathGet(uri);
    return {
      uri,
      workspaceRelativePath,
      basename: deadModulesBasenameOf(workspaceRelativePath),
    };
  });

  const groups = deadModulesGroupsCreate(files);

  const entryPointUris = entryPointUrisDedupe(input.entryPointUris);
  const entryPointLabels = entryPointUris.map((uri) =>
    input.nodeWorkspaceRelativePathGet(uri),
  );

  const headline = deadModulesHeadlineResolve(totalUnreachable, groups.length);
  const summary = deadModulesSummaryResolve(entryPointLabels);

  return {
    headline,
    summary,
    entryPointUris,
    entryPointLabels,
    totalUnreachable,
    groups,
  };
}

function deadModulesGroupsCreate(
  files: DeadModulesPanelFile[],
): DeadModulesPanelGroup[] {
  const byDirectory = new Map<string, DeadModulesPanelFile[]>();
  for (const file of files) {
    const directory = deadModulesDirectoryOf(file.workspaceRelativePath);
    let bucket = byDirectory.get(directory);
    if (!bucket) {
      bucket = [];
      byDirectory.set(directory, bucket);
    }
    bucket.push(file);
  }

  const groups: DeadModulesPanelGroup[] = [];
  for (const [directory, bucket] of byDirectory) {
    bucket.sort((left, right) => left.basename.localeCompare(right.basename));
    groups.push({
      directoryWorkspaceRelativePath: directory,
      files: bucket,
    });
  }
  groups.sort((left, right) =>
    left.directoryWorkspaceRelativePath.localeCompare(
      right.directoryWorkspaceRelativePath,
    ),
  );
  return groups;
}

function deadModulesHeadlineResolve(total: number, directoryCount: number): string {
  if (total === 0) {
    return '0 unreachable files';
  }
  const fileLabel = total === 1 ? 'file' : 'files';
  const directoryLabel = directoryCount === 1 ? 'directory' : 'directories';
  return `${total} unreachable ${fileLabel} in ${directoryCount} ${directoryLabel}`;
}

function deadModulesSummaryResolve(entryPointLabels: string[]): string {
  if (entryPointLabels.length === 0) {
    return 'Entry points: natural';
  }
  return `Entry points: ${entryPointLabels.join(', ')}`;
}

/**
 * Workspace-relative paths use forward slashes by convention (the
 * workspace service emits `path.relative(...)` results that we have
 * always rendered with `/` in panels). The directory of `src/foo/a.ts`
 * is `src/foo`; root files yield `''`.
 */
function deadModulesDirectoryOf(workspaceRelativePath: string): string {
  const lastSlash = workspaceRelativePath.lastIndexOf('/');
  if (lastSlash <= 0) {
    return '';
  }
  return workspaceRelativePath.slice(0, lastSlash);
}

function deadModulesBasenameOf(workspaceRelativePath: string): string {
  const lastSlash = workspaceRelativePath.lastIndexOf('/');
  if (lastSlash < 0) {
    return workspaceRelativePath;
  }
  return workspaceRelativePath.slice(lastSlash + 1);
}

function entryPointUrisDedupe(uris: string[] | undefined): string[] {
  if (!uris || uris.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const uri of uris) {
    if (seen.has(uri)) continue;
    seen.add(uri);
    result.push(uri);
  }
  return result;
}
