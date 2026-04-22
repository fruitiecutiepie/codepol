/**
 * Phase 9.4 / Gap 3 — workspace-service integration for the
 * structural-shape extension to `queryTypeHierarchy`.
 *
 * Drives `WorkspaceServiceEngine` end-to-end with a real index over
 * a small TypeScript fixture and asserts:
 *
 * - default behavior (no `includeStructural`, no source) is
 *   byte-identical to today's result
 * - with `includeStructural: true`, structural-shape edges appear
 *   tagged `typeRelationConfidence: 'structural-shape'`
 * - `minConfidence` filtering drops lower-tier edges
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceServiceCreate, type WorkspaceService } from '@codepol/workspace-service';

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

function targetConfigContentCreate(language: 'typescript' | 'python'): string {
  const files = language === 'python' ? 'src/**/*.py' : 'src/**/*.ts';
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "${language}"
files = ["${files}"]

[[rules]]
id = "no-cycles"
ruleId = "@codepol/plugin/no-cycles"
description = "Reject circular imports"
targets = ["src"]

[rules.args]
maxCycles = 50
`;
}

async function clientWorkspaceAttach(
  service: WorkspaceService,
  rootPath: string,
  configPath: string,
): Promise<{ clientSessionId: string; workspaceId: string }> {
  const registered = await service.registerClientSession({
    clientKind: 'test',
    clientInstanceId: `vitest-shape-${process.pid}-${Math.random()}`,
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

async function workspaceFixtureSetup(input: {
  language: 'typescript' | 'python';
  files: Record<string, string>;
}): Promise<{
  service: WorkspaceService;
  clientSessionId: string;
  workspaceId: string;
}> {
  const prefix =
    input.language === 'python'
      ? 'codepol-ws-typehier-shape-python-'
      : 'codepol-ws-typehier-shape-';
  const root = tempWorkspaceCreate(prefix);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'codepol.toml'),
    targetConfigContentCreate(input.language),
    'utf8',
  );
  for (const [relativePath, contents] of Object.entries(input.files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
  }
  const service = workspaceServiceCreate();
  const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
    service,
    root,
    path.join(root, 'codepol.toml'),
  );
  return { service, clientSessionId, workspaceId };
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

describe('workspace-service queryTypeHierarchy structural-shape', () => {
  it('default mode is byte-identical to the legacy result (no structural edges)', async () => {
    const { service, clientSessionId, workspaceId } = await workspaceFixtureSetup({
      language: 'typescript',
      files: {
        'src/iface.ts': `export interface IShape {\n  area(): number;\n}\n`,
        'src/duck.ts': `export class Duck {\n  area(): number { return 1; }\n}\n`,
      },
    });
    const ifaceId = await symbolIdLookup(service, clientSessionId, workspaceId, 'IShape');

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: ifaceId,
      direction: 'subtypes',
    });

    // Seed node only — no declared `implements`, no structural edges
    // because `includeStructural` defaults to false.
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toEqual([]);
    // No `typeRelationConfidence` on any edge in the legacy default
    // path (defensive — `edges` is empty here, but the contract
    // requires no extra fields when nothing was opted into).
  });

  it('surfaces structural-shape edges when includeStructural=true', async () => {
    const { service, clientSessionId, workspaceId } = await workspaceFixtureSetup({
      language: 'typescript',
      files: {
        'src/iface.ts': `export interface IShape {\n  area(): number;\n}\n`,
        'src/duck.ts': `export class Duck {\n  area(): number { return 1; }\n}\n`,
      },
    });
    const ifaceId = await symbolIdLookup(service, clientSessionId, workspaceId, 'IShape');
    const duckId = await symbolIdLookup(service, clientSessionId, workspaceId, 'Duck');

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: ifaceId,
      direction: 'subtypes',
      includeStructural: true,
    });

    // The structural BFS adds the implementer node and one edge tagged
    // `'structural-shape'`.
    const symbolIds = result.nodes.map((n) => n.symbolId).sort();
    expect(symbolIds).toContain(ifaceId);
    expect(symbolIds).toContain(duckId);

    expect(result.edges.length).toBeGreaterThan(0);
    const structuralEdge = result.edges.find(
      (e) => e.typeRelationConfidence === 'structural-shape',
    );
    expect(structuralEdge).toBeDefined();
  });

  it('minConfidence=type-aware drops structural-shape edges', async () => {
    const { service, clientSessionId, workspaceId } = await workspaceFixtureSetup({
      language: 'typescript',
      files: {
        'src/iface.ts': `export interface IShape {\n  area(): number;\n}\n`,
        'src/duck.ts': `export class Duck {\n  area(): number { return 1; }\n}\n`,
      },
    });
    const ifaceId = await symbolIdLookup(service, clientSessionId, workspaceId, 'IShape');

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: ifaceId,
      direction: 'subtypes',
      includeStructural: true,
      minConfidence: 'type-aware',
    });

    // Filtering to `'type-aware'` (without a registered source) drops
    // every structural-shape edge while still surfacing the BFS-discovered
    // nodes (the implementer was added by the structural traversal but
    // its edge is filtered out).
    expect(
      result.edges.every((e) => e.typeRelationConfidence === 'type-aware'),
    ).toBe(true);
  });

  it('surfaces structural-shape edges for Python Protocol contracts too', async () => {
    const { service, clientSessionId, workspaceId } = await workspaceFixtureSetup({
      language: 'python',
      files: {
        'src/protocols.py': [
          'from typing import Protocol',
          '',
          'class ReaderProtocol(Protocol):',
          '    def read(self, size):',
          '        ...',
          '',
        ].join('\n'),
        'src/duck.py': [
          'class DuckReader:',
          '    def read(self, size):',
          "        return ''",
          '',
        ].join('\n'),
      },
    });
    const protocolId = await symbolIdLookup(
      service,
      clientSessionId,
      workspaceId,
      'ReaderProtocol',
    );
    const duckId = await symbolIdLookup(service, clientSessionId, workspaceId, 'DuckReader');

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: protocolId,
      direction: 'subtypes',
      includeStructural: true,
    });

    const symbolIds = result.nodes.map((n) => n.symbolId).sort();
    expect(symbolIds).toContain(protocolId);
    expect(symbolIds).toContain(duckId);

    const structuralEdge = result.edges.find(
      (edge) => edge.typeRelationConfidence === 'structural-shape',
    );
    expect(structuralEdge).toBeDefined();
  });
});
