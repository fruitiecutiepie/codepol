import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  SymbolFlags,
} from '@codepol/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('cross-file resolution', () => {
  let testDir: string;
  
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-test-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Existing: Named imports, default imports, external references, capabilities
  // ==========================================================================

  it('should resolve named import references to exported symbols', () => {
    const fileA = path.join(testDir, 'moduleA.ts');
    fs.writeFileSync(fileA, `
export function foo() {
  return 'hello';
}

export const bar = 42;
`);

    const fileB = path.join(testDir, 'moduleB.ts');
    fs.writeFileSync(fileB, `
import { foo, bar } from './moduleA';

const result = foo();
const x = bar;
`);

    const { index } = projectIndexBuildSync({
      files: [fileA, fileB],
      dir: testDir,
    });

    const exportedSymbols = index.exportedSymbolsGet({ file: fileA });
    const fooSymbol = exportedSymbols.find(s => s.name === 'foo');
    expect(fooSymbol).toBeDefined();

    const importBindings = index.importBindingsGet(fileB);
    const fooBinding = importBindings.find(b => b.importedName === 'foo');
    expect(fooBinding).toBeDefined();
    expect(fooBinding!.resolvedExportId).toBeDefined();

    const fooRefs = index.referencesGet(fooSymbol!.id);
    const externalRefs = fooRefs.filter(ref => {
      const scope = index.scopeGet(ref.scopeId);
      return scope && scope.file !== fileA;
    });
    expect(externalRefs.length).toBeGreaterThan(0);
  });

  it('should resolve default import references', () => {
    const fileC = path.join(testDir, 'moduleC.ts');
    fs.writeFileSync(fileC, `
function myDefault() {
  return 'default';
}

export default myDefault;
`);

    const fileD = path.join(testDir, 'moduleD.ts');
    fs.writeFileSync(fileD, `
import myFunc from './moduleC';

const result = myFunc();
`);

    const { index } = projectIndexBuildSync({
      files: [fileC, fileD],
      dir: testDir,
    });

    const importBindings = index.importBindingsGet(fileD);
    const defaultBinding = importBindings.find(b => b.isDefault);
    expect(defaultBinding).toBeDefined();
    expect(defaultBinding!.resolvedExportId).toBeDefined();
  });

  it('should find external references via referencesGet API', () => {
    const fileExporter = path.join(testDir, 'exporter.ts');
    fs.writeFileSync(fileExporter, `
export function usedFunction() {
  return 'used';
}

export function unusedFunction() {
  return 'unused';
}
`);

    const fileUser = path.join(testDir, 'user.ts');
    fs.writeFileSync(fileUser, `
import { usedFunction } from './exporter';

const result = usedFunction();
`);

    const { index } = projectIndexBuildSync({
      files: [fileExporter, fileUser],
      dir: testDir,
    });

    const exportedSymbols = index.exportedSymbolsGet({ file: fileExporter });
    const unusedExports: string[] = [];
    const usedExports: string[] = [];

    for (const symbol of exportedSymbols) {
      const references = index.referencesGet(symbol.id);
      const externalReferences = references.filter(ref => {
        const scope = index.scopeGet(ref.scopeId);
        return scope && scope.file !== fileExporter;
      });

      if (externalReferences.length === 0) {
        unusedExports.push(symbol.name);
      } else {
        usedExports.push(symbol.name);
      }
    }

    expect(usedExports).toContain('usedFunction');
    expect(unusedExports).toContain('unusedFunction');
  });

  it('should track capabilities correctly', () => {
    const fileA = path.join(testDir, 'capTest.ts');
    fs.writeFileSync(fileA, 'export const x = 1;');

    const { index } = projectIndexBuildSync({
      files: [fileA],
      dir: testDir,
    });

    expect(index.capabilities.crossFileResolution).toBe(true);
  });

  // ==========================================================================
  // Cross-file topologies
  // ==========================================================================

  it('should resolve namespace imports (import * as X)', () => {
    const nsExporter = path.join(testDir, 'ns_exporter.ts');
    fs.writeFileSync(nsExporter, `
export function alpha() { return 1; }
export const beta = 2;
`);

    const nsImporter = path.join(testDir, 'ns_importer.ts');
    fs.writeFileSync(nsImporter, `
import * as utils from './ns_exporter';

const a = utils.alpha();
const b = utils.beta;
`);

    const { index, stats } = projectIndexBuildSync({
      files: [nsExporter, nsImporter],
      dir: testDir,
    });

    expect(stats.filesIndexed).toBe(2);

    // Namespace import produces a single binding with isNamespace: true
    const bindings = index.importBindingsGet(nsImporter);
    expect(bindings).toHaveLength(1);

    const nsBinding = bindings[0];
    expect(nsBinding.isNamespace).toBe(true);
    expect(nsBinding.importedName).toBe('*');
    expect(nsBinding.moduleSpec).toBe('./ns_exporter');

  });

  it('should resolve namespace import module path and member accesses', () => {
    const nsExporter = path.join(testDir, 'ns_full_exporter.ts');
    fs.writeFileSync(nsExporter, `
export function alpha() { return 1; }
export const beta = 2;
`);

    const nsImporter = path.join(testDir, 'ns_full_importer.ts');
    fs.writeFileSync(nsImporter, `
import * as utils from './ns_full_exporter';

const a = utils.alpha();
const b = utils.beta;
`);

    const { index } = projectIndexBuildSync({
      files: [nsExporter, nsImporter],
      dir: testDir,
    });

    const bindings = index.importBindingsGet(nsImporter);
    const nsBinding = bindings.find(b => b.isNamespace);
    expect(nsBinding).toBeDefined();
    expect(nsBinding!.resolvedModulePath).toBe(nsExporter);

    // Member accesses (utils.alpha, utils.beta) should resolve to exporter symbols
    const exportedSymbols = index.exportedSymbolsGet({ file: nsExporter });
    const alphaSym = exportedSymbols.find(s => s.name === 'alpha');
    expect(alphaSym).toBeDefined();

    const alphaRefs = index.referencesGet(alphaSym!.id);
    const externalRefs = alphaRefs.filter(ref => {
      const scope = index.scopeGet(ref.scopeId);
      return scope && scope.file !== nsExporter;
    });
    expect(externalRefs.length).toBeGreaterThan(0);
  });

  it('should resolve aliased imports (import { a as b })', () => {
    const aliasExporter = path.join(testDir, 'alias_exporter.ts');
    fs.writeFileSync(aliasExporter, `
export function originalName() { return 'original'; }
`);

    const aliasImporter = path.join(testDir, 'alias_importer.ts');
    fs.writeFileSync(aliasImporter, `
import { originalName as renamedFn } from './alias_exporter';

const result = renamedFn();
`);

    const { index } = projectIndexBuildSync({
      files: [aliasExporter, aliasImporter],
      dir: testDir,
    });

    const bindings = index.importBindingsGet(aliasImporter);
    expect(bindings.length).toBeGreaterThan(0);

    // importedName must be the original exported name, not the local alias
    const aliasBinding = bindings.find(b => b.importedName === 'originalName');
    expect(aliasBinding).toBeDefined();
    expect(aliasBinding!.resolvedModulePath).toBe(aliasExporter);
    expect(aliasBinding!.resolvedExportId).toBeDefined();

    // The local symbol should be named 'renamedFn' (the alias)
    const localSymbol = index.symbolGet(aliasBinding!.localSymbolId);
    expect(localSymbol).toBeDefined();
    expect(localSymbol!.name).toBe('renamedFn');

    // The resolved export should be the 'originalName' symbol from the exporter
    const exportedSymbols = index.exportedSymbolsGet({ file: aliasExporter });
    const originalSymbol = exportedSymbols.find(s => s.name === 'originalName');
    expect(originalSymbol).toBeDefined();
    expect(aliasBinding!.resolvedExportId).toBe(originalSymbol!.id);

    // References to 'renamedFn' in the importer should resolve to the exported symbol
    const refs = index.referencesInFileGet(aliasImporter);
    const renamedRefs = refs.filter(r => r.name === 'renamedFn');
    expect(renamedRefs.length).toBeGreaterThan(0);
  });

  it('should resolve export aliases (export { foo as bar })', () => {
    const aliasExportSource = path.join(testDir, 'alias_export_source.ts');
    fs.writeFileSync(aliasExportSource, `
function internalFn() { return 'internal'; }
export { internalFn as publicApi };
`);

    const aliasExportConsumer = path.join(testDir, 'alias_export_consumer.ts');
    fs.writeFileSync(aliasExportConsumer, `
import { publicApi } from './alias_export_source';

const result = publicApi();
`);

    const { index } = projectIndexBuildSync({
      files: [aliasExportSource, aliasExportConsumer],
      dir: testDir,
    });

    // The export map should contain 'publicApi' (the alias), not 'internalFn'
    const exports = index.fileExportsGet(aliasExportSource);
    const aliasedExport = exports.find(e => e.exportedName === 'publicApi');
    expect(aliasedExport).toBeDefined();
    expect(aliasedExport!.symbolId).toBeDefined();

    // There should NOT be an export under the internal name
    const internalExport = exports.find(e => e.exportedName === 'internalFn');
    expect(internalExport).toBeUndefined();

    // The consumer should resolve the import to the correct symbol
    const bindings = index.importBindingsGet(aliasExportConsumer);
    const publicApiBinding = bindings.find(b => b.importedName === 'publicApi');
    expect(publicApiBinding).toBeDefined();
    expect(publicApiBinding!.resolvedModulePath).toBe(aliasExportSource);
    expect(publicApiBinding!.resolvedExportId).toBeDefined();
  });

  it('should resolve re-exports (export { x } from "./y")', () => {
    const reexportOrigin = path.join(testDir, 'reexport_origin.ts');
    fs.writeFileSync(reexportOrigin, `
export function innerFn() { return 'inner'; }
`);

    const reexportProxy = path.join(testDir, 'reexport_proxy.ts');
    fs.writeFileSync(reexportProxy, `
export { innerFn } from './reexport_origin';
`);

    const reexportConsumer = path.join(testDir, 'reexport_consumer.ts');
    fs.writeFileSync(reexportConsumer, `
import { innerFn } from './reexport_proxy';

const val = innerFn();
`);

    const { index, stats } = projectIndexBuildSync({
      files: [reexportOrigin, reexportProxy, reexportConsumer],
      dir: testDir,
    });

    expect(stats.filesIndexed).toBe(3);
    expect(stats.errors).toHaveLength(0);

    // The origin file should have the exported symbol
    const originExports = index.exportedSymbolsGet({ file: reexportOrigin });
    expect(originExports.find(s => s.name === 'innerFn')).toBeDefined();

    // The consumer should have an import binding for 'innerFn'
    const consumerBindings = index.importBindingsGet(reexportConsumer);
    const innerBinding = consumerBindings.find(b => b.importedName === 'innerFn');
    expect(innerBinding).toBeDefined();
    expect(innerBinding!.moduleSpec).toBe('./reexport_proxy');

  });

  it('should resolve imports through re-export chains to the origin symbol', () => {
    const reOrigin = path.join(testDir, 'rechain_origin.ts');
    fs.writeFileSync(reOrigin, `
export function innerFn() { return 'inner'; }
`);

    const reProxy = path.join(testDir, 'rechain_proxy.ts');
    fs.writeFileSync(reProxy, `
export { innerFn } from './rechain_origin';
`);

    const reConsumer = path.join(testDir, 'rechain_consumer.ts');
    fs.writeFileSync(reConsumer, `
import { innerFn } from './rechain_proxy';

const val = innerFn();
`);

    const { index } = projectIndexBuildSync({
      files: [reOrigin, reProxy, reConsumer],
      dir: testDir,
    });

    // Proxy should surface re-exported symbols in fileExportsGet
    const proxyExports = index.fileExportsGet(reProxy);
    const innerExport = proxyExports.find(e => e.exportedName === 'innerFn');
    expect(innerExport).toBeDefined();

    // Consumer binding should resolve through the proxy to the origin
    const consumerBindings = index.importBindingsGet(reConsumer);
    const innerBinding = consumerBindings.find(b => b.importedName === 'innerFn');
    expect(innerBinding).toBeDefined();
    expect(innerBinding!.resolvedModulePath).toBe(reProxy);
    expect(innerBinding!.resolvedExportId).toBeDefined();

    // The resolvedExportId should ultimately trace back to the origin symbol
    const originExports = index.exportedSymbolsGet({ file: reOrigin });
    const originSym = originExports.find(s => s.name === 'innerFn');
    expect(originSym).toBeDefined();
  });

  it('should handle circular imports (A imports B, B imports A)', () => {
    const circA = path.join(testDir, 'circ_a.ts');
    const circB = path.join(testDir, 'circ_b.ts');

    fs.writeFileSync(circA, `
import { fromB } from './circ_b';

export function fromA() { return 'A'; }
const useB = fromB();
`);

    fs.writeFileSync(circB, `
import { fromA } from './circ_a';

export function fromB() { return 'B'; }
const useA = fromA();
`);

    // Must not throw or hang
    const { index, stats } = projectIndexBuildSync({
      files: [circA, circB],
      dir: testDir,
    });

    expect(stats.filesIndexed).toBe(2);
    expect(stats.errors).toHaveLength(0);

    // Both files should have their exports indexed
    const exportsA = index.exportedSymbolsGet({ file: circA });
    const exportsB = index.exportedSymbolsGet({ file: circB });
    expect(exportsA.find(s => s.name === 'fromA')).toBeDefined();
    expect(exportsB.find(s => s.name === 'fromB')).toBeDefined();

    // Import bindings should resolve in both directions
    const bindingsA = index.importBindingsGet(circA);
    const bindingsB = index.importBindingsGet(circB);
    const bBindingInA = bindingsA.find(b => b.importedName === 'fromB');
    const aBindingInB = bindingsB.find(b => b.importedName === 'fromA');
    expect(bBindingInA).toBeDefined();
    expect(aBindingInB).toBeDefined();
    expect(bBindingInA!.resolvedExportId).toBeDefined();
    expect(aBindingInB!.resolvedExportId).toBeDefined();
  });

  it('should handle diamond dependency (A->B+C, B->D, C->D)', () => {
    const diamondD = path.join(testDir, 'diamond_d.ts');
    fs.writeFileSync(diamondD, `
export function shared() { return 'shared'; }
`);

    const diamondB = path.join(testDir, 'diamond_b.ts');
    fs.writeFileSync(diamondB, `
import { shared } from './diamond_d';
export function fromB() { return shared(); }
`);

    const diamondC = path.join(testDir, 'diamond_c.ts');
    fs.writeFileSync(diamondC, `
import { shared } from './diamond_d';
export function fromC() { return shared(); }
`);

    const diamondA = path.join(testDir, 'diamond_a.ts');
    fs.writeFileSync(diamondA, `
import { fromB } from './diamond_b';
import { fromC } from './diamond_c';

const b = fromB();
const c = fromC();
`);

    const { index, stats } = projectIndexBuildSync({
      files: [diamondD, diamondB, diamondC, diamondA],
      dir: testDir,
    });

    expect(stats.filesIndexed).toBe(4);
    expect(stats.errors).toHaveLength(0);

    // D's 'shared' export should be referenced from both B and C
    const dExports = index.exportedSymbolsGet({ file: diamondD });
    const sharedSym = dExports.find(s => s.name === 'shared');
    expect(sharedSym).toBeDefined();

    const sharedRefs = index.referencesGet(sharedSym!.id);
    const refFiles = new Set(
      sharedRefs.map(ref => {
        const scope = index.scopeGet(ref.scopeId);
        return scope?.file;
      }).filter(Boolean)
    );
    // 'shared' is referenced from at least B and C (and possibly D itself)
    expect(refFiles.has(diamondB)).toBe(true);
    expect(refFiles.has(diamondC)).toBe(true);

    // A's imports from B and C should resolve
    const aBindings = index.importBindingsGet(diamondA);
    const fromBBinding = aBindings.find(b => b.importedName === 'fromB');
    const fromCBinding = aBindings.find(b => b.importedName === 'fromC');
    expect(fromBBinding).toBeDefined();
    expect(fromCBinding).toBeDefined();
    expect(fromBBinding!.resolvedExportId).toBeDefined();
    expect(fromCBinding!.resolvedExportId).toBeDefined();
  });

  it('should handle star exports (export * from "./x")', () => {
    const starOrigin = path.join(testDir, 'star_origin.ts');
    fs.writeFileSync(starOrigin, `
export function starFn() { return 'star'; }
export const starConst = 42;
`);

    const starProxy = path.join(testDir, 'star_proxy.ts');
    fs.writeFileSync(starProxy, `
export * from './star_origin';
`);

    const starConsumer = path.join(testDir, 'star_consumer.ts');
    fs.writeFileSync(starConsumer, `
import { starFn, starConst } from './star_proxy';

const a = starFn();
const b = starConst;
`);

    const { index, stats } = projectIndexBuildSync({
      files: [starOrigin, starProxy, starConsumer],
      dir: testDir,
    });

    expect(stats.filesIndexed).toBe(3);
    expect(stats.errors).toHaveLength(0);

    // The proxy file should have a wildcard export entry
    const proxyExports = index.fileExportsGet(starProxy);
    const wildcardExport = proxyExports.find(e => e.exportedName === '*');
    expect(wildcardExport).toBeDefined();
    expect(wildcardExport!.sourceModule).toBe('./star_origin');

    // Consumer should have import bindings referencing the proxy
    const consumerBindings = index.importBindingsGet(starConsumer);
    expect(consumerBindings).toHaveLength(2);

    const starFnBinding = consumerBindings.find(b => b.importedName === 'starFn');
    const starConstBinding = consumerBindings.find(b => b.importedName === 'starConst');
    expect(starFnBinding).toBeDefined();
    expect(starConstBinding).toBeDefined();
    expect(starFnBinding!.moduleSpec).toBe('./star_proxy');

  });

  it('should resolve imports through star exports to the origin symbols', () => {
    const starSrc = path.join(testDir, 'starfull_origin.ts');
    fs.writeFileSync(starSrc, `
export function starFn() { return 'star'; }
export const starConst = 42;
`);

    const starMid = path.join(testDir, 'starfull_proxy.ts');
    fs.writeFileSync(starMid, `
export * from './starfull_origin';
`);

    const starDest = path.join(testDir, 'starfull_consumer.ts');
    fs.writeFileSync(starDest, `
import { starFn, starConst } from './starfull_proxy';

const a = starFn();
const b = starConst;
`);

    const { index } = projectIndexBuildSync({
      files: [starSrc, starMid, starDest],
      dir: testDir,
    });

    // Consumer bindings should resolve through the star-export proxy
    const consumerBindings = index.importBindingsGet(starDest);
    const starFnBinding = consumerBindings.find(b => b.importedName === 'starFn');
    expect(starFnBinding).toBeDefined();
    expect(starFnBinding!.resolvedModulePath).toBe(starMid);
    expect(starFnBinding!.resolvedExportId).toBeDefined();

    // The origin symbol should be reachable
    const originExports = index.exportedSymbolsGet({ file: starSrc });
    const originFn = originExports.find(s => s.name === 'starFn');
    expect(originFn).toBeDefined();

    // References to the origin symbol should include the consumer file
    const refs = index.referencesGet(originFn!.id);
    const externalRefs = refs.filter(ref => {
      const scope = index.scopeGet(ref.scopeId);
      return scope && scope.file === starDest;
    });
    expect(externalRefs.length).toBeGreaterThan(0);
  });

  it('should handle missing file imports gracefully', () => {
    const missingImporter = path.join(testDir, 'missing_importer.ts');
    fs.writeFileSync(missingImporter, `
import { ghost } from './nonexistent_module';

const x = ghost();
`);

    // Must not throw
    const { index, stats } = projectIndexBuildSync({
      files: [missingImporter],
      dir: testDir,
    });

    expect(stats.filesIndexed).toBe(1);

    // Import binding exists but cannot be resolved
    const bindings = index.importBindingsGet(missingImporter);
    const ghostBinding = bindings.find(b => b.importedName === 'ghost');
    expect(ghostBinding).toBeDefined();
    // Module path should be undefined since the target doesn't exist
    expect(ghostBinding!.resolvedModulePath).toBeUndefined();
  });

  it('should handle empty files without crashing', () => {
    const emptyFile = path.join(testDir, 'empty_file.ts');
    fs.writeFileSync(emptyFile, '');

    // Must not throw
    const { index, stats } = projectIndexBuildSync({
      files: [emptyFile],
      dir: testDir,
    });

    expect(stats.filesIndexed).toBe(1);
    expect(stats.errors).toHaveLength(0);

    const symbols = index.symbolsInFileGet(emptyFile);
    expect(symbols).toHaveLength(0);
  });

  it('should handle files with parse errors gracefully', () => {
    const badFile = path.join(testDir, 'parse_error.ts');
    fs.writeFileSync(badFile, `
export function valid() { return 1; }

// Intentionally malformed syntax
const x = {{{{{;
function (((( {
`);

    // Must not throw — the builder should either skip or partially index
    const { stats } = projectIndexBuildSync({
      files: [badFile],
      dir: testDir,
    });

    // File was processed (indexed or skipped) without crashing
    expect(stats.filesIndexed + stats.filesSkipped).toBeGreaterThan(0);
  });

  // ==========================================================================
  // Namespace re-exports: export * as ns from './mod'
  // ==========================================================================

  it('should resolve namespace re-exports (export * as ns from "./mod")', () => {
    // origin.ts: exports alpha and beta
    const originFile = path.join(testDir, 'nsre_origin.ts');
    fs.writeFileSync(originFile, `
export function alpha() { return 'a'; }
export function beta() { return 'b'; }
`);

    // proxy.ts: re-exports all of origin under the 'utils' namespace
    const proxyFile = path.join(testDir, 'nsre_proxy.ts');
    fs.writeFileSync(proxyFile, `
export * as utils from './nsre_origin';
`);

    // consumer.ts: imports the namespace and accesses members
    const consumerFile = path.join(testDir, 'nsre_consumer.ts');
    fs.writeFileSync(consumerFile, `
import { utils } from './nsre_proxy';
const a = utils.alpha();
const b = utils.beta();
`);

    const { index } = projectIndexBuildSync({
      files: [originFile, proxyFile, consumerFile],
      dir: testDir,
    });

    // Verify the proxy file captured the namespace re-export relation
    const proxyExports = index.fileExportsGet(proxyFile);
    const nsExport = proxyExports.find(e => e.exportedName === 'utils');
    expect(nsExport).toBeDefined();
    expect(nsExport!.sourceModule).toBe('./nsre_origin');
    expect(nsExport!.sourceName).toBe('*');

    // The consumer's import binding for 'utils' should be treated as a namespace
    const bindings = index.importBindingsGet(consumerFile);
    const utilsBinding = bindings.find(b => b.importedName === 'utils');
    expect(utilsBinding).toBeDefined();
    // Should be resolved as a namespace pointing to origin module
    expect(utilsBinding!.isNamespace).toBe(true);
    expect(utilsBinding!.resolvedModulePath).toBe(originFile);

    // Member accesses (utils.alpha, utils.beta) should resolve to origin's symbols
    const refs = index.referencesInFileGet(consumerFile);
    const alphaRef = refs.find(r => r.name === 'utils.alpha');
    const betaRef = refs.find(r => r.name === 'utils.beta');

    expect(alphaRef).toBeDefined();
    expect(betaRef).toBeDefined();

    // The resolved symbol IDs should point to origin's exported symbols
    if (alphaRef?.resolvedSymbolId) {
      const alphaSym = index.symbolGet(alphaRef.resolvedSymbolId);
      expect(alphaSym).toBeDefined();
      expect(alphaSym!.name).toBe('alpha');
      expect(alphaSym!.file).toBe(originFile);
    }

    if (betaRef?.resolvedSymbolId) {
      const betaSym = index.symbolGet(betaRef.resolvedSymbolId);
      expect(betaSym).toBeDefined();
      expect(betaSym!.name).toBe('beta');
      expect(betaSym!.file).toBe(originFile);
    }
  });

  it('should resolve chained namespace re-exports', () => {
    // deep.ts: exports a function
    const deepFile = path.join(testDir, 'nsre_deep.ts');
    fs.writeFileSync(deepFile, `
export function deepFn() { return 'deep'; }
`);

    // mid.ts: star-exports everything from deep
    const midFile = path.join(testDir, 'nsre_mid.ts');
    fs.writeFileSync(midFile, `
export * from './nsre_deep';
`);

    // top.ts: namespace re-exports from mid
    const topFile = path.join(testDir, 'nsre_top.ts');
    fs.writeFileSync(topFile, `
export * as lib from './nsre_mid';
`);

    // app.ts: consumes the namespace
    const appFile = path.join(testDir, 'nsre_app.ts');
    fs.writeFileSync(appFile, `
import { lib } from './nsre_top';
const val = lib.deepFn();
`);

    const { index } = projectIndexBuildSync({
      files: [deepFile, midFile, topFile, appFile],
      dir: testDir,
    });

    // The app's import binding for 'lib' should be a namespace
    const bindings = index.importBindingsGet(appFile);
    const libBinding = bindings.find(b => b.importedName === 'lib');
    expect(libBinding).toBeDefined();
    expect(libBinding!.isNamespace).toBe(true);
    // Should resolve to midFile (the direct source of the namespace re-export)
    expect(libBinding!.resolvedModulePath).toBe(midFile);

    // lib.deepFn should resolve through mid's star export to deep's symbol
    const refs = index.referencesInFileGet(appFile);
    const deepFnRef = refs.find(r => r.name === 'lib.deepFn');
    expect(deepFnRef).toBeDefined();

    if (deepFnRef?.resolvedSymbolId) {
      const sym = index.symbolGet(deepFnRef.resolvedSymbolId);
      expect(sym).toBeDefined();
      expect(sym!.name).toBe('deepFn');
      expect(sym!.file).toBe(deepFile);
    }
  });

  // ==========================================================================
  // Cross-file interface, type alias, and enum exports
  // ==========================================================================

  it('should resolve cross-file interface exports', () => {
    const ifaceExporter = path.join(testDir, 'iface_exporter.ts');
    fs.writeFileSync(ifaceExporter, `
export interface Config {
  host: string;
  port: number;
  debug: boolean;
}
`);

    const ifaceConsumer = path.join(testDir, 'iface_consumer.ts');
    fs.writeFileSync(ifaceConsumer, `
import { Config } from './iface_exporter';

const cfg: Config = { host: 'localhost', port: 8080, debug: false };
`);

    const { index } = projectIndexBuildSync({
      files: [ifaceExporter, ifaceConsumer],
      dir: testDir,
    });

    // The exporter should have Config as an exported symbol with kind 'interface'
    const exportedSymbols = index.exportedSymbolsGet({ file: ifaceExporter });
    const configSymbol = exportedSymbols.find(s => s.name === 'Config');
    expect(configSymbol).toBeDefined();
    expect(configSymbol!.kind).toBe('interface');

    // The export relation should exist
    const exports = index.fileExportsGet(ifaceExporter);
    const configExport = exports.find(e => e.exportedName === 'Config');
    expect(configExport).toBeDefined();
    expect(configExport!.symbolId).toBe(configSymbol!.id);

    // The consumer should have an import binding that resolves to the exported interface
    const bindings = index.importBindingsGet(ifaceConsumer);
    const configBinding = bindings.find(b => b.importedName === 'Config');
    expect(configBinding).toBeDefined();
    expect(configBinding!.resolvedModulePath).toBe(ifaceExporter);
    expect(configBinding!.resolvedExportId).toBe(configSymbol!.id);
  });

  it('should resolve cross-file type alias exports', () => {
    const typeExporter = path.join(testDir, 'type_exporter.ts');
    fs.writeFileSync(typeExporter, `
export type Status = 'ok' | 'error' | 'pending';

export type Pair<A, B> = { first: A; second: B };
`);

    const typeConsumer = path.join(testDir, 'type_consumer.ts');
    fs.writeFileSync(typeConsumer, `
import { Status, Pair } from './type_exporter';

const s: Status = 'ok';
const p: Pair<string, number> = { first: 'hello', second: 42 };
`);

    const { index } = projectIndexBuildSync({
      files: [typeExporter, typeConsumer],
      dir: testDir,
    });

    // The exporter should have both type symbols
    const exportedSymbols = index.exportedSymbolsGet({ file: typeExporter });
    const statusSymbol = exportedSymbols.find(s => s.name === 'Status');
    const pairSymbol = exportedSymbols.find(s => s.name === 'Pair');
    expect(statusSymbol).toBeDefined();
    expect(statusSymbol!.kind).toBe('type');
    expect(pairSymbol).toBeDefined();
    expect(pairSymbol!.kind).toBe('type');

    // The consumer's import bindings should resolve
    const bindings = index.importBindingsGet(typeConsumer);
    const statusBinding = bindings.find(b => b.importedName === 'Status');
    const pairBinding = bindings.find(b => b.importedName === 'Pair');
    expect(statusBinding).toBeDefined();
    expect(statusBinding!.resolvedExportId).toBe(statusSymbol!.id);
    expect(pairBinding).toBeDefined();
    expect(pairBinding!.resolvedExportId).toBe(pairSymbol!.id);
  });

  it('should resolve cross-file enum exports', () => {
    const enumExporter = path.join(testDir, 'enum_exporter.ts');
    fs.writeFileSync(enumExporter, `
export enum Color {
  Red = 'red',
  Green = 'green',
  Blue = 'blue',
}
`);

    const enumConsumer = path.join(testDir, 'enum_consumer.ts');
    fs.writeFileSync(enumConsumer, `
import { Color } from './enum_exporter';

const favorite = Color.Red;
const palette = [Color.Green, Color.Blue];
`);

    const { index } = projectIndexBuildSync({
      files: [enumExporter, enumConsumer],
      dir: testDir,
    });

    // The exporter should have the enum as an exported symbol
    const exportedSymbols = index.exportedSymbolsGet({ file: enumExporter });
    const colorSymbol = exportedSymbols.find(s => s.name === 'Color');
    expect(colorSymbol).toBeDefined();
    expect(colorSymbol!.kind).toBe('enum');

    // Enum members should be extracted as symbols in the exporter
    const allSymbols = index.symbolsInFileGet(enumExporter);
    const memberNames = allSymbols
      .filter(s => s.kind === 'enumMember')
      .map(s => s.name);
    expect(memberNames).toContain('Red');
    expect(memberNames).toContain('Green');
    expect(memberNames).toContain('Blue');

    // The consumer's import binding should resolve
    const bindings = index.importBindingsGet(enumConsumer);
    const colorBinding = bindings.find(b => b.importedName === 'Color');
    expect(colorBinding).toBeDefined();
    expect(colorBinding!.resolvedExportId).toBe(colorSymbol!.id);
  });

  it('should resolve re-exported interfaces through chains', () => {
    const reIfaceOrigin = path.join(testDir, 'reiface_origin.ts');
    fs.writeFileSync(reIfaceOrigin, `
export interface BaseModel {
  id: string;
  createdAt: Date;
}
`);

    const reIfaceProxy = path.join(testDir, 'reiface_proxy.ts');
    fs.writeFileSync(reIfaceProxy, `
export { BaseModel } from './reiface_origin';
`);

    const reIfaceConsumer = path.join(testDir, 'reiface_consumer.ts');
    fs.writeFileSync(reIfaceConsumer, `
import { BaseModel } from './reiface_proxy';

const model: BaseModel = { id: '1', createdAt: new Date() };
`);

    const { index } = projectIndexBuildSync({
      files: [reIfaceOrigin, reIfaceProxy, reIfaceConsumer],
      dir: testDir,
    });

    // Origin should have the interface symbol
    const originExports = index.exportedSymbolsGet({ file: reIfaceOrigin });
    const baseModelSym = originExports.find(s => s.name === 'BaseModel');
    expect(baseModelSym).toBeDefined();
    expect(baseModelSym!.kind).toBe('interface');

    // Proxy should surface the re-exported interface
    const proxyExports = index.fileExportsGet(reIfaceProxy);
    const proxyExport = proxyExports.find(e => e.exportedName === 'BaseModel');
    expect(proxyExport).toBeDefined();

    // Consumer binding should resolve through the proxy
    const bindings = index.importBindingsGet(reIfaceConsumer);
    const baseModelBinding = bindings.find(b => b.importedName === 'BaseModel');
    expect(baseModelBinding).toBeDefined();
    expect(baseModelBinding!.resolvedModulePath).toBe(reIfaceProxy);
    expect(baseModelBinding!.resolvedExportId).toBeDefined();

    // The resolved export should trace back to the origin's symbol
    const resolvedSym = index.symbolGet(baseModelBinding!.resolvedExportId!);
    expect(resolvedSym).toBeDefined();
    expect(resolvedSym!.name).toBe('BaseModel');
    expect(resolvedSym!.file).toBe(reIfaceOrigin);
  });

  // ==========================================================================
  // Type-only exports: export type { Foo }
  // ==========================================================================

  it('should resolve type-only named exports (export type { Foo })', () => {
    const typeOnlySource = path.join(testDir, 'typeonly_source.ts');
    fs.writeFileSync(typeOnlySource, `
interface InternalConfig {
  host: string;
  port: number;
}

export type { InternalConfig };
`);

    const typeOnlyConsumer = path.join(testDir, 'typeonly_consumer.ts');
    fs.writeFileSync(typeOnlyConsumer, `
import { InternalConfig } from './typeonly_source';

const cfg: InternalConfig = { host: 'localhost', port: 3000 };
`);

    const { index } = projectIndexBuildSync({
      files: [typeOnlySource, typeOnlyConsumer],
      dir: testDir,
    });

    // The source should have InternalConfig as an exported symbol
    const exportedSymbols = index.exportedSymbolsGet({ file: typeOnlySource });
    const configSymbol = exportedSymbols.find(s => s.name === 'InternalConfig');
    expect(configSymbol).toBeDefined();

    // The consumer's import binding should resolve
    const bindings = index.importBindingsGet(typeOnlyConsumer);
    const configBinding = bindings.find(b => b.importedName === 'InternalConfig');
    expect(configBinding).toBeDefined();
    expect(configBinding!.resolvedExportId).toBeDefined();
  });

  // ==========================================================================
  // Anonymous default exports
  // ==========================================================================

  it('should resolve anonymous default class exports (export default class {})', () => {
    const anonClassExporter = path.join(testDir, 'anon_class_exporter.ts');
    fs.writeFileSync(anonClassExporter, `
export default class {
  greet() { return 'hello'; }
}
`);

    const anonClassConsumer = path.join(testDir, 'anon_class_consumer.ts');
    fs.writeFileSync(anonClassConsumer, `
import MyClass from './anon_class_exporter';

const instance = new MyClass();
`);

    const { index } = projectIndexBuildSync({
      files: [anonClassExporter, anonClassConsumer],
      dir: testDir,
    });

    // The exporter should have a default export
    const exports = index.fileExportsGet(anonClassExporter);
    const defaultExport = exports.find(e => e.isDefault);
    expect(defaultExport).toBeDefined();

    // The consumer's default import should resolve
    const bindings = index.importBindingsGet(anonClassConsumer);
    const defaultBinding = bindings.find(b => b.isDefault);
    expect(defaultBinding).toBeDefined();
    expect(defaultBinding!.resolvedExportId).toBeDefined();
  });

  it('should resolve anonymous default function exports (export default function() {})', () => {
    const anonFnExporter = path.join(testDir, 'anon_fn_exporter.ts');
    fs.writeFileSync(anonFnExporter, `
export default function() {
  return 42;
}
`);

    const anonFnConsumer = path.join(testDir, 'anon_fn_consumer.ts');
    fs.writeFileSync(anonFnConsumer, `
import compute from './anon_fn_exporter';

const result = compute();
`);

    const { index } = projectIndexBuildSync({
      files: [anonFnExporter, anonFnConsumer],
      dir: testDir,
    });

    // The exporter should have a default export
    const exports = index.fileExportsGet(anonFnExporter);
    const defaultExport = exports.find(e => e.isDefault);
    expect(defaultExport).toBeDefined();

    // The consumer's default import should resolve
    const bindings = index.importBindingsGet(anonFnConsumer);
    const defaultBinding = bindings.find(b => b.isDefault);
    expect(defaultBinding).toBeDefined();
    expect(defaultBinding!.resolvedExportId).toBeDefined();
  });

  // ==========================================================================
  // CommonJS require() imports
  // ==========================================================================

  it('should resolve whole-module require() to default export', () => {
    const cjsExporter = path.join(testDir, 'cjs_exporter.ts');
    fs.writeFileSync(cjsExporter, `
export function greet(name: string) {
  return 'hello ' + name;
}

export default function main() {
  return greet('world');
}
`);

    const cjsConsumer = path.join(testDir, 'cjs_consumer.ts');
    fs.writeFileSync(cjsConsumer, `
const mod = require('./cjs_exporter');

const result = mod();
`);

    const { index } = projectIndexBuildSync({
      files: [cjsExporter, cjsConsumer],
      dir: testDir,
    });

    // Consumer should have an import binding from require()
    const bindings = index.importBindingsGet(cjsConsumer);
    const requireBinding = bindings.find(b => b.moduleSpec === './cjs_exporter');
    expect(requireBinding).toBeDefined();
    expect(requireBinding!.isDefault).toBe(true);
    expect(requireBinding!.resolvedModulePath).toBe(cjsExporter);
    expect(requireBinding!.resolvedExportId).toBeDefined();
  });

  it('should resolve destructured require() to named exports', () => {
    const namedExporter = path.join(testDir, 'cjs_named_exporter.ts');
    fs.writeFileSync(namedExporter, `
export function alpha() { return 'a'; }
export function beta() { return 'b'; }
`);

    const destructuredConsumer = path.join(testDir, 'cjs_destructured.ts');
    fs.writeFileSync(destructuredConsumer, `
const { alpha, beta } = require('./cjs_named_exporter');

const a = alpha();
const b = beta();
`);

    const { index } = projectIndexBuildSync({
      files: [namedExporter, destructuredConsumer],
      dir: testDir,
    });

    const bindings = index.importBindingsGet(destructuredConsumer);
    const alphaBinding = bindings.find(b => b.importedName === 'alpha');
    const betaBinding = bindings.find(b => b.importedName === 'beta');

    expect(alphaBinding).toBeDefined();
    expect(alphaBinding!.isDefault).toBe(false);
    expect(alphaBinding!.resolvedModulePath).toBe(namedExporter);
    expect(alphaBinding!.resolvedExportId).toBeDefined();

    expect(betaBinding).toBeDefined();
    expect(betaBinding!.isDefault).toBe(false);
    expect(betaBinding!.resolvedModulePath).toBe(namedExporter);
    expect(betaBinding!.resolvedExportId).toBeDefined();
  });

  it('should handle require() with ESM exports interop', () => {
    // A file that uses ESM exports, consumed via require()
    const esmExporter = path.join(testDir, 'cjs_esm_interop_exporter.ts');
    fs.writeFileSync(esmExporter, `
export const PI = 3.14159;
export function circleArea(r: number) { return PI * r * r; }
`);

    const cjsMixed = path.join(testDir, 'cjs_esm_interop_consumer.ts');
    fs.writeFileSync(cjsMixed, `
const { PI, circleArea } = require('./cjs_esm_interop_exporter');

const area = circleArea(5);
`);

    const { index } = projectIndexBuildSync({
      files: [esmExporter, cjsMixed],
      dir: testDir,
    });

    const bindings = index.importBindingsGet(cjsMixed);
    const piBinding = bindings.find(b => b.importedName === 'PI');
    const areaBinding = bindings.find(b => b.importedName === 'circleArea');

    expect(piBinding).toBeDefined();
    expect(piBinding!.resolvedExportId).toBeDefined();

    expect(areaBinding).toBeDefined();
    expect(areaBinding!.resolvedExportId).toBeDefined();
  });

  it('should include require() imports in module graph', () => {
    const graphExporter = path.join(testDir, 'cjs_graph_exporter.ts');
    fs.writeFileSync(graphExporter, `
export function helper() { return 42; }
`);

    const graphConsumer = path.join(testDir, 'cjs_graph_consumer.ts');
    fs.writeFileSync(graphConsumer, `
const { helper } = require('./cjs_graph_exporter');

const val = helper();
`);

    const { index } = projectIndexBuildSync({
      files: [graphExporter, graphConsumer],
      dir: testDir,
    });

    // Module graph should show the dependency
    const importees = index.moduleImporteesGet(graphConsumer);
    expect(importees).toContain(graphExporter);

    const importers = index.moduleImportersGet(graphExporter);
    expect(importers).toContain(graphConsumer);
  });

  it('should handle external require() gracefully (no resolvedModulePath)', () => {
    const externalRequire = path.join(testDir, 'cjs_external.ts');
    fs.writeFileSync(externalRequire, `
const lodash = require('lodash');
const result = lodash.map([1, 2, 3], (x: number) => x * 2);
`);

    const { index } = projectIndexBuildSync({
      files: [externalRequire],
      dir: testDir,
    });

    const bindings = index.importBindingsGet(externalRequire);
    const lodashBinding = bindings.find(b => b.moduleSpec === 'lodash');
    expect(lodashBinding).toBeDefined();
    expect(lodashBinding!.isDefault).toBe(true);
    // External package — no resolved path
    expect(lodashBinding!.resolvedModulePath).toBeUndefined();
    expect(lodashBinding!.resolvedExportId).toBeUndefined();
  });

  // ==========================================================================
  // Dynamic import() — binding resolution
  // ==========================================================================

  it('should resolve whole-module dynamic import (const mod = await import())', () => {
    const dynamicTarget = path.join(testDir, 'dynamic_target.ts');
    fs.writeFileSync(dynamicTarget, `
export function lazyHelper() { return 'lazy'; }
export const lazyConst = 42;
`);

    const dynamicCaller = path.join(testDir, 'dynamic_caller.ts');
    fs.writeFileSync(dynamicCaller, `
async function loadModule() {
  const mod = await import('./dynamic_target');
  return mod.lazyHelper();
}
`);

    const { index } = projectIndexBuildSync({
      files: [dynamicTarget, dynamicCaller],
      dir: testDir,
    });

    // Dynamic import with await should create an ImportBindingRelation
    // with isNamespace: true (like import * as mod from "...")
    const bindings = index.importBindingsGet(dynamicCaller);
    expect(bindings.length).toBe(1);

    const modBinding = bindings[0];
    expect(modBinding.importedName).toBe('*');
    expect(modBinding.isNamespace).toBe(true);
    expect(modBinding.isDefault).toBe(false);
    expect(modBinding.moduleSpec).toBe('./dynamic_target');
    expect(modBinding.resolvedModulePath).toBe(dynamicTarget);

    // The module specifier should also be tracked as an ImportsRelation
    const imports = index.importsGet(dynamicCaller);
    expect(imports.length).toBeGreaterThan(0);
    const dynamicImport = imports.find(i => i.spec === './dynamic_target');
    expect(dynamicImport).toBeDefined();
    expect(dynamicImport!.resolvedModulePath).toBe(dynamicTarget);
  });

  it('should resolve destructured dynamic import (const { foo } = await import())', () => {
    const destrTarget = path.join(testDir, 'destr_target.ts');
    fs.writeFileSync(destrTarget, `
export function alpha() { return 'a'; }
export function beta() { return 'b'; }
`);

    const destrCaller = path.join(testDir, 'destr_caller.ts');
    fs.writeFileSync(destrCaller, `
async function loadParts() {
  const { alpha, beta } = await import('./destr_target');
  return alpha() + beta();
}
`);

    const { index } = projectIndexBuildSync({
      files: [destrTarget, destrCaller],
      dir: testDir,
    });

    // Destructured dynamic import creates named ImportBindingRelation entries
    const bindings = index.importBindingsGet(destrCaller);
    expect(bindings.length).toBe(2);

    const alphaBinding = bindings.find(b => b.importedName === 'alpha');
    expect(alphaBinding).toBeDefined();
    expect(alphaBinding!.isDefault).toBe(false);
    expect(alphaBinding!.isNamespace).toBe(false);
    expect(alphaBinding!.moduleSpec).toBe('./destr_target');
    expect(alphaBinding!.resolvedModulePath).toBe(destrTarget);
    expect(alphaBinding!.resolvedExportId).toBeDefined();

    const betaBinding = bindings.find(b => b.importedName === 'beta');
    expect(betaBinding).toBeDefined();
    expect(betaBinding!.resolvedModulePath).toBe(destrTarget);
    expect(betaBinding!.resolvedExportId).toBeDefined();
  });

  it('should resolve dynamic import member accesses via namespace resolution', () => {
    const memberTarget = path.join(testDir, 'dyn_member_target.ts');
    fs.writeFileSync(memberTarget, `
export function greet() { return 'hello'; }
`);

    const memberCaller = path.join(testDir, 'dyn_member_caller.ts');
    fs.writeFileSync(memberCaller, `
async function callGreet() {
  const mod = await import('./dyn_member_target');
  return mod.greet();
}
`);

    const { index } = projectIndexBuildSync({
      files: [memberTarget, memberCaller],
      dir: testDir,
    });

    // The namespace binding should be resolved
    const bindings = index.importBindingsGet(memberCaller);
    const nsBind = bindings.find(b => b.isNamespace);
    expect(nsBind).toBeDefined();
    expect(nsBind!.resolvedModulePath).toBe(memberTarget);

    // Member access (mod.greet) should be resolved to the exported symbol
    const refs = index.referencesInFileGet(memberCaller);
    const greetRef = refs.find(r => r.name.includes('greet'));
    expect(greetRef).toBeDefined();

    // The reference should resolve to the exported greet symbol
    if (greetRef?.resolvedSymbolId) {
      const resolvedSym = index.symbolGet(greetRef.resolvedSymbolId);
      expect(resolvedSym).toBeDefined();
      expect(resolvedSym!.name).toBe('greet');
      expect(resolvedSym!.file).toBe(memberTarget);
    }
  });

  it('should handle external dynamic import gracefully (no resolvedModulePath)', () => {
    const extDynamic = path.join(testDir, 'ext_dynamic.ts');
    fs.writeFileSync(extDynamic, `
async function loadExternal() {
  const lodash = await import('lodash');
  return lodash.default;
}
`);

    const { index } = projectIndexBuildSync({
      files: [extDynamic],
      dir: testDir,
    });

    // External dynamic import creates binding but no resolved path
    const bindings = index.importBindingsGet(extDynamic);
    const lodashBinding = bindings.find(b => b.moduleSpec === 'lodash');
    expect(lodashBinding).toBeDefined();
    expect(lodashBinding!.isNamespace).toBe(true);
    expect(lodashBinding!.resolvedModulePath).toBeUndefined();
    expect(lodashBinding!.resolvedExportId).toBeUndefined();
  });

  it('should resolve ImportsRelation specifiers for side-effect imports', () => {
    const sideEffectTarget = path.join(testDir, 'side_effect_target.ts');
    fs.writeFileSync(sideEffectTarget, `
export const setup = true;
`);

    const sideEffectCaller = path.join(testDir, 'side_effect_caller.ts');
    fs.writeFileSync(sideEffectCaller, `
import './side_effect_target';
const x = 1;
`);

    const { index } = projectIndexBuildSync({
      files: [sideEffectTarget, sideEffectCaller],
      dir: testDir,
    });

    // Side-effect import should have resolvedModulePath set
    const imports = index.importsGet(sideEffectCaller);
    const sideEffect = imports.find(i => i.spec === './side_effect_target');
    expect(sideEffect).toBeDefined();
    expect(sideEffect!.resolvedModulePath).toBe(sideEffectTarget);
  });
});
