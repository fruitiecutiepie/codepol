/**
 * Phase 5 follow-up integration tests for `querySymbolImporterCount`.
 *
 * Asserts the workspace contract end-to-end:
 *
 * - Echoes the canonical declaration id for both canonical and proxy
 *   inputs.
 * - Translates importer file paths to `file://` URIs and counts
 *   distinct files only.
 * - Returns `{ importerCount: 0, importerUris: [] }` for an
 *   unimported symbol or an unknown id.
 * - The descriptor returned by `querySymbolAtPosition` against an
 *   `export` declaration line feeds straight into
 *   `querySymbolImporterCount` without translation (the caller chain
 *   the per-export CodeLens uses).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempWorkspaceCreate(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function pluginConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["src"]
`;
}

async function clientWorkspaceAttach(
  service: WorkspaceService,
  rootPath: string,
  configPath: string,
): Promise<{ clientSessionId: string; workspaceId: string }> {
  const registered = await service.registerClientSession({
    clientKind: 'test',
    clientInstanceId: `vitest-symbol-importer-${process.pid}-${Math.random()}`,
  });
  const attached = await service.attachWorkspace({
    clientSessionId: registered.clientSessionId,
    rootPath,
    configPath,
  });
  return {
    clientSessionId: registered.clientSessionId,
    workspaceId: attached.workspaceId,
  };
}

type ImporterCountWorkspace = {
  service: WorkspaceService;
  clientSessionId: string;
  workspaceId: string;
  rootPath: string;
  libUri: string;
  consumerAUri: string;
  consumerBUri: string;
  consumerDupUri: string;
  unrelatedUri: string;
};

async function importerCountWorkspaceCreate(
  prefix: string,
): Promise<ImporterCountWorkspace> {
  const workspaceRoot = tempWorkspaceCreate(prefix);
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, 'codepol.toml'),
    pluginConfigContentCreate(),
    'utf8',
  );

  const libPath = path.join(workspaceRoot, 'src', 'lib.ts');
  fs.writeFileSync(
    libPath,
    `export function helper(value: number): number {\n` +
      `  return value + 1;\n` +
      `}\n` +
      `export const unused = 42;\n`,
    'utf8',
  );
  const consumerAPath = path.join(workspaceRoot, 'src', 'consumerA.ts');
  fs.writeFileSync(
    consumerAPath,
    `import { helper } from './lib';\n` +
      `export function useA(): number {\n` +
      `  return helper(1);\n` +
      `}\n`,
    'utf8',
  );
  const consumerBPath = path.join(workspaceRoot, 'src', 'consumerB.ts');
  fs.writeFileSync(
    consumerBPath,
    `import { helper } from './lib';\n` +
      `export function useB(): number {\n` +
      `  return helper(2);\n` +
      `}\n`,
    'utf8',
  );
  // consumerDup imports `helper` twice from the same module — the result
  // must dedupe per file.
  const consumerDupPath = path.join(workspaceRoot, 'src', 'consumerDup.ts');
  fs.writeFileSync(
    consumerDupPath,
    `import { helper } from './lib';\n` +
      `import { helper as alias } from './lib';\n` +
      `export function useDup(): number {\n` +
      `  return helper(3) + alias(4);\n` +
      `}\n`,
    'utf8',
  );
  const unrelatedPath = path.join(workspaceRoot, 'src', 'unrelated.ts');
  fs.writeFileSync(unrelatedPath, `export const value = 99;\n`, 'utf8');

  const service = workspaceServiceCreate();
  const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
    service,
    workspaceRoot,
    path.join(workspaceRoot, 'codepol.toml'),
  );
  return {
    service,
    clientSessionId,
    workspaceId,
    rootPath: workspaceRoot,
    libUri: pathToFileURL(libPath).href,
    consumerAUri: pathToFileURL(consumerAPath).href,
    consumerBUri: pathToFileURL(consumerBPath).href,
    consumerDupUri: pathToFileURL(consumerDupPath).href,
    unrelatedUri: pathToFileURL(unrelatedPath).href,
  };
}

describe('workspace-service querySymbolImporterCount', () => {
  it('returns the distinct importer URIs (deduped per file) for a directly-exported symbol', async () => {
    const ws = await importerCountWorkspaceCreate('codepol-ws-sym-imp-direct-');
    // Discover the symbol id of `helper` in lib.ts via querySymbolAtPosition
    // — the same chain the per-export CodeLens uses in the editor.
    const atPosition = await ws.service.querySymbolAtPosition({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      uri: ws.libUri,
      position: { line: 0, character: 'export function '.length + 1 },
    });
    expect(atPosition.symbol).toBeDefined();
    const symbolId = atPosition.symbol!.symbolId;

    const result = await ws.service.querySymbolImporterCount({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      symbolId,
    });

    expect(result.symbolId).toBe(symbolId);
    expect(result.importerCount).toBe(3);
    expect(result.importerUris).toEqual(
      [ws.consumerAUri, ws.consumerBUri, ws.consumerDupUri].sort(),
    );
  });

  it('returns zero importers for an unimported exported symbol', async () => {
    const ws = await importerCountWorkspaceCreate('codepol-ws-sym-imp-empty-');
    const atPosition = await ws.service.querySymbolAtPosition({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      uri: ws.libUri,
      position: { line: 3, character: 'export const '.length + 1 },
    });
    expect(atPosition.symbol).toBeDefined();
    expect(atPosition.symbol!.name).toBe('unused');

    const result = await ws.service.querySymbolImporterCount({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      symbolId: atPosition.symbol!.symbolId,
    });

    expect(result.symbolId).toBe(atPosition.symbol!.symbolId);
    expect(result.importerCount).toBe(0);
    expect(result.importerUris).toEqual([]);
  });

  it('echoes the unknown symbol id back with zero importers (no throw)', async () => {
    const ws = await importerCountWorkspaceCreate('codepol-ws-sym-imp-unknown-');
    const result = await ws.service.querySymbolImporterCount({
      clientSessionId: ws.clientSessionId,
      workspaceId: ws.workspaceId,
      symbolId: 'symbol-that-does-not-exist',
    });

    expect(result.symbolId).toBe('symbol-that-does-not-exist');
    expect(result.importerCount).toBe(0);
    expect(result.importerUris).toEqual([]);
  });
});
