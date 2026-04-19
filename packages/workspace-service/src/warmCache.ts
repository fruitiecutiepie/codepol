import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  IndexStatusFeatureStatus,
  PolicyViolation,
  ProjectIndexStoreSnapshot,
  WorkspaceDiagnostic,
} from '@codepol/core';

// Bumped to 3: external tool configs (eslint, biome, ruff) are now tracked as
// a single `externalToolConfigs` array on the snapshot, replacing the
// ESLint-only `eslintConfigPath` / `eslintConfigFingerprint` fields. v2
// snapshots are dropped on read because their schema cannot represent the new
// per-tool fingerprints needed for symmetric watcher invalidation.
//
// History:
// - v2: per-(analyzer, file) cache entries persisted alongside `lastAnalysis`.
//       Dropped v1 snapshots because they lacked `analyzerCache`.
// - v1: initial workspace-scoped snapshot.
export const WORKSPACE_WARM_CACHE_COMPAT_VERSION = 3;

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

export type WorkspaceWarmCacheAnalyzerKey = 'tree' | 'eslint' | 'biome' | 'ruff';

export type WorkspaceWarmCacheAnalyzerKeyTuple = {
  contentFingerprint: string;
  configFingerprint: string;
  pluginFingerprint: string;
  toolFingerprintKey: string;
  treeIndexFingerprint: string;
};

/**
 * Per-(analyzer, file) cache entry persisted in the warm-cache snapshot. The
 * `key` carries the same invariants the in-memory cache uses (file content +
 * config + plugin + tool + treeIndex fingerprints) so restore can reuse a
 * slice without re-running the analyzer when every invariant still matches.
 *
 * `fixableTreeViolationDiagnosticIds` is a parallel id list so the
 * `Map<diagnosticId, PolicyViolation>` shape used at runtime can be
 * reconstructed without persisting the Map directly.
 */
export type WorkspaceWarmCacheAnalyzerFileEntry = {
  filePath: string;
  key: WorkspaceWarmCacheAnalyzerKeyTuple;
  violations: PolicyViolation[];
  diagnostics: WorkspaceDiagnostic[];
  treeViolations: PolicyViolation[];
  fixableTreeViolationDiagnosticIds: string[];
  errorCount?: number;
};

export type WorkspaceWarmCacheAnalyzerScorecardTemplate = {
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
};

export type WorkspaceWarmCacheAnalyzerEntry = {
  analyzer: WorkspaceWarmCacheAnalyzerKey;
  scorecardTemplate: WorkspaceWarmCacheAnalyzerScorecardTemplate;
  fileResults: WorkspaceWarmCacheAnalyzerFileEntry[];
};

/**
 * One external tool config file (eslint / biome / ruff) referenced by the
 * policy at the time the snapshot was persisted. The file fingerprint lets
 * `workspaceWarmCacheSnapshotRestore` invalidate the snapshot when any tool
 * config has changed on disk between sessions.
 *
 * The list is kept in stable sort order by `(analyzerId, configPath)` so
 * snapshot equality reduces to element-wise comparison.
 */
export type WorkspaceWarmCacheExternalToolConfigEntry = {
  analyzerId: 'eslint' | 'biome' | 'ruff';
  configPath: string;
  fingerprint: WorkspaceWarmCacheFileFingerprint;
};

export type WorkspaceWarmCacheSnapshot = {
  compatVersion: number;
  engineVersion: string;
  buildId: string;
  environmentId: string;
  workspaceId: string;
  rootPath: string;
  configPath: string;
  externalToolConfigs: WorkspaceWarmCacheExternalToolConfigEntry[];
  analysisGeneration: number;
  workspaceIndexRequired: boolean;
  files: string[];
  diagnostics: WorkspaceDiagnostic[];
  treeViolations: PolicyViolation[];
  analyzerInventory?: Array<{
    ruleId: string;
    languages: string[];
    wrappedPlatforms: string[];
    hasNativeOwner: boolean;
    ownership: 'native_preferred' | 'keep_wrapped';
    recentNativeDiagnosticCount: number;
    recentWrappedDiagnosticCount: number;
    recentNativeLatencyMs: number;
    recentWrappedLatencyMs: number;
    fixSurfaceNotes: string[];
  }>;
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
  fileFingerprints: WorkspaceWarmCacheFileFingerprint[];
  toolFingerprints: WorkspaceWarmCacheFileFingerprint[];
  pluginSignature: string;
  pluginFingerprints: WorkspaceWarmCacheFileFingerprint[];
  // Per-(analyzer, file) cache entries. Optional so very old / corrupt
  // snapshots stay readable up to the rest of the validation; missing means
  // restore must treat every file as a miss for that analyzer.
  analyzerCache?: WorkspaceWarmCacheAnalyzerEntry[];
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

function workspaceWarmCacheDirResolve(cacheDir: string): string {
  return path.join(path.resolve(cacheDir), 'warm-cache');
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
  cacheDir: string,
  key: WorkspaceWarmCacheKey,
  input: {
    engineVersion: string;
    buildId: string;
    environmentId: string;
  },
): string {
  const cacheId = workspaceWarmCacheIdCreate(key, input);
  return path.join(workspaceWarmCacheDirResolve(cacheDir), `${cacheId}.json`);
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
  cacheDir: string;
  engineVersion?: string;
  buildId?: string;
  environmentId?: string;
  now?: () => number;
}): WorkspaceWarmCacheStore {
  const cacheDir = path.resolve(options.cacheDir);
  const engineVersion = options.engineVersion ?? 'workspace-service';
  const buildId = options.buildId ?? 'dev';
  const environmentId =
    options.environmentId ?? workspaceWarmCacheEnvironmentIdCreate();
  const now = options.now ?? (() => Date.now());

  const filePathResolve = (key: WorkspaceWarmCacheKey): string =>
    workspaceWarmCacheFilePathResolve(cacheDir, key, {
      engineVersion,
      buildId,
      environmentId,
    });

  const workspaceVariantsPrune = (
    key: WorkspaceWarmCacheKey,
    keepFilePath?: string,
  ): void => {
    const warmCacheDir = workspaceWarmCacheDirResolve(cacheDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(warmCacheDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const entryPath = path.join(warmCacheDir, entry);
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
