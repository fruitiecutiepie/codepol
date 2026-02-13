/**
 * Performance benchmarks for unused exports checking.
 *
 * Builds a 100-file project index with cross-file imports, then measures
 * the per-file latency of `unusedExportsCheck`.
 *
 * Run: pnpm bench
 */

import { bench, describe, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type PolicyRule,
  type PolicyCheckContext,
  type ProjectIndex,
} from '@codepol/core';
import { unusedExportsCheck } from './unusedExportsCheck';
import fs from 'node:fs';
import {
  benchProjectGenerate,
  benchProjectCleanup,
  type GeneratedProject,
} from '../../../tests/benchHelpers';

describe('unusedExportsCheck latency', () => {
  let project: GeneratedProject;
  let index: ProjectIndex;

  // Pre-read source for the file we'll check
  let targetFile: string;
  let targetSource: string;

  const rule: PolicyRule = {
    ruleId: 'unused-exports',
    description: 'bench rule',
    targets: [],
  };

  function contextCreate(
    filePath: string,
    source: string,
    projectIndex: ProjectIndex,
  ): { rule: PolicyRule; context: PolicyCheckContext } {
    const target = {
      language: 'typescript' as const,
      files: ['**/*.ts'],
    };
    return {
      rule,
      context: {
        filePath,
        source,
        policy: { targets: { 'ts-files': target }, rules: [rule] },
        dir: project.dir,
        target,
        projectIndex,
        ruleArgs: {},
      },
    };
  }

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

    // Pick a file near the middle (has both exports and imports from other files)
    targetFile = project.files[50];
    targetSource = fs.readFileSync(targetFile, 'utf-8');
  });

  afterAll(() => {
    benchProjectCleanup(project);
  });

  bench('check single file (100-file index)', () => {
    const { rule: r, context } = contextCreate(targetFile, targetSource, index);
    unusedExportsCheck(r, context);
  });

  bench('check first file (likely all used)', () => {
    const file = project.files[0];
    const source = fs.readFileSync(file, 'utf-8');
    const { rule: r, context } = contextCreate(file, source, index);
    unusedExportsCheck(r, context);
  });

  bench('check last file (likely unused exports)', () => {
    const file = project.files[project.files.length - 1];
    const source = fs.readFileSync(file, 'utf-8');
    const { rule: r, context } = contextCreate(file, source, index);
    unusedExportsCheck(r, context);
  });
});
