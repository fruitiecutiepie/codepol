import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workspaceDaemonDefaultCacheDirResolve } from './daemon';
import {
  WORKSPACE_WARM_CACHE_COMPAT_VERSION,
  workspaceWarmCacheEnvironmentIdCreate,
  workspaceWarmCacheFsStoreCreate,
  type WorkspaceWarmCacheExternalToolConfigEntry,
  type WorkspaceWarmCacheSnapshotInput,
} from './warmCache';

function tempDirCreate(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function snapshotFixtureCreate(
  workspaceId: string,
  rootPath: string,
  configPath: string,
  externalToolConfigs: WorkspaceWarmCacheExternalToolConfigEntry[] = [],
): WorkspaceWarmCacheSnapshotInput {
  return {
    compatVersion: WORKSPACE_WARM_CACHE_COMPAT_VERSION,
    workspaceId,
    rootPath,
    configPath,
    externalToolConfigs,
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
      path: configPath,
      size: 1,
      mtimeMs: 1,
    },
    fileFingerprints: [],
    toolFingerprints: [],
    pluginSignature: 'plugin-signature',
    pluginFingerprints: [],
    createdAtUnixMs: 1,
  };
}

describe('workspace warm cache store', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('discards a corrupt cache file on read', async () => {
    const cacheDir = tempDirCreate('codepol-warm-cache-');
    createdDirs.push(cacheDir);
    const store = workspaceWarmCacheFsStoreCreate({ cacheDir });
    const key = {
      workspaceId: 'workspace:test',
      rootPath: '/tmp/workspace',
      configPath: '/tmp/workspace/codepol.toml',
    };

    await store.write(key, snapshotFixtureCreate(
      key.workspaceId,
      key.rootPath,
      key.configPath,
    ));

    const warmCacheDir = path.join(cacheDir, 'warm-cache');
    const [cacheFile] = fs.readdirSync(warmCacheDir);
    expect(cacheFile).toBeDefined();
    fs.writeFileSync(path.join(warmCacheDir, cacheFile!), '{not valid json', 'utf8');

    await expect(Promise.resolve(store.read(key))).resolves.toBeUndefined();
    expect(fs.readdirSync(warmCacheDir)).toEqual([]);
  });

  it('round-trips a snapshot containing multiple external tool configs', async () => {
    const cacheDir = tempDirCreate('codepol-warm-cache-');
    createdDirs.push(cacheDir);
    const store = workspaceWarmCacheFsStoreCreate({ cacheDir });
    const key = {
      workspaceId: 'workspace:test',
      rootPath: '/tmp/workspace',
      configPath: '/tmp/workspace/codepol.toml',
    };
    const externalToolConfigs: WorkspaceWarmCacheExternalToolConfigEntry[] = [
      {
        analyzerId: 'biome',
        configPath: '/tmp/workspace/biome.json',
        fingerprint: { path: '/tmp/workspace/biome.json', size: 200, mtimeMs: 2000 },
      },
      {
        analyzerId: 'eslint',
        configPath: '/tmp/workspace/eslint.config.mjs',
        fingerprint: { path: '/tmp/workspace/eslint.config.mjs', size: 100, mtimeMs: 1000 },
      },
    ];

    await store.write(key, snapshotFixtureCreate(
      key.workspaceId,
      key.rootPath,
      key.configPath,
      externalToolConfigs,
    ));

    const restored = await Promise.resolve(store.read(key));
    expect(restored).toBeDefined();
    expect(restored?.externalToolConfigs).toEqual(externalToolConfigs);
  });

  it('rejects a v2-shaped snapshot via the compat-version check', async () => {
    const cacheDir = tempDirCreate('codepol-warm-cache-');
    createdDirs.push(cacheDir);
    const store = workspaceWarmCacheFsStoreCreate({ cacheDir });
    const key = {
      workspaceId: 'workspace:test',
      rootPath: '/tmp/workspace',
      configPath: '/tmp/workspace/codepol.toml',
    };

    // Pre-populate the cache directory with a hand-rolled v2 snapshot. The
    // store's read path computes its file path from the same key+identity
    // hash, so we round-trip a real v3 write and overwrite the file with a
    // v2 payload at the same location.
    await store.write(key, snapshotFixtureCreate(
      key.workspaceId,
      key.rootPath,
      key.configPath,
    ));
    const warmCacheDir = path.join(cacheDir, 'warm-cache');
    const [cacheFile] = fs.readdirSync(warmCacheDir);
    expect(cacheFile).toBeDefined();
    const cacheFilePath = path.join(warmCacheDir, cacheFile!);
    const v3Snapshot = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8')) as Record<
      string,
      unknown
    >;
    const v2Snapshot: Record<string, unknown> = {
      ...v3Snapshot,
      compatVersion: 2,
      eslintConfigPath: '/tmp/workspace/eslint.config.mjs',
      eslintConfigFingerprint: {
        path: '/tmp/workspace/eslint.config.mjs',
        size: 1,
        mtimeMs: 1,
      },
    };
    delete v2Snapshot.externalToolConfigs;
    fs.writeFileSync(cacheFilePath, JSON.stringify(v2Snapshot), 'utf8');

    await expect(Promise.resolve(store.read(key))).resolves.toBeUndefined();
    // Stale v2 snapshot is discarded so it can be rebuilt at v3 next run.
    expect(fs.readdirSync(warmCacheDir)).toEqual([]);
  });

  it('prunes stale workspace variants when build or environment identity changes', async () => {
    const cacheDir = tempDirCreate('codepol-warm-cache-');
    createdDirs.push(cacheDir);
    const key = {
      workspaceId: 'workspace:test',
      rootPath: '/tmp/workspace',
      configPath: '/tmp/workspace/codepol.toml',
    };

    const oldStore = workspaceWarmCacheFsStoreCreate({
      cacheDir,
      buildId: 'old-build',
      environmentId: 'node:old',
    });
    oldStore.write(key, snapshotFixtureCreate(
      key.workspaceId,
      key.rootPath,
      key.configPath,
    ));

    const warmCacheDir = path.join(cacheDir, 'warm-cache');
    expect(fs.readdirSync(warmCacheDir)).toHaveLength(1);

    const currentStore = workspaceWarmCacheFsStoreCreate({
      cacheDir,
      buildId: 'new-build',
      environmentId: 'node:new',
    });

    await expect(Promise.resolve(currentStore.read(key))).resolves.toBeUndefined();
    expect(fs.readdirSync(warmCacheDir)).toEqual([]);
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

describe('workspaceDaemonDefaultCacheDirResolve', () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  function platformSet(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  function envClear(): void {
    delete process.env.CODEPOL_DAEMON_CACHE_DIR;
    delete process.env.XDG_CACHE_HOME;
    delete process.env.LOCALAPPDATA;
  }

  beforeEach(() => {
    envClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('honours CODEPOL_DAEMON_CACHE_DIR over every other source', () => {
    process.env.CODEPOL_DAEMON_CACHE_DIR = '/explicit/cache';
    process.env.XDG_CACHE_HOME = '/xdg/cache';
    platformSet('linux');
    expect(workspaceDaemonDefaultCacheDirResolve()).toBe(path.resolve('/explicit/cache'));
  });

  it('uses XDG_CACHE_HOME/codepol when CODEPOL_DAEMON_CACHE_DIR is unset', () => {
    process.env.XDG_CACHE_HOME = '/xdg/cache';
    platformSet('linux');
    expect(workspaceDaemonDefaultCacheDirResolve()).toBe(path.join('/xdg/cache', 'codepol'));
  });

  it('falls back to ~/Library/Caches/codepol on macOS', () => {
    platformSet('darwin');
    expect(workspaceDaemonDefaultCacheDirResolve()).toBe(
      path.join(os.homedir(), 'Library', 'Caches', 'codepol'),
    );
  });

  it('falls back to %LOCALAPPDATA%/codepol/Cache on Windows when LOCALAPPDATA is set', () => {
    process.env.LOCALAPPDATA = 'C:\\Users\\me\\AppData\\Local';
    platformSet('win32');
    expect(workspaceDaemonDefaultCacheDirResolve()).toBe(
      path.join('C:\\Users\\me\\AppData\\Local', 'codepol', 'Cache'),
    );
  });

  it('falls back to a tmpdir-rooted path on Windows when LOCALAPPDATA is missing', () => {
    platformSet('win32');
    const resolved = workspaceDaemonDefaultCacheDirResolve();
    expect(resolved.startsWith(os.tmpdir())).toBe(true);
    expect(resolved).toContain('codepol-cache-');
  });

  it('falls back to ~/.cache/codepol on Linux', () => {
    platformSet('linux');
    expect(workspaceDaemonDefaultCacheDirResolve()).toBe(
      path.join(os.homedir(), '.cache', 'codepol'),
    );
  });
});
