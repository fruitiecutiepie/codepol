/**
 * Workspace-service integration tests for `querySymbolFlow`
 * (Phase 9.1 / Gap 1).
 *
 * The point of these tests is the *contract* through the engine:
 *
 * - `outgoing` returns the flow sites the focus symbol *flows out* of.
 * - `incoming` returns the flow sites whose receiver resolves to the
 *   focus symbol.
 * - Edges are sorted deterministically by
 *   `(file, range.start.line, range.start.character, argumentIndex)`.
 * - The result for an unknown symbol id is an empty edge list (never
 *   `undefined`), so editor surfaces can render without null guards.
 *
 * Symbol-id discovery happens via `querySymbolLookup` so the test does
 * not bake a brittle hash-id into its assertions.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    clientInstanceId: `vitest-symbol-flow-${process.pid}-${Math.random()}`,
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

async function symbolIdLookup(
  service: WorkspaceService,
  clientSessionId: string,
  workspaceId: string,
  name: string,
): Promise<string> {
  const result = await service.querySymbolLookup({
    clientSessionId,
    workspaceId,
    name,
  });
  expect(result.symbols.length).toBeGreaterThan(0);
  return result.symbols[0]!.symbolId;
}

describe('workspace-service querySymbolFlow', () => {
  it('returns an empty edge list when the symbol id is unknown', async () => {
    const root = tempWorkspaceCreate('codepol-ws-symflow-unknown-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `export function alpha(): number { return 1; }\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );

    const result = await service.querySymbolFlow({
      clientSessionId,
      workspaceId,
      symbolId: 'nope',
      direction: 'outgoing',
    });
    expect(result.edges).toEqual([]);
  });

  it('returns outgoing flow sites for a function used as a callback', async () => {
    const root = tempWorkspaceCreate('codepol-ws-symflow-outgoing-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `function handler(): void {}\n` +
        `function combine(a: () => void, b: () => void): void {}\n` +
        `function run(): void { combine(handler, handler); }\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );

    const handlerId = await symbolIdLookup(
      service,
      clientSessionId,
      workspaceId,
      'handler',
    );
    const result = await service.querySymbolFlow({
      clientSessionId,
      workspaceId,
      symbolId: handlerId,
      direction: 'outgoing',
    });
    expect(result.edges.length).toBe(2);
    expect(result.edges[0].flowKind).toBe('argument');
    // Deterministic ordering by argumentIndex within the same call.
    expect(result.edges[0].argumentIndex).toBe(0);
    expect(result.edges[1].argumentIndex).toBe(1);
  });

  it('returns incoming flow sites for a function whose receivers resolve', async () => {
    const root = tempWorkspaceCreate('codepol-ws-symflow-incoming-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `function handler(): void {}\n` +
        `function register(cb: () => void): void {}\n` +
        `function run(): void { register(handler); }\n`,
      'utf8',
    );

    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      root,
      path.join(root, 'codepol.toml'),
    );

    const registerId = await symbolIdLookup(
      service,
      clientSessionId,
      workspaceId,
      'register',
    );
    const result = await service.querySymbolFlow({
      clientSessionId,
      workspaceId,
      symbolId: registerId,
      direction: 'incoming',
    });
    expect(result.edges.length).toBe(1);
    expect(result.edges[0].receivingCallSymbolId).toBe(registerId);
  });
});
