/**
 * Workspace-service integration tests for `querySymbolsInFileWithCallCounts`.
 *
 * Pins the contract through the engine — symbols that have no
 * indexed function/method declarations get an empty list, ordering
 * is stable, and counts come from the structural call graph.
 *
 * The CodeLens in the editor depends on this round-trip being cheap
 * enough to fire per file open (no per-symbol fan-out), so the
 * "deterministic ordering" case also serves as a smoke test that
 * the helper actually batches.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';
import { workspacePathToUri } from '@codepol/core';

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
    clientInstanceId: `vitest-codelens-rpc-${process.pid}-${Math.random()}`,
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

describe('workspace-service querySymbolsInFileWithCallCounts', () => {
  it('returns an empty item list for files with no indexed function/method declarations', async () => {
    const root = tempWorkspaceCreate('codepol-codelens-rpc-empty-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'consts.ts'),
      `export const X = 1;\nexport const Y = 'two';\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );
    const result = await service.querySymbolsInFileWithCallCounts({
      clientSessionId,
      workspaceId,
      uri: workspacePathToUri(path.join(root, 'src', 'consts.ts')),
    });
    expect(result.items).toEqual([]);
  });

  it('returns counts that match the structural call graph for a file with one caller', async () => {
    const root = tempWorkspaceCreate('codepol-codelens-rpc-one-caller-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    // `target` is called once (by `caller`), so its callerCount is 1.
    // `caller` calls `target` once, so its calleeCount is 1.
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `export function target(): number { return 1; }\n` +
        `export function caller(): number { return target(); }\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );
    const result = await service.querySymbolsInFileWithCallCounts({
      clientSessionId,
      workspaceId,
      uri: workspacePathToUri(path.join(root, 'src', 'a.ts')),
    });
    const byName = new Map(result.items.map((item) => [item.symbol.name, item]));
    expect(byName.get('target')?.callerCount).toBe(1);
    expect(byName.get('target')?.calleeCount).toBe(0);
    expect(byName.get('caller')?.callerCount).toBe(0);
    expect(byName.get('caller')?.calleeCount).toBe(1);
  });

  it('orders items deterministically by declaration position', async () => {
    const root = tempWorkspaceCreate('codepol-codelens-rpc-order-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'order.ts'),
      `export function alpha(): void {}\n` +
        `export function beta(): void {}\n` +
        `export function gamma(): void {}\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );
    const uri = workspacePathToUri(path.join(root, 'src', 'order.ts'));
    const first = await service.querySymbolsInFileWithCallCounts({
      clientSessionId,
      workspaceId,
      uri,
    });
    const second = await service.querySymbolsInFileWithCallCounts({
      clientSessionId,
      workspaceId,
      uri,
    });
    expect(first.items.map((item) => item.symbol.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(second.items.map((item) => item.symbol.name)).toEqual(['alpha', 'beta', 'gamma']);
    // Same symbol ids across runs — important for the editor's CodeLens
    // refresh-and-compare flow (no jitter on stable input).
    expect(second.items.map((item) => item.symbol.symbolId)).toEqual(
      first.items.map((item) => item.symbol.symbolId),
    );
  });

  it('returns an empty item list for unindexed file URIs without throwing', async () => {
    const root = tempWorkspaceCreate('codepol-codelens-rpc-unknown-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `export const x = 1;\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );
    const result = await service.querySymbolsInFileWithCallCounts({
      clientSessionId,
      workspaceId,
      uri: workspacePathToUri(path.join(root, 'src', 'does-not-exist.ts')),
    });
    expect(result.items).toEqual([]);
  });
});
