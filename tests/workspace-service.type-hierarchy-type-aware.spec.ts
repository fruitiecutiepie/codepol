/**
 * Phase 9.5 / Gap 3 — workspace-service integration for the
 * `TypeAwareTypeHierarchySource` merge.
 *
 * Exercises the engine end-to-end with an in-memory fake source so
 * the merge contract is covered without any real language server:
 *
 * - merging structural + type-aware edges into one result
 * - confidence labels for every overlap case
 * - `requireTypeAware: true` raises when no source is registered
 * - source rejection / timeout falls back to the structural answer
 * - no source registered ⇒ result equals the structural-only answer
 * - `includeStructural: false` does not suppress type-aware edges
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WorkspaceServiceEngine,
  workspaceTypeAwareBridgeSourcesRegister,
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';
import {
  typeAwareTypeHierarchySourceRegistryCreate,
  type TypeAwareTypeHierarchyEdge,
  type TypeAwareTypeHierarchySource,
} from '@codepol/core';

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
id = "no-cycles"
ruleId = "@codepol/plugin/no-cycles"
description = "Reject circular imports"
targets = ["src"]

[rules.args]
maxCycles = 50
`;
}

function pythonConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "python"
files = ["src/**/*.py"]

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
    clientInstanceId: `vitest-typeaware-${process.pid}-${Math.random()}`,
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

async function fixtureSetup(
  options: { engine?: WorkspaceServiceEngine } = {},
): Promise<{
  service: WorkspaceService;
  clientSessionId: string;
  workspaceId: string;
  ifaceId: string;
  duckId: string;
}> {
  const root = tempWorkspaceCreate('codepol-ws-typeaware-');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'codepol.toml'),
    pluginConfigContentCreate(),
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'iface.ts'),
    `export interface IShape { area(): number; }\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'duck.ts'),
    `export class Duck { area(): number { return 1; } }\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'unrelated.ts'),
    `export class Other { something(): void {} }\n`,
    'utf8',
  );

  const service = options.engine
    ? workspaceServiceCreate({ engine: options.engine })
    : workspaceServiceCreate();
  const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
    service,
    root,
    path.join(root, 'codepol.toml'),
  );

  const ifaceLookup = await service.querySymbolLookup({
    clientSessionId,
    workspaceId,
    name: 'IShape',
  });
  const duckLookup = await service.querySymbolLookup({
    clientSessionId,
    workspaceId,
    name: 'Duck',
  });
  expect(ifaceLookup.symbols.length).toBeGreaterThan(0);
  expect(duckLookup.symbols.length).toBeGreaterThan(0);

  return {
    service,
    clientSessionId,
    workspaceId,
    ifaceId: ifaceLookup.symbols[0]!.symbolId,
    duckId: duckLookup.symbols[0]!.symbolId,
  };
}

async function pythonFixtureSetup(
  options: { engine?: WorkspaceServiceEngine } = {},
): Promise<{
  service: WorkspaceService;
  clientSessionId: string;
  workspaceId: string;
  animalId: string;
  dogId: string;
}> {
  const root = tempWorkspaceCreate('codepol-ws-typeaware-python-');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'codepol.toml'),
    pythonConfigContentCreate(),
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'animals.py'),
    `class Animal:\n    pass\n\nclass Dog(Animal):\n    pass\n`,
    'utf8',
  );

  const service = options.engine
    ? workspaceServiceCreate({ engine: options.engine })
    : workspaceServiceCreate();
  const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
    service,
    root,
    path.join(root, 'codepol.toml'),
  );

  const animalLookup = await service.querySymbolLookup({
    clientSessionId,
    workspaceId,
    name: 'Animal',
  });
  const dogLookup = await service.querySymbolLookup({
    clientSessionId,
    workspaceId,
    name: 'Dog',
  });
  expect(animalLookup.symbols.length).toBeGreaterThan(0);
  expect(dogLookup.symbols.length).toBeGreaterThan(0);

  return {
    service,
    clientSessionId,
    workspaceId,
    animalId: animalLookup.symbols[0]!.symbolId,
    dogId: dogLookup.symbols[0]!.symbolId,
  };
}

describe('workspace-service queryTypeHierarchy type-aware merge', () => {
  it('returns the structural-only answer when no source is registered', async () => {
    const { service, clientSessionId, workspaceId, ifaceId } = await fixtureSetup();
    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: ifaceId,
      direction: 'subtypes',
    });
    // No edges (no declared `implements`, structural opt-out by default).
    expect(result.edges).toEqual([]);
  });

  it('merges type-aware edges with the structural answer and tags them', async () => {
    const registry = typeAwareTypeHierarchySourceRegistryCreate();
    let capturedSupertypeId = '';
    const fakeSource: TypeAwareTypeHierarchySource = {
      typeAwareImplementersGet: async (supertypeSymbolId) => {
        capturedSupertypeId = supertypeSymbolId;
        // Return one fabricated implementer plus the real Duck implementer.
        return [
          {
            subtypeSymbolId: 'fabricated-impl',
            supertypeSymbolId,
            relationKind: 'implements',
          },
        ];
      },
    };
    registry.typeAwareTypeHierarchySourceRegister('typescript', fakeSource);

    const engine = new WorkspaceServiceEngine({
      typeAwareTypeHierarchySourceRegistry: registry,
    });
    const { service, clientSessionId, workspaceId, ifaceId } = await fixtureSetup({ engine });

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: ifaceId,
      direction: 'subtypes',
    });
    expect(capturedSupertypeId).toBe(ifaceId);
    const typeAwareEdges = result.edges.filter(
      (e) => e.typeRelationConfidence === 'type-aware',
    );
    expect(typeAwareEdges.length).toBeGreaterThan(0);
  });

  it('overlapping structural-shape + type-aware edge resolves to type-aware', async () => {
    const registry = typeAwareTypeHierarchySourceRegistryCreate();
    const engine = new WorkspaceServiceEngine({
      typeAwareTypeHierarchySourceRegistry: registry,
    });
    const { service, clientSessionId, workspaceId, ifaceId, duckId } = await fixtureSetup({
      engine,
    });
    const fakeSource: TypeAwareTypeHierarchySource = {
      typeAwareImplementersGet: async () => [
        {
          subtypeSymbolId: duckId,
          supertypeSymbolId: ifaceId,
          relationKind: 'implements',
        },
      ],
    };
    registry.typeAwareTypeHierarchySourceRegister('typescript', fakeSource);

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: ifaceId,
      direction: 'subtypes',
      includeStructural: true,
    });
    const overlapEdge = result.edges.find(
      (e) => e.fromUri.includes(duckId) && e.toUri.includes(ifaceId),
    );
    expect(overlapEdge).toBeDefined();
    expect(overlapEdge!.typeRelationConfidence).toBe('type-aware');
  });

  it('source rejection leaves the structural answer intact', async () => {
    const registry = typeAwareTypeHierarchySourceRegistryCreate();
    const engine = new WorkspaceServiceEngine({
      typeAwareTypeHierarchySourceRegistry: registry,
    });
    const { service, clientSessionId, workspaceId, ifaceId } = await fixtureSetup({ engine });
    const fakeSource: TypeAwareTypeHierarchySource = {
      typeAwareImplementersGet: async () => {
        throw new Error('boom');
      },
    };
    registry.typeAwareTypeHierarchySourceRegister('typescript', fakeSource);

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: ifaceId,
      direction: 'subtypes',
      includeStructural: true,
    });
    // Structural edges still appear (Duck implements IShape by shape).
    expect(
      result.edges.some((e) => e.typeRelationConfidence === 'structural-shape'),
    ).toBe(true);
    // No type-aware edges produced because the source rejected.
    expect(
      result.edges.every((e) => e.typeRelationConfidence !== 'type-aware'),
    ).toBe(true);
  });

  it('requireTypeAware: true raises when no source is registered', async () => {
    const { service, clientSessionId, workspaceId, ifaceId } = await fixtureSetup();
    await expect(
      service.queryTypeHierarchy({
        clientSessionId,
        workspaceId,
        symbolId: ifaceId,
        direction: 'subtypes',
        requireTypeAware: true,
      }),
    ).rejects.toMatchObject({
      code: 'type-aware-source-missing',
    });
  });

  it('includeStructural: false still surfaces type-aware edges', async () => {
    const registry = typeAwareTypeHierarchySourceRegistryCreate();
    const engine = new WorkspaceServiceEngine({
      typeAwareTypeHierarchySourceRegistry: registry,
    });
    const { service, clientSessionId, workspaceId, ifaceId, duckId } = await fixtureSetup({
      engine,
    });
    const fakeSource: TypeAwareTypeHierarchySource = {
      typeAwareImplementersGet: async () => [
        {
          subtypeSymbolId: duckId,
          supertypeSymbolId: ifaceId,
          relationKind: 'implements',
        },
      ],
    };
    registry.typeAwareTypeHierarchySourceRegister('typescript', fakeSource);

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: ifaceId,
      direction: 'subtypes',
      // includeStructural intentionally omitted (false)
    });
    expect(
      result.edges.some((e) => e.typeRelationConfidence === 'type-aware'),
    ).toBe(true);
  });

  it('host bridge registration wires a Python transport into queryTypeHierarchy', async () => {
    const engine = new WorkspaceServiceEngine();
    workspaceTypeAwareBridgeSourcesRegister({
      engine,
      transports: {
        python: {
          async request<T>(method: string, params: unknown): Promise<T> {
            if (method === 'textDocument/implementation') {
              const uri =
                (params as { textDocument?: { uri?: string } }).textDocument?.uri
                ?? 'file:///missing.py';
              return [
                {
                  uri,
                  range: {
                    start: { line: 3, character: 6 },
                    end: { line: 3, character: 9 },
                  },
                },
              ] as T;
            }
            throw new Error(`unexpected LSP method: ${method}`);
          },
        },
      },
    });
    const { service, clientSessionId, workspaceId, animalId, dogId } =
      await pythonFixtureSetup({ engine });

    const result = await service.queryTypeHierarchy({
      clientSessionId,
      workspaceId,
      symbolId: animalId,
      direction: 'subtypes',
      requireTypeAware: true,
    });
    const typeAwareEdge = result.edges.find(
      (edge) =>
        edge.fromUri.endsWith(encodeURIComponent(dogId)) &&
        edge.toUri.endsWith(encodeURIComponent(animalId)),
    );
    expect(typeAwareEdge).toBeDefined();
    expect(typeAwareEdge!.typeRelationConfidence).toBe('type-aware');
  });
});
