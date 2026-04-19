/**
 * End-to-end test that pins the seam between the new RPC and the
 * symbol CodeLens view-model.
 *
 * The RPC integration spec
 * (`tests/workspace-service.symbols-in-file-with-call-counts.spec.ts`)
 * verifies the workspace returns correct counts; the lens view-model
 * unit spec
 * (`tests/extension-vscode.symbol-code-lens-view-models.spec.ts`)
 * verifies the title/tooltip formatting. Neither catches drift
 * between them — e.g. a future change to the RPC's sort order that
 * the view-model assumes is stable.
 *
 * This spec runs the RPC against a real workspace fixture, feeds the
 * payload straight into `symbolCodeLensViewModelsCreate`, and asserts
 * both halves agree on ordering and on the underlying counts the
 * lens titles encode.
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
import { symbolCodeLensViewModelsCreate } from '../extension-vscode/src/symbolCodeLensViewModels';

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
    clientInstanceId: `vitest-codelens-e2e-${process.pid}-${Math.random()}`,
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

describe('symbol CodeLens end-to-end', () => {
  it('feeds real RPC output through symbolCodeLensViewModelsCreate without losing order or counts', async () => {
    const root = tempWorkspaceCreate('codepol-codelens-e2e-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    // Three functions in declaration order. `target` is called twice
    // (by both `caller` and `meta`); `caller` and `meta` each call
    // `target` once. The lens titles must match exactly.
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `export function target(): number { return 1; }\n` +
        `export function caller(): number { return target(); }\n` +
        `export function meta(): number { return target() + 1; }\n`,
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
    const lenses = symbolCodeLensViewModelsCreate({ result });

    // Order matches RPC ordering one-for-one.
    expect(lenses.map((l) => l.focusSymbolName)).toEqual([
      'target',
      'caller',
      'meta',
    ]);

    // Counts in the rendered title come from the RPC, not from
    // anything the view-model invents. Pin the exact strings so a
    // sort-order or formatting drift fails this test.
    const byName = new Map(lenses.map((l) => [l.focusSymbolName, l]));
    expect(byName.get('target')?.title).toBe('Codepol: 2 callers \u00b7 0 callees');
    expect(byName.get('caller')?.title).toBe('Codepol: 0 callers \u00b7 1 callee');
    expect(byName.get('meta')?.title).toBe('Codepol: 0 callers \u00b7 1 callee');

    // Anchor positions feed straight from the RPC declaration ranges
    // — the view-model must not rewrite them.
    for (const lens of lenses) {
      const item = result.items.find((i) => i.symbol.symbolId === lens.symbolId);
      expect(item).toBeDefined();
      expect(lens.line).toBe(item!.symbol.declarationRange.start.line);
      expect(lens.character).toBe(item!.symbol.declarationRange.start.character);
    }
  });
});
