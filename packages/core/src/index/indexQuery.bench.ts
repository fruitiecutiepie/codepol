/**
 * Performance benchmarks for ProjectIndex query latency.
 *
 * Builds a 100-file index once in beforeAll, then measures individual
 * query methods to detect regressions in lookup speed.
 *
 * Run: pnpm bench
 */

import { bench, describe, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  SymbolFlags,
  type ProjectIndex,
  type SymbolId,
} from '@codepol/core';
import {
  benchProjectGenerate,
  benchProjectCleanup,
  type GeneratedProject,
} from '../../../../tests/benchHelpers';

describe('query latency', () => {
  let project: GeneratedProject;
  let index: ProjectIndex;

  // Cache a few values from the built index to use in targeted queries
  let sampleFile: string;
  let sampleSymbolId: SymbolId;
  let sampleSymbolName: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();

    project = benchProjectGenerate(100);

    const result = projectIndexBuildSync({
      files: project.files,
      dir: project.dir,
    });
    index = result.index;

    // Pick a file near the middle (has both imports and exports)
    sampleFile = project.files[50];

    // Pick a symbol from that file
    const syms = index.getSymbolsInFile(sampleFile);
    const exported = syms.find(s => (s.flags & SymbolFlags.Exported) !== 0);
    sampleSymbolId = exported?.id ?? syms[0].id;
    sampleSymbolName = exported?.name ?? syms[0].name;
  });

  afterAll(() => {
    benchProjectCleanup(project);
  });

  // --------------------------------------------------------------------------
  // Symbol queries
  // --------------------------------------------------------------------------

  bench('getSymbols() — all symbols (no filter)', () => {
    index.getSymbols();
  });

  bench('getSymbolsInFile(file)', () => {
    index.getSymbolsInFile(sampleFile);
  });

  bench('getSymbolsByName(name)', () => {
    index.getSymbolsByName(sampleSymbolName);
  });

  bench('getExportedSymbols({ file })', () => {
    index.getExportedSymbols({ file: sampleFile });
  });

  // --------------------------------------------------------------------------
  // Reference queries
  // --------------------------------------------------------------------------

  bench('getReferences(symbolId)', () => {
    index.getReferences(sampleSymbolId);
  });

  bench('getReferencesInFile(file)', () => {
    index.getReferencesInFile(sampleFile);
  });

  // --------------------------------------------------------------------------
  // Call graph queries
  // --------------------------------------------------------------------------

  bench('getCallers(symbolId)', () => {
    index.getCallers(sampleSymbolId);
  });

  bench('getCallees(symbolId)', () => {
    index.getCallees(sampleSymbolId);
  });

  // --------------------------------------------------------------------------
  // Scope queries
  // --------------------------------------------------------------------------

  bench('getScopesInFile(file)', () => {
    index.getScopesInFile(sampleFile);
  });

  // --------------------------------------------------------------------------
  // Import / Export queries
  // --------------------------------------------------------------------------

  bench('getImportBindings(file)', () => {
    index.getImportBindings(sampleFile);
  });

  bench('getFileExports(file)', () => {
    index.getFileExports(sampleFile);
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  bench('getStats()', () => {
    index.getStats();
  });
});
