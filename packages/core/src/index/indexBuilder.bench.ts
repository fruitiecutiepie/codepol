/**
 * Performance benchmarks for index building throughput.
 *
 * Measures `projectIndexBuildSync` on generated multi-file TypeScript projects.
 * Parsers are warmed up in beforeAll so benchmarks measure indexing, not WASM loading.
 *
 * Run: pnpm bench
 */

import { bench, describe, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
} from '@codepol/core';
import {
  benchProjectGenerate,
  benchProjectCleanup,
  type GeneratedProject,
} from '../../../../tests/benchHelpers';

describe('indexing throughput', () => {
  let project100: GeneratedProject;
  let project500: GeneratedProject;

  beforeAll(async () => {
    // Warm up: initialize parser and WASM once so bench measures indexing, not loading
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();

    // Generate test projects
    project100 = benchProjectGenerate(100);
    project500 = benchProjectGenerate(500);
  });

  afterAll(() => {
    benchProjectCleanup(project100);
    benchProjectCleanup(project500);
  });

  bench('index 100 files', () => {
    projectIndexBuildSync({
      files: project100.files,
      dir: project100.dir,
    });
  });

  bench('index 500 files', () => {
    projectIndexBuildSync({
      files: project500.files,
      dir: project500.dir,
    });
  });

  bench('index 100 files (no cross-file resolution)', () => {
    projectIndexBuildSync({
      files: project100.files,
      dir: project100.dir,
      crossFileResolution: false,
    });
  });
});
