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

    const exportedSymbols = index.getExportedSymbols({ file: fileA });
    const fooSymbol = exportedSymbols.find(s => s.name === 'foo');
    expect(fooSymbol).toBeDefined();

    const importBindings = index.getImportBindings(fileB);
    const fooBinding = importBindings.find(b => b.importedName === 'foo');
    expect(fooBinding).toBeDefined();
    expect(fooBinding!.resolvedExportId).toBeDefined();

    const fooRefs = index.getReferences(fooSymbol!.id);
    const externalRefs = fooRefs.filter(ref => {
      const scope = index.getScope(ref.scopeId);
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

    const importBindings = index.getImportBindings(fileD);
    const defaultBinding = importBindings.find(b => b.isDefault);
    expect(defaultBinding).toBeDefined();
    expect(defaultBinding!.resolvedExportId).toBeDefined();
  });

  it('should find external references via getReferences API', () => {
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

    const exportedSymbols = index.getExportedSymbols({ file: fileExporter });
    const unusedExports: string[] = [];
    const usedExports: string[] = [];

    for (const symbol of exportedSymbols) {
      const references = index.getReferences(symbol.id);
      const externalReferences = references.filter(ref => {
        const scope = index.getScope(ref.scopeId);
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
    const bindings = index.getImportBindings(nsImporter);
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

    const bindings = index.getImportBindings(nsImporter);
    const nsBinding = bindings.find(b => b.isNamespace);
    expect(nsBinding).toBeDefined();
    expect(nsBinding!.resolvedModulePath).toBe(nsExporter);

    // Member accesses (utils.alpha, utils.beta) should resolve to exporter symbols
    const exportedSymbols = index.getExportedSymbols({ file: nsExporter });
    const alphaSym = exportedSymbols.find(s => s.name === 'alpha');
    expect(alphaSym).toBeDefined();

    const alphaRefs = index.getReferences(alphaSym!.id);
    const externalRefs = alphaRefs.filter(ref => {
      const scope = index.getScope(ref.scopeId);
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

    const bindings = index.getImportBindings(aliasImporter);
    expect(bindings.length).toBeGreaterThan(0);

    // importedName must be the original exported name, not the local alias
    const aliasBinding = bindings.find(b => b.importedName === 'originalName');
    expect(aliasBinding).toBeDefined();
    expect(aliasBinding!.resolvedModulePath).toBe(aliasExporter);
    expect(aliasBinding!.resolvedExportId).toBeDefined();

    // The local symbol should be named 'renamedFn' (the alias)
    const localSymbol = index.getSymbol(aliasBinding!.localSymbolId);
    expect(localSymbol).toBeDefined();
    expect(localSymbol!.name).toBe('renamedFn');

    // The resolved export should be the 'originalName' symbol from the exporter
    const exportedSymbols = index.getExportedSymbols({ file: aliasExporter });
    const originalSymbol = exportedSymbols.find(s => s.name === 'originalName');
    expect(originalSymbol).toBeDefined();
    expect(aliasBinding!.resolvedExportId).toBe(originalSymbol!.id);

    // References to 'renamedFn' in the importer should resolve to the exported symbol
    const refs = index.getReferencesInFile(aliasImporter);
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
    const exports = index.getFileExports(aliasExportSource);
    const aliasedExport = exports.find(e => e.exportedName === 'publicApi');
    expect(aliasedExport).toBeDefined();
    expect(aliasedExport!.symbolId).toBeDefined();

    // There should NOT be an export under the internal name
    const internalExport = exports.find(e => e.exportedName === 'internalFn');
    expect(internalExport).toBeUndefined();

    // The consumer should resolve the import to the correct symbol
    const bindings = index.getImportBindings(aliasExportConsumer);
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
    const originExports = index.getExportedSymbols({ file: reexportOrigin });
    expect(originExports.find(s => s.name === 'innerFn')).toBeDefined();

    // The consumer should have an import binding for 'innerFn'
    const consumerBindings = index.getImportBindings(reexportConsumer);
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

    // Proxy should surface re-exported symbols in getFileExports
    const proxyExports = index.getFileExports(reProxy);
    const innerExport = proxyExports.find(e => e.exportedName === 'innerFn');
    expect(innerExport).toBeDefined();

    // Consumer binding should resolve through the proxy to the origin
    const consumerBindings = index.getImportBindings(reConsumer);
    const innerBinding = consumerBindings.find(b => b.importedName === 'innerFn');
    expect(innerBinding).toBeDefined();
    expect(innerBinding!.resolvedModulePath).toBe(reProxy);
    expect(innerBinding!.resolvedExportId).toBeDefined();

    // The resolvedExportId should ultimately trace back to the origin symbol
    const originExports = index.getExportedSymbols({ file: reOrigin });
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
    const exportsA = index.getExportedSymbols({ file: circA });
    const exportsB = index.getExportedSymbols({ file: circB });
    expect(exportsA.find(s => s.name === 'fromA')).toBeDefined();
    expect(exportsB.find(s => s.name === 'fromB')).toBeDefined();

    // Import bindings should resolve in both directions
    const bindingsA = index.getImportBindings(circA);
    const bindingsB = index.getImportBindings(circB);
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
    const dExports = index.getExportedSymbols({ file: diamondD });
    const sharedSym = dExports.find(s => s.name === 'shared');
    expect(sharedSym).toBeDefined();

    const sharedRefs = index.getReferences(sharedSym!.id);
    const refFiles = new Set(
      sharedRefs.map(ref => {
        const scope = index.getScope(ref.scopeId);
        return scope?.file;
      }).filter(Boolean)
    );
    // 'shared' is referenced from at least B and C (and possibly D itself)
    expect(refFiles.has(diamondB)).toBe(true);
    expect(refFiles.has(diamondC)).toBe(true);

    // A's imports from B and C should resolve
    const aBindings = index.getImportBindings(diamondA);
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
    const proxyExports = index.getFileExports(starProxy);
    const wildcardExport = proxyExports.find(e => e.exportedName === '*');
    expect(wildcardExport).toBeDefined();
    expect(wildcardExport!.sourceModule).toBe('./star_origin');

    // Consumer should have import bindings referencing the proxy
    const consumerBindings = index.getImportBindings(starConsumer);
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
    const consumerBindings = index.getImportBindings(starDest);
    const starFnBinding = consumerBindings.find(b => b.importedName === 'starFn');
    expect(starFnBinding).toBeDefined();
    expect(starFnBinding!.resolvedModulePath).toBe(starMid);
    expect(starFnBinding!.resolvedExportId).toBeDefined();

    // The origin symbol should be reachable
    const originExports = index.getExportedSymbols({ file: starSrc });
    const originFn = originExports.find(s => s.name === 'starFn');
    expect(originFn).toBeDefined();

    // References to the origin symbol should include the consumer file
    const refs = index.getReferences(originFn!.id);
    const externalRefs = refs.filter(ref => {
      const scope = index.getScope(ref.scopeId);
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
    const bindings = index.getImportBindings(missingImporter);
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

    const symbols = index.getSymbolsInFile(emptyFile);
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
});
