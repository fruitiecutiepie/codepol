import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_WARM_CACHE_COMPAT_VERSION,
  workspaceWarmCacheEnvironmentIdCreate,
  workspaceWarmCacheFsStoreCreate,
  type WorkspaceWarmCacheSnapshotInput,
} from './warmCache';

function tempDirCreate(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('workspace warm cache store', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('discards a corrupt cache file on read', async () => {
    const runtimeDir = tempDirCreate('codepol-warm-cache-');
    createdDirs.push(runtimeDir);
    const store = workspaceWarmCacheFsStoreCreate({ runtimeDir });
    const key = {
      workspaceId: 'workspace:test',
      rootPath: '/tmp/workspace',
      configPath: '/tmp/workspace/codepol.toml',
    };

    await store.write(key, {
      compatVersion: WORKSPACE_WARM_CACHE_COMPAT_VERSION,
      workspaceId: key.workspaceId,
      rootPath: key.rootPath,
      configPath: key.configPath,
      eslintConfigPath: '/tmp/workspace/eslint.config.js',
      analysisGeneration: 1,
      workspaceIndexRequired: false,
      files: [],
      diagnostics: [],
      treeViolations: [],
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: { readiness: 'ready' },
        workspaceSymbols: { readiness: 'ready' },
        semanticSearch: { readiness: 'ready' },
        dependencyGraph: { readiness: 'ready' },
        architectureSummary: { readiness: 'ready' },
      },
      configFingerprint: {
        path: key.configPath,
        size: 1,
        mtimeMs: 1,
      },
      fileFingerprints: [],
      toolFingerprints: [],
      pluginSignature: 'plugin-signature',
      pluginFingerprints: [],
      createdAtUnixMs: 1,
    });

    const cacheDir = path.join(runtimeDir, 'warm-cache');
    const [cacheFile] = fs.readdirSync(cacheDir);
    expect(cacheFile).toBeDefined();
    fs.writeFileSync(path.join(cacheDir, cacheFile!), '{not valid json', 'utf8');

    await expect(Promise.resolve(store.read(key))).resolves.toBeUndefined();
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });

  it('prunes stale workspace variants when build or environment identity changes', async () => {
    const runtimeDir = tempDirCreate('codepol-warm-cache-');
    createdDirs.push(runtimeDir);
    const key = {
      workspaceId: 'workspace:test',
      rootPath: '/tmp/workspace',
      configPath: '/tmp/workspace/codepol.toml',
    };
    const baseSnapshot: WorkspaceWarmCacheSnapshotInput = {
      compatVersion: WORKSPACE_WARM_CACHE_COMPAT_VERSION,
      workspaceId: key.workspaceId,
      rootPath: key.rootPath,
      configPath: key.configPath,
      eslintConfigPath: '/tmp/workspace/eslint.config.js',
      analysisGeneration: 1,
      workspaceIndexRequired: false,
      files: [],
      diagnostics: [],
      treeViolations: [],
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: { readiness: 'ready' },
        workspaceSymbols: { readiness: 'ready' },
        semanticSearch: { readiness: 'ready' },
        dependencyGraph: { readiness: 'ready' },
        architectureSummary: { readiness: 'ready' },
      },
      configFingerprint: {
        path: key.configPath,
        size: 1,
        mtimeMs: 1,
      },
      fileFingerprints: [],
      toolFingerprints: [],
      pluginSignature: 'plugin-signature',
      pluginFingerprints: [],
      createdAtUnixMs: 1,
    };

    const oldStore = workspaceWarmCacheFsStoreCreate({
      runtimeDir,
      buildId: 'old-build',
      environmentId: 'node:old',
    });
    oldStore.write(key, {
      ...baseSnapshot,
    });

    const cacheDir = path.join(runtimeDir, 'warm-cache');
    expect(fs.readdirSync(cacheDir)).toHaveLength(1);

    const currentStore = workspaceWarmCacheFsStoreCreate({
      runtimeDir,
      buildId: 'new-build',
      environmentId: 'node:new',
    });

    await expect(Promise.resolve(currentStore.read(key))).resolves.toBeUndefined();
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });

  it('derives environment identity from tool-resolution environment variables', () => {
    const base = workspaceWarmCacheEnvironmentIdCreate({
      PATH: '/usr/bin:/bin',
      NODE_PATH: '',
      VIRTUAL_ENV: '',
      CONDA_PREFIX: '',
    });
    const changedPath = workspaceWarmCacheEnvironmentIdCreate({
      PATH: '/opt/tools/bin:/usr/bin:/bin',
      NODE_PATH: '',
      VIRTUAL_ENV: '',
      CONDA_PREFIX: '',
    });
    const changedVirtualEnv = workspaceWarmCacheEnvironmentIdCreate({
      PATH: '/usr/bin:/bin',
      NODE_PATH: '',
      VIRTUAL_ENV: '/tmp/venv',
      CONDA_PREFIX: '',
    });

    expect(base).toMatch(/^node:.*:env:[0-9a-f]{16}$/);
    expect(changedPath).not.toBe(base);
    expect(changedVirtualEnv).not.toBe(base);
  });
});
