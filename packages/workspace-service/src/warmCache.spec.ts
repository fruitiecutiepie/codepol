import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_WARM_CACHE_COMPAT_VERSION,
  workspaceWarmCacheFsStoreCreate,
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
      },
      configFingerprint: {
        path: key.configPath,
        size: 1,
        mtimeMs: 1,
      },
      fileFingerprints: [],
      createdAtUnixMs: 1,
    });

    const cacheDir = path.join(runtimeDir, 'warm-cache');
    const [cacheFile] = fs.readdirSync(cacheDir);
    expect(cacheFile).toBeDefined();
    fs.writeFileSync(path.join(cacheDir, cacheFile!), '{not valid json', 'utf8');

    await expect(Promise.resolve(store.read(key))).resolves.toBeUndefined();
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });
});
