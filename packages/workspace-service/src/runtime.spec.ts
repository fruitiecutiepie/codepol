import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { builtinPluginsRefresh } from './runtime.js';

const nodeRequire = createRequire(path.join(__dirname, 'runtime.js'));

describe('builtinPluginsRefresh', () => {
  it('re-requires builtin plugin packages so exports are not stuck on first load', () => {
    const first = nodeRequire('@codepol/plugin') as object;
    builtinPluginsRefresh();
    const second = nodeRequire('@codepol/plugin') as object;
    expect(first).not.toBe(second);
  });

  it('runs without throwing when called repeatedly', () => {
    expect(() => {
      builtinPluginsRefresh();
      builtinPluginsRefresh();
    }).not.toThrow();
  });
});

describe('workspaceAnalysisRun builtin refresh', () => {
  it('invokes builtinPluginsRefresh before resolving plugins', async () => {
    const runtime = await import('./runtime.js');
    const spy = vi.spyOn(runtime, 'builtinPluginsRefresh');

    const { workspaceServiceCreate } = await import('./index.js');

    const fs = await import('node:fs');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const { workspacePathToUri } = await import('@codepol/core');

    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'codepol-builtin-refresh-'));
    fs.mkdirSync(pathMod.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      pathMod.join(dir, 'codepol.toml'),
      `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["src"]
`,
      'utf8',
    );
    const filePath = pathMod.join(dir, 'src', 'app.ts');
    fs.writeFileSync(filePath, 'export interface User { name: string }\n', 'utf8');

    try {
      const service = workspaceServiceCreate();
      const { workspaceId } = await service.openWorkspace({
        rootPath: dir,
        configPath: pathMod.join(dir, 'codepol.toml'),
      });
      await service.queryDiagnostics({ workspaceId, uri: workspacePathToUri(filePath) });
      expect(spy).toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      spy.mockRestore();
    }
  });
});
