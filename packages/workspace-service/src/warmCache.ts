import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  IndexStatusFeatureStatus,
  PolicyViolation,
  ProjectIndexStoreSnapshot,
  WorkspaceDiagnostic,
} from '@codepol/core';

export const WORKSPACE_WARM_CACHE_COMPAT_VERSION = 1;

const WORKSPACE_WARM_CACHE_ENVIRONMENT_KEYS = [
  'PATH',
  'NODE_PATH',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
] as const;

export type WorkspaceWarmCacheKey = {
  workspaceId: string;
  rootPath: string;
  configPath: string;
};

export type WorkspaceWarmCacheFileFingerprint = {
  path: string;
  size: number;
  mtimeMs: number;
};

export type WorkspaceWarmCacheBaseIndexStateSnapshot = {
  files: string[];
  fileKey: string;
  workspacePackages: Array<[string, string]>;
};

export type WorkspaceWarmCacheSnapshot = {
  compatVersion: number;
  engineVersion: string;
  buildId: string;
  environmentId: string;
  workspaceId: string;
  rootPath: string;
  configPath: string;
  eslintConfigPath: string;
  analysisGeneration: number;
  workspaceIndexRequired: boolean;
  files: string[];
  diagnostics: WorkspaceDiagnostic[];
  treeViolations: PolicyViolation[];
  analyzerScorecard?: Array<{
    analyzerId: string;
    platform: 'codepol_tree' | 'eslint' | 'biome' | 'ruff';
    languages: string[];
    ownedRuleIds: string[];
    skippedRuleIds: string[];
    skippedReason?: 'native_preferred' | 'no_matching_rules' | 'no_matching_files';
    diagnosticCount: number;
    violationCount: number;
    issueCount: number;
    fileCount: number;
    fixMode: 'none' | 'inline' | 'external';
    status: 'ran' | 'skipped' | 'failed';
    latencyMs: number;
    issues: string[];
  }>;
  featureStatus: IndexStatusFeatureStatus;
  baseIndexState?: WorkspaceWarmCacheBaseIndexStateSnapshot;
  projectIndexStoreSnapshot?: ProjectIndexStoreSnapshot;
  configFingerprint: WorkspaceWarmCacheFileFingerprint;
  eslintConfigFingerprint?: WorkspaceWarmCacheFileFingerprint;
  fileFingerprints: WorkspaceWarmCacheFileFingerprint[];
  toolFingerprints: WorkspaceWarmCacheFileFingerprint[];
  pluginSignature: string;
  pluginFingerprints: WorkspaceWarmCacheFileFingerprint[];
  createdAtUnixMs: number;
};

export type WorkspaceWarmCacheSnapshotInput = Omit<
  WorkspaceWarmCacheSnapshot,
  'engineVersion' | 'buildId' | 'environmentId'
>;

export type WorkspaceWarmCacheStore = {
  read: (
    key: WorkspaceWarmCacheKey,
  ) => Promise<WorkspaceWarmCacheSnapshot | undefined> | WorkspaceWarmCacheSnapshot | undefined;
  write: (
    key: WorkspaceWarmCacheKey,
    snapshot: WorkspaceWarmCacheSnapshotInput,
  ) => Promise<void> | void;
  delete: (key: WorkspaceWarmCacheKey) => Promise<void> | void;
};

function workspaceWarmCacheIdCreate(
  key: WorkspaceWarmCacheKey,
  input: {
    engineVersion: string;
    buildId: string;
    environmentId: string;
  },
): string {
  const hash = createHash('sha1');
  hash.update(String(WORKSPACE_WARM_CACHE_COMPAT_VERSION));
  hash.update('\0');
  hash.update(input.engineVersion);
  hash.update('\0');
  hash.update(input.buildId);
  hash.update('\0');
  hash.update(input.environmentId);
  hash.update('\0');
  hash.update(path.resolve(key.workspaceId));
  hash.update('\0');
  hash.update(path.resolve(key.rootPath));
  hash.update('\0');
  hash.update(path.resolve(key.configPath));
  return hash.digest('hex');
}

function workspaceWarmCacheDirResolve(runtimeDir: string): string {
  return path.join(path.resolve(runtimeDir), 'warm-cache');
}

export function workspaceWarmCacheEnvironmentIdCreate(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const hash = createHash('sha1');
  hash.update(process.version);
  for (const key of WORKSPACE_WARM_CACHE_ENVIRONMENT_KEYS) {
    hash.update('\0');
    hash.update(key);
    hash.update('=');
    hash.update(env[key] ?? '');
  }
  return `node:${process.version}:env:${hash.digest('hex').slice(0, 16)}`;
}

function workspaceWarmCacheFilePathResolve(
  runtimeDir: string,
  key: WorkspaceWarmCacheKey,
  input: {
    engineVersion: string;
    buildId: string;
    environmentId: string;
  },
): string {
  const cacheId = workspaceWarmCacheIdCreate(key, input);
  return path.join(workspaceWarmCacheDirResolve(runtimeDir), `${cacheId}.json`);
}

function workspaceWarmCacheSnapshotMatchesKey(
  snapshot: Pick<WorkspaceWarmCacheSnapshot, 'workspaceId' | 'rootPath' | 'configPath'>,
  key: WorkspaceWarmCacheKey,
): boolean {
  return (
    snapshot.workspaceId === key.workspaceId &&
    path.resolve(snapshot.rootPath) === path.resolve(key.rootPath) &&
    path.resolve(snapshot.configPath) === path.resolve(key.configPath)
  );
}

export function workspaceWarmCacheFsStoreCreate(options: {
  runtimeDir: string;
  engineVersion?: string;
  buildId?: string;
  environmentId?: string;
  now?: () => number;
}): WorkspaceWarmCacheStore {
  const runtimeDir = path.resolve(options.runtimeDir);
  const engineVersion = options.engineVersion ?? 'workspace-service';
  const buildId = options.buildId ?? 'dev';
  const environmentId =
    options.environmentId ?? workspaceWarmCacheEnvironmentIdCreate();
  const now = options.now ?? (() => Date.now());

  const filePathResolve = (key: WorkspaceWarmCacheKey): string =>
    workspaceWarmCacheFilePathResolve(runtimeDir, key, {
      engineVersion,
      buildId,
      environmentId,
    });

  const workspaceVariantsPrune = (
    key: WorkspaceWarmCacheKey,
    keepFilePath?: string,
  ): void => {
    const cacheDir = workspaceWarmCacheDirResolve(runtimeDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(cacheDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const entryPath = path.join(cacheDir, entry);
      if (keepFilePath && path.resolve(entryPath) === path.resolve(keepFilePath)) {
        continue;
      }
      try {
        const raw = fs.readFileSync(entryPath, 'utf8');
        const parsed = JSON.parse(raw) as WorkspaceWarmCacheSnapshot;
        if (workspaceWarmCacheSnapshotMatchesKey(parsed, key)) {
          fs.unlinkSync(entryPath);
        }
      } catch {
        try {
          fs.unlinkSync(entryPath);
        } catch {
          // ignore stale cache cleanup races
        }
      }
    }
  };

  return {
    read(key) {
      const filePath = filePathResolve(key);
      if (!fs.existsSync(filePath)) {
        workspaceVariantsPrune(key);
        return undefined;
      }
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as WorkspaceWarmCacheSnapshot;
        if (
          parsed.compatVersion !== WORKSPACE_WARM_CACHE_COMPAT_VERSION ||
          parsed.engineVersion !== engineVersion ||
          parsed.buildId !== buildId ||
          parsed.environmentId !== environmentId ||
          !workspaceWarmCacheSnapshotMatchesKey(parsed, key)
        ) {
          fs.unlinkSync(filePath);
          workspaceVariantsPrune(key);
          return undefined;
        }
        workspaceVariantsPrune(key, filePath);
        return parsed;
      } catch {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore stale cache cleanup races
        }
        workspaceVariantsPrune(key);
        return undefined;
      }
    },
    write(key, snapshot) {
      const filePath = filePathResolve(key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const payload: WorkspaceWarmCacheSnapshot = {
        ...snapshot,
        engineVersion,
        buildId,
        environmentId,
        createdAtUnixMs: snapshot.createdAtUnixMs ?? now(),
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
      workspaceVariantsPrune(key, filePath);
    },
    delete(key) {
      const filePath = filePathResolve(key);
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore stale cache cleanup races
      }
      workspaceVariantsPrune(key);
    },
  };
}
