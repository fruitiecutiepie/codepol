/**
 * Phase 5 (deferred) integration tests for the workspace-service
 * surface that powers the editor's import-specifier hover marker
 * layer.
 *
 * Contract under test: `queryImportSpecifiersInFile` returns one
 * descriptor per import statement whose target resolves to a file
 * inside the indexed workspace; external / unresolved specifiers are
 * dropped because the per-file metric the hover card surfaces
 * (importer / importee counts, layer / package boundary) is meaningful
 * only for in-workspace targets.
 *
 * Determinism is part of the contract — the marker layer applies the
 * order verbatim and decoration churn would force VSCode to re-render
 * gutter glyphs on every refresh.
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
    clientInstanceId: `vitest-import-specifiers-${process.pid}-${Math.random()}`,
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

type ImportFixture = {
  service: WorkspaceService;
  clientSessionId: string;
  workspaceId: string;
  rootPath: string;
  importerUri: string;
  helperUri: string;
  utilUri: string;
};

async function importFixtureCreate(prefix: string): Promise<ImportFixture> {
  const workspaceRoot = tempWorkspaceCreate(prefix);
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, 'codepol.toml'),
    pluginConfigContentCreate(),
    'utf8',
  );
  // helper.ts and util.ts are the in-workspace targets. lodash is an
  // external (unresolved) specifier and must be dropped.
  const helperPath = path.join(workspaceRoot, 'src', 'helper.ts');
  fs.writeFileSync(
    helperPath,
    `export function helper(): number {\n  return 1;\n}\n`,
    'utf8',
  );
  const utilPath = path.join(workspaceRoot, 'src', 'util.ts');
  fs.writeFileSync(
    utilPath,
    `export const util = 'u';\n`,
    'utf8',
  );
  // Importer file with three statements:
  //   line 0: static `import { helper } from './helper'`
  //   line 1: external `import { debounce } from 'lodash'`
  //   line 2: static `import { util } from './util'` (different target,
  //           proves the result is sorted by line)
  const importerPath = path.join(workspaceRoot, 'src', 'importer.ts');
  fs.writeFileSync(
    importerPath,
    `import { helper } from './helper';\n` +
      `import { debounce } from 'lodash';\n` +
      `import { util } from './util';\n` +
      `export const value = helper() + debounce(util.length);\n`,
    'utf8',
  );

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
    importerUri: pathToFileURL(importerPath).href,
    helperUri: pathToFileURL(helperPath).href,
    utilUri: pathToFileURL(utilPath).href,
  };
}

describe('workspace-service queryImportSpecifiersInFile', () => {
  it('returns workspace-resolved imports sorted by start position; external specifiers are dropped', async () => {
    const fixture = await importFixtureCreate('codepol-ws-imp-sort-');
    const result = await fixture.service.queryImportSpecifiersInFile({
      clientSessionId: fixture.clientSessionId,
      workspaceId: fixture.workspaceId,
      uri: fixture.importerUri,
    });
    // Two specifiers (helper + util); the lodash specifier is dropped.
    expect(result.specifiers).toHaveLength(2);
    expect(result.specifiers.map((s) => s.resolvedModuleUri)).toEqual([
      fixture.helperUri,
      fixture.utilUri,
    ]);
    // Sort order: by (range.start.line, range.start.character).
    expect(result.specifiers[0]!.range.start.line).toBe(0);
    expect(result.specifiers[1]!.range.start.line).toBe(2);
  });

  it('classifies static imports as static and reports bindingCount: 1 per single-binding statement', async () => {
    const fixture = await importFixtureCreate('codepol-ws-imp-static-');
    const result = await fixture.service.queryImportSpecifiersInFile({
      clientSessionId: fixture.clientSessionId,
      workspaceId: fixture.workspaceId,
      uri: fixture.importerUri,
    });
    for (const specifier of result.specifiers) {
      expect(specifier.edgeKind).toBe('static');
      expect(specifier.bindingCount).toBe(1);
    }
  });

  it('collapses multiple bindings on the same statement to one descriptor with the right bindingCount', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-imp-multi-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    const utilPath = path.join(workspaceRoot, 'src', 'util.ts');
    fs.writeFileSync(
      utilPath,
      `export const a = 1;\nexport const b = 2;\nexport const c = 3;\n`,
      'utf8',
    );
    const importerPath = path.join(workspaceRoot, 'src', 'importer.ts');
    fs.writeFileSync(
      importerPath,
      `import { a, b, c } from './util';\n` +
        `export const sum = a + b + c;\n`,
      'utf8',
    );
    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );
    const result = await service.queryImportSpecifiersInFile({
      clientSessionId,
      workspaceId,
      uri: pathToFileURL(importerPath).href,
    });
    expect(result.specifiers).toHaveLength(1);
    expect(result.specifiers[0]!.bindingCount).toBe(3);
    expect(result.specifiers[0]!.resolvedModuleUri).toBe(
      pathToFileURL(utilPath).href,
    );
  });

  it('returns an empty array for files without imports', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-imp-empty-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    const filePath = path.join(workspaceRoot, 'src', 'lonely.ts');
    fs.writeFileSync(filePath, `export const x = 42;\n`, 'utf8');
    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );
    const result = await service.queryImportSpecifiersInFile({
      clientSessionId,
      workspaceId,
      uri: pathToFileURL(filePath).href,
    });
    expect(result.specifiers).toEqual([]);
  });

  it('returns an empty array for unindexed (or unknown) URIs without throwing', async () => {
    const fixture = await importFixtureCreate('codepol-ws-imp-unknown-');
    const phantomUri = pathToFileURL(
      path.join(fixture.rootPath, 'src', 'does-not-exist.ts'),
    ).href;
    const result = await fixture.service.queryImportSpecifiersInFile({
      clientSessionId: fixture.clientSessionId,
      workspaceId: fixture.workspaceId,
      uri: phantomUri,
    });
    expect(result).toEqual({ specifiers: [] });
  });

  it('returns an empty array for malformed URIs rather than throwing', async () => {
    const fixture = await importFixtureCreate('codepol-ws-imp-bad-uri-');
    const result = await fixture.service.queryImportSpecifiersInFile({
      clientSessionId: fixture.clientSessionId,
      workspaceId: fixture.workspaceId,
      uri: 'not-a-real-uri',
    });
    expect(result).toEqual({ specifiers: [] });
  });

  it('produces byte-stable JSON across two back-to-back queries', async () => {
    const fixture = await importFixtureCreate('codepol-ws-imp-stable-');
    const first = await fixture.service.queryImportSpecifiersInFile({
      clientSessionId: fixture.clientSessionId,
      workspaceId: fixture.workspaceId,
      uri: fixture.importerUri,
    });
    const second = await fixture.service.queryImportSpecifiersInFile({
      clientSessionId: fixture.clientSessionId,
      workspaceId: fixture.workspaceId,
      uri: fixture.importerUri,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('classifies dynamic imports (await import()) with edgeKind: dynamic', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-imp-dynamic-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    const helperPath = path.join(workspaceRoot, 'src', 'helper.ts');
    fs.writeFileSync(
      helperPath,
      `export const helper = 1;\n`,
      'utf8',
    );
    const importerPath = path.join(workspaceRoot, 'src', 'importer.ts');
    fs.writeFileSync(
      importerPath,
      `export async function load(): Promise<number> {\n` +
        `  const helper = await import('./helper');\n` +
        `  return helper.helper;\n` +
        `}\n`,
      'utf8',
    );
    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );
    const result = await service.queryImportSpecifiersInFile({
      clientSessionId,
      workspaceId,
      uri: pathToFileURL(importerPath).href,
    });
    expect(result.specifiers).toHaveLength(1);
    expect(result.specifiers[0]!.edgeKind).toBe('dynamic');
    expect(result.specifiers[0]!.resolvedModuleUri).toBe(
      pathToFileURL(helperPath).href,
    );
  });

  it('classifies CommonJS require() with edgeKind: cjs', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-imp-cjs-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    const helperPath = path.join(workspaceRoot, 'src', 'helper.ts');
    fs.writeFileSync(
      helperPath,
      `export const helper = 1;\n`,
      'utf8',
    );
    const importerPath = path.join(workspaceRoot, 'src', 'importer.ts');
    fs.writeFileSync(
      importerPath,
      `const helper = require('./helper');\n` +
        `export const value = helper.helper;\n`,
      'utf8',
    );
    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );
    const result = await service.queryImportSpecifiersInFile({
      clientSessionId,
      workspaceId,
      uri: pathToFileURL(importerPath).href,
    });
    expect(result.specifiers).toHaveLength(1);
    expect(result.specifiers[0]!.edgeKind).toBe('cjs');
    expect(result.specifiers[0]!.bindingCount).toBeGreaterThanOrEqual(1);
  });

  it('classifies pure side-effect imports (no bindings) with edgeKind: side_effect and bindingCount: 0', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-imp-side-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    const polyfillPath = path.join(workspaceRoot, 'src', 'polyfill.ts');
    fs.writeFileSync(
      polyfillPath,
      `globalThis.__polyfilled = true;\nexport {};\n`,
      'utf8',
    );
    const importerPath = path.join(workspaceRoot, 'src', 'importer.ts');
    fs.writeFileSync(
      importerPath,
      `import './polyfill';\n` + `export const value = 1;\n`,
      'utf8',
    );
    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );
    const result = await service.queryImportSpecifiersInFile({
      clientSessionId,
      workspaceId,
      uri: pathToFileURL(importerPath).href,
    });
    expect(result.specifiers).toHaveLength(1);
    expect(result.specifiers[0]!.edgeKind).toBe('side_effect');
    expect(result.specifiers[0]!.bindingCount).toBe(0);
    expect(result.specifiers[0]!.resolvedModuleUri).toBe(
      pathToFileURL(polyfillPath).href,
    );
  });

  it('emits two markers when the same target is imported by both a binding statement and a side-effect statement', async () => {
    // Regression for the dedup logic: the binding-vs-import-source
    // suppression must NOT swallow the *second* statement just because
    // both target the same module. Each statement has its own byte
    // range and gets its own marker.
    const workspaceRoot = tempWorkspaceCreate('codepol-ws-imp-dual-');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      pluginConfigContentCreate(),
      'utf8',
    );
    const helperPath = path.join(workspaceRoot, 'src', 'helper.ts');
    fs.writeFileSync(
      helperPath,
      `export const helper = 1;\n`,
      'utf8',
    );
    const importerPath = path.join(workspaceRoot, 'src', 'importer.ts');
    fs.writeFileSync(
      importerPath,
      `import { helper } from './helper';\n` +
        `import './helper';\n` +
        `export const value = helper;\n`,
      'utf8',
    );
    const service = workspaceServiceCreate();
    const { clientSessionId, workspaceId } = await clientWorkspaceAttach(
      service,
      workspaceRoot,
      path.join(workspaceRoot, 'codepol.toml'),
    );
    const result = await service.queryImportSpecifiersInFile({
      clientSessionId,
      workspaceId,
      uri: pathToFileURL(importerPath).href,
    });
    // Expected: one binding marker on line 0, one side-effect marker
    // on line 1. The binding-statement suppression keys on byte-range
    // containment, so it cannot accidentally drop the line-1 marker.
    const lines = result.specifiers
      .map((s) => s.range.start.line)
      .sort((a, b) => a - b);
    expect(lines).toEqual([0, 1]);
    const kinds = result.specifiers
      .map((s) => s.edgeKind)
      .sort();
    expect(kinds).toEqual(['side_effect', 'static']);
    // Both point at the same in-workspace target.
    expect(
      result.specifiers.every(
        (s) => s.resolvedModuleUri === pathToFileURL(helperPath).href,
      ),
    ).toBe(true);
  });
});
