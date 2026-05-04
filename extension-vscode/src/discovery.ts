import fs from 'node:fs';
import path from 'node:path';
import {
  configFileDiscover,
  configParseFromSource,
  isErr,
  resultFrom,
  workspacePackageRecordsDiscover,
  type WorkspaceSupportedRenameTarget,
} from '@codepol/core';

export type RenameTargetCandidateKind = 'workspace_package' | 'config_target';

export type RenameTargetCandidate = {
  kind: RenameTargetCandidateKind;
  label: string;
  description: string;
  detail: string;
  target: WorkspaceSupportedRenameTarget;
};

function workspaceRelativeLabel(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative.length > 0 ? relative : path.basename(targetPath);
}

export function workspacePackageRenameTargetsDiscover(
  rootPath: string,
): RenameTargetCandidate[] {
  const records = workspacePackageRecordsDiscover(rootPath);
  const duplicateCountByName = new Map<string, number>();
  for (const record of records) {
    duplicateCountByName.set(
      record.name,
      (duplicateCountByName.get(record.name) ?? 0) + 1,
    );
  }

  return records.map((record) => {
    const packageDir = path.dirname(record.packageJsonPath);
    const relativeDir = workspaceRelativeLabel(rootPath, packageDir);
    const hasDuplicate = (duplicateCountByName.get(record.name) ?? 0) > 1;

    return {
      kind: 'workspace_package',
      label: record.name,
      description: relativeDir,
      detail: hasDuplicate
        ? `Workspace package at ${relativeDir}`
        : 'Workspace package',
      target: {
        semanticClass: 'domain_entity',
        targetId: `package:${record.name}`,
      },
    };
  });
}

export function configRenameTargetsDiscover(rootPath: string): RenameTargetCandidate[] {
  const configPath = configFileDiscover(rootPath);
  if (!configPath) {
    return [];
  }

  const sourceR = resultFrom(() => fs.readFileSync(configPath, 'utf8'));
  if (isErr(sourceR)) {
    return [];
  }

  const configR = configParseFromSource(sourceR.Ok, { configPath });
  if (isErr(configR)) {
    return [];
  }
  const config = configR.Ok;
  return Object.keys(config.targets)
    .sort((left, right) => left.localeCompare(right))
    .map((targetName) => ({
      kind: 'config_target',
      label: targetName,
      description: workspaceRelativeLabel(rootPath, configPath),
      detail: 'Codepol config target',
      target: {
        semanticClass: 'config_component',
        targetId: `target:${targetName}`,
      },
    }));
}

export function renameTargetCandidatesDiscover(rootPath: string): RenameTargetCandidate[] {
  return [
    ...workspacePackageRenameTargetsDiscover(rootPath),
    ...configRenameTargetsDiscover(rootPath),
  ];
}
