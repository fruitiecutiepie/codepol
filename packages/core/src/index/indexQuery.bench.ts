/**
 * Performance benchmarks for ProjectIndex query latency.
 *
 * Builds a 100-file index once in beforeAll, then measures individual
 * query methods to detect regressions in lookup speed.
 *
 * Run: pnpm bench
 */

import { bench, describe, beforeAll, afterAll } from 'vitest';
// Benchmarks run from source in CI, so avoid relying on built workspace package entries.
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  SymbolFlags,
  type ProjectIndex,
  type SymbolId,
} from '../index';
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
    const syms = index.symbolsInFileGet(sampleFile);
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

  bench('symbolsGet() — all symbols (no filter)', () => {
    index.symbolsGet();
  });

  bench('symbolsInFileGet(file)', () => {
    index.symbolsInFileGet(sampleFile);
  });

  bench('symbolsGetByName(name)', () => {
    index.symbolsGetByName(sampleSymbolName);
  });

  bench('exportedSymbolsGet({ file })', () => {
    index.exportedSymbolsGet({ file: sampleFile });
  });

  // --------------------------------------------------------------------------
  // Reference queries
  // --------------------------------------------------------------------------

  bench('referencesGet(symbolId)', () => {
    index.referencesGet(sampleSymbolId);
  });

  bench('referencesInFileGet(file)', () => {
    index.referencesInFileGet(sampleFile);
  });

  // --------------------------------------------------------------------------
  // Call graph queries
  // --------------------------------------------------------------------------

  bench('callersGet(symbolId)', () => {
    index.callersGet(sampleSymbolId);
  });

  bench('calleesGet(symbolId)', () => {
    index.calleesGet(sampleSymbolId);
  });

  // --------------------------------------------------------------------------
  // Scope queries
  // --------------------------------------------------------------------------

  bench('scopesInFileGet(file)', () => {
    index.scopesInFileGet(sampleFile);
  });

  // --------------------------------------------------------------------------
  // Import / Export queries
  // --------------------------------------------------------------------------

  bench('importBindingsGet(file)', () => {
    index.importBindingsGet(sampleFile);
  });

  bench('fileExportsGet(file)', () => {
    index.fileExportsGet(sampleFile);
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  bench('statsGet()', () => {
    index.statsGet();
  });
});
