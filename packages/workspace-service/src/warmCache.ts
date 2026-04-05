import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  IndexStatusFeatureStatus,
  PolicyViolation,
  WorkspaceDiagnostic,
} from '@codepol/core';

export const WORKSPACE_WARM_CACHE_COMPAT_VERSION = 1;

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
  workspaceId: string;
  rootPath: string;
  configPath: string;
  eslintConfigPath: string;
  analysisGeneration: number;
  workspaceIndexRequired: boolean;
  files: string[];
  diagnostics: WorkspaceDiagnostic[];
  treeViolations: PolicyViolation[];
  featureStatus: IndexStatusFeatureStatus;
  baseIndexState?: WorkspaceWarmCacheBaseIndexStateSnapshot;
  configFingerprint: WorkspaceWarmCacheFileFingerprint;
  eslintConfigFingerprint?: WorkspaceWarmCacheFileFingerprint;
  fileFingerprints: WorkspaceWarmCacheFileFingerprint[];
  createdAtUnixMs: number;
};

export type WorkspaceWarmCacheStore = {
  read: (
    key: WorkspaceWarmCacheKey,
  ) => Promise<WorkspaceWarmCacheSnapshot | undefined> | WorkspaceWarmCacheSnapshot | undefined;
  write: (
    key: WorkspaceWarmCacheKey,
    snapshot: WorkspaceWarmCacheSnapshot,
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
  const environmentId = options.environmentId ?? `node:${process.version}`;
  const now = options.now ?? (() => Date.now());

  const filePathResolve = (key: WorkspaceWarmCacheKey): string =>
    workspaceWarmCacheFilePathResolve(runtimeDir, key, {
      engineVersion,
      buildId,
      environmentId,
    });

  return {
    read(key) {
      const filePath = filePathResolve(key);
      if (!fs.existsSync(filePath)) {
        return undefined;
      }
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as WorkspaceWarmCacheSnapshot;
        if (parsed.compatVersion !== WORKSPACE_WARM_CACHE_COMPAT_VERSION) {
          fs.unlinkSync(filePath);
          return undefined;
        }
        return parsed;
      } catch {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore stale cache cleanup races
        }
        return undefined;
      }
    },
    write(key, snapshot) {
      const filePath = filePathResolve(key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const payload: WorkspaceWarmCacheSnapshot = {
        ...snapshot,
        createdAtUnixMs: snapshot.createdAtUnixMs ?? now(),
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    },
    delete(key) {
      const filePath = filePathResolve(key);
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore stale cache cleanup races
      }
    },
  };
}
