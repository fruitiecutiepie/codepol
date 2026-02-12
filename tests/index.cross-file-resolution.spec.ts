import { describe, expect, it, beforeAll } from 'vitest';
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
    // Register languages BEFORE initializing
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    
    // Initialize the parser
    await parserInit();
    
    // Create a temp directory for test files
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-test-'));
  });

  it('should resolve named import references to exported symbols', () => {
    // Create file A: exports foo
    const fileA = path.join(testDir, 'moduleA.ts');
    const fileAContent = `
export function foo() {
  return 'hello';
}

export const bar = 42;
`;
    fs.writeFileSync(fileA, fileAContent);

    // Create file B: imports and uses foo from A
    const fileB = path.join(testDir, 'moduleB.ts');
    const fileBContent = `
import { foo, bar } from './moduleA';

const result = foo();
console.log(bar);
`;
    fs.writeFileSync(fileB, fileBContent);

    // Build the index
    const { index, stats } = projectIndexBuildSync({
      files: [fileA, fileB],
      dir: testDir,
    });

    console.log('\n=== Index Stats ===');
    console.log('Files indexed:', stats.filesIndexed);
    console.log('Files skipped:', stats.filesSkipped);
    console.log('Errors:', stats.errors);
    console.log('Index stats:', index.getStats());

    // Debug: List all symbols
    console.log('\n=== All Symbols ===');
    const allSymbols = index.getSymbols();
    for (const sym of allSymbols) {
      const isExported = (sym.flags & SymbolFlags.Exported) !== 0;
      console.log(`  ${sym.name} (${sym.kind}) in ${path.basename(sym.file)} - exported: ${isExported}`);
    }

    // Get the exported 'foo' function from file A
    const exportedSymbols = index.getExportedSymbols({ file: fileA });
    console.log('\n=== Exported Symbols from moduleA ===');
    for (const sym of exportedSymbols) {
      console.log(`  ${sym.name} (${sym.kind}) - id: ${sym.id.slice(0, 12)}...`);
    }

    const fooSymbol = exportedSymbols.find(s => s.name === 'foo');
    expect(fooSymbol).toBeDefined();
    console.log('\n=== foo symbol ===');
    console.log('  id:', fooSymbol?.id);
    console.log('  kind:', fooSymbol?.kind);
    console.log('  file:', fooSymbol?.file);

    // Debug: Check import bindings in file B
    console.log('\n=== Import Bindings in moduleB ===');
    const importBindings = index.getImportBindings(fileB);
    for (const binding of importBindings) {
      console.log(`  localSymbolId: ${binding.localSymbolId.slice(0, 12)}...`);
      console.log(`  importedName: ${binding.importedName}`);
      console.log(`  moduleSpec: ${binding.moduleSpec}`);
      console.log(`  isDefault: ${binding.isDefault}`);
      console.log(`  resolvedModulePath: ${binding.resolvedModulePath ?? 'undefined'}`);
      console.log(`  resolvedExportId: ${binding.resolvedExportId ?? 'undefined'}`);
      console.log('  ---');
    }

    // Debug: Check all references in file B
    console.log('\n=== References in moduleB ===');
    const refsInB = index.getReferencesInFile(fileB);
    for (const ref of refsInB) {
      console.log(`  name: ${ref.name}`);
      console.log(`  resolvedSymbolId: ${ref.resolvedSymbolId?.slice(0, 12) ?? 'undefined'}...`);
      console.log(`  range: ${ref.range.start}-${ref.range.end}`);
      console.log('  ---');
    }

    // Get references to the exported foo symbol
    console.log('\n=== References to foo (exported symbol) ===');
    const fooRefs = index.getReferences(fooSymbol!.id);
    console.log('Number of references:', fooRefs.length);
    for (const ref of fooRefs) {
      const scope = index.getScope(ref.scopeId);
      console.log(`  ref in ${scope?.file ? path.basename(scope.file) : 'unknown'}: ${ref.name}`);
    }

    // Check if we have external references (from file B)
    const externalRefs = fooRefs.filter(ref => {
      const scope = index.getScope(ref.scopeId);
      return scope && scope.file !== fileA;
    });

    console.log('\n=== External References ===');
    console.log('Number of external references:', externalRefs.length);
    for (const ref of externalRefs) {
      const scope = index.getScope(ref.scopeId);
      console.log(`  from ${scope?.file ? path.basename(scope.file) : 'unknown'}`);
    }

    // The test: we expect at least one reference from file B
    expect(externalRefs.length).toBeGreaterThan(0);
  });

  it('should resolve default import references', () => {
    // Create file C: default export
    const fileC = path.join(testDir, 'moduleC.ts');
    const fileCContent = `
function myDefault() {
  return 'default';
}

export default myDefault;
`;
    fs.writeFileSync(fileC, fileCContent);

    // Create file D: default import
    const fileD = path.join(testDir, 'moduleD.ts');
    const fileDContent = `
import myFunc from './moduleC';

const result = myFunc();
`;
    fs.writeFileSync(fileD, fileDContent);

    // Build the index
    const { index, stats } = projectIndexBuildSync({
      files: [fileC, fileD],
      dir: testDir,
    });

    console.log('\n=== Default Import Test ===');
    console.log('Files indexed:', stats.filesIndexed);

    // Debug: List all symbols in both files
    console.log('\n=== Symbols in moduleC ===');
    const symbolsC = index.getSymbolsInFile(fileC);
    for (const sym of symbolsC) {
      const isExported = (sym.flags & SymbolFlags.Exported) !== 0;
      console.log(`  ${sym.name} (${sym.kind}) - exported: ${isExported}`);
    }

    console.log('\n=== Symbols in moduleD ===');
    const symbolsD = index.getSymbolsInFile(fileD);
    for (const sym of symbolsD) {
      console.log(`  ${sym.name} (${sym.kind})`);
    }

    // Check import bindings
    console.log('\n=== Import Bindings in moduleD ===');
    const importBindings = index.getImportBindings(fileD);
    for (const binding of importBindings) {
      console.log(`  localSymbolId: ${binding.localSymbolId.slice(0, 12)}...`);
      console.log(`  importedName: ${binding.importedName}`);
      console.log(`  moduleSpec: ${binding.moduleSpec}`);
      console.log(`  isDefault: ${binding.isDefault}`);
      console.log(`  resolvedExportId: ${binding.resolvedExportId ?? 'undefined'}`);
    }

    // Check exports from moduleC
    console.log('\n=== Exports from moduleC ===');
    const exportsC = index.getFileExports(fileC);
    for (const exp of exportsC) {
      console.log(`  exportedName: ${exp.exportedName}`);
      console.log(`  symbolId: ${exp.symbolId?.slice(0, 12) ?? 'undefined'}...`);
      console.log(`  isDefault: ${exp.isDefault}`);
    }

    // Check if default import binding exists
    const defaultBinding = importBindings.find(b => b.isDefault);
    console.log('\n=== Default Import Binding Found ===');
    console.log(defaultBinding ? 'YES' : 'NO - This is the bug!');
    
    expect(defaultBinding).toBeDefined();
    expect(defaultBinding!.resolvedExportId).toBeDefined();
  });

  it('should find external references via getReferences API', () => {
    // Create file with exports
    const fileExporter = path.join(testDir, 'exporter.ts');
    const exporterContent = `
export function usedFunction() {
  return 'used';
}

export function unusedFunction() {
  return 'unused';
}
`;
    fs.writeFileSync(fileExporter, exporterContent);

    // Create file that imports one function
    const fileUser = path.join(testDir, 'user.ts');
    const userContent = `
import { usedFunction } from './exporter';

const result = usedFunction();
`;
    fs.writeFileSync(fileUser, userContent);

    // Build the index
    const { index, stats } = projectIndexBuildSync({
      files: [fileExporter, fileUser],
      dir: testDir,
    });

    console.log('\n=== External References Test ===');
    console.log('Files indexed:', stats.filesIndexed);

    // Get all exported symbols from the exporter
    const exportedSymbols = index.getExportedSymbols({ file: fileExporter });
    console.log('\n=== Exported Symbols ===');
    for (const sym of exportedSymbols) {
      console.log(`  ${sym.name} (${sym.kind})`);
    }

    // For each exported symbol, check if it's referenced in other files
    const unusedExports: string[] = [];
    const usedExports: string[] = [];

    for (const symbol of exportedSymbols) {
      const references = index.getReferences(symbol.id);
      
      // Filter to only references in OTHER files
      const externalReferences = references.filter(ref => {
        const scope = index.getScope(ref.scopeId);
        return scope && scope.file !== fileExporter;
      });

      console.log(`\n  ${symbol.name}: ${externalReferences.length} external references`);
      
      if (externalReferences.length === 0) {
        unusedExports.push(symbol.name);
      } else {
        usedExports.push(symbol.name);
      }
    }

    console.log('\n=== Results ===');
    console.log('Used exports:', usedExports);
    console.log('Unused exports:', unusedExports);

    // Verify the results
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

    console.log('\n=== Index Capabilities ===');
    console.log('crossFileResolution:', index.capabilities.crossFileResolution);
    console.log('callGraph:', index.capabilities.callGraph);
    console.log('supportedLanguages:', index.capabilities.supportedLanguages);

    expect(index.capabilities.crossFileResolution).toBe(true);
  });
});
