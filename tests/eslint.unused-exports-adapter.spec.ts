/**
 * Integration test: ESLint adapter with `requiresProjectIndex: true`.
 *
 * Verifies that the ESLint adapter correctly builds a ProjectIndex and
 * passes it to the treeCheckProvider.check() function when a plugin
 * declares `requiresProjectIndex: true`. Uses `unusedExportsRule` from
 * @codepol/plugin as the real-world rule under test.
 *
 * Test setup:
 * - Temp directory with multiple .ts files (exporter + consumer)
 * - Codepol config targeting those files
 * - process.cwd() mocked to the temp dir so the adapter discovers files
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  eslintAdapter,
  policyCacheClear,
  projectIndexCacheClear,
} from '@codepol/plugin-eslint';
import { unusedExportsRule } from '@codepol/plugin';
import { langAdd, parserInit, configCacheClear } from '@codepol/core';

// ---------------------------------------------------------------------------
// Module-level temp directory setup (synchronous, before test collection)
// ---------------------------------------------------------------------------

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'codepol-test-project-index-'),
);

// Source: exporter with one used and one unused export
const exporterSource = `\
export function usedFn() { return 1; }
export function unusedFn() { return 2; }
`;

// Source: consumer that imports only usedFn
const consumerSource = `\
import { usedFn } from './exporter';
console.log(usedFn());
`;

// Source: file where ALL exports are consumed (valid case)
const allUsedSource = `\
export function onlyExport() { return 42; }
`;

const allUsedConsumerSource = `\
import { onlyExport } from './allUsed';
console.log(onlyExport());
`;

// Write source files
fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(tempDir, 'src', 'exporter.ts'), exporterSource);
fs.writeFileSync(path.join(tempDir, 'src', 'consumer.ts'), consumerSource);
fs.writeFileSync(path.join(tempDir, 'src', 'allUsed.ts'), allUsedSource);
fs.writeFileSync(
  path.join(tempDir, 'src', 'allUsedConsumer.ts'),
  allUsedConsumerSource,
);

// Write codepol config that targets src/**/*.ts with unused-exports rule
const configPath = path.join(tempDir, 'codepol.toml');
fs.writeFileSync(
  configPath,
  `[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "unused-exports"
ruleId = "@codepol/plugin/no-unused-exports"
targets = ["src"]
`,
);

// ---------------------------------------------------------------------------
// Parser init and cwd mock
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();

  // Clear all caches so the adapter loads config and builds index fresh
  configCacheClear();
  policyCacheClear();
  projectIndexCacheClear();

  // Mock process.cwd() to the temp dir so the adapter can:
  // - discover files via fast-glob relative to cwd
  // - compute relative paths for file matching
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
});

afterAll(() => {
  cwdSpy?.mockRestore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Adapted rule and RuleTester
// ---------------------------------------------------------------------------

const eslintRule = eslintAdapter.adapt(unusedExportsRule, {
  ruleName: 'adapted-unused-exports',
});

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as any,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

const ruleOptions = [
  {
    configPath,
    policyExclude: [] as string[],
  },
];

// ---------------------------------------------------------------------------
// RuleTester test cases
// ---------------------------------------------------------------------------

ruleTester.run('adapted-unused-exports', eslintRule as any, {
  valid: [
    {
      name: 'file with all exports consumed reports no violations',
      filename: path.join(tempDir, 'src', 'allUsed.ts'),
      options: ruleOptions,
      code: allUsedSource,
    },
    {
      name: 'consumer file with no exports reports no violations',
      filename: path.join(tempDir, 'src', 'consumer.ts'),
      options: ruleOptions,
      code: consumerSource,
    },
  ],
  invalid: [
    {
      name: 'file with unused export reports treeCheckViolation',
      filename: path.join(tempDir, 'src', 'exporter.ts'),
      options: ruleOptions,
      code: exporterSource,
      errors: [{ messageId: 'treeCheckViolation' }],
      output: `\
export function usedFn() { return 1; }
function unusedFn() { return 2; }
`,
    },
  ],
});

// ---------------------------------------------------------------------------
// Additional assertions
// ---------------------------------------------------------------------------

describe('eslint adapter with requiresProjectIndex', () => {
  it('adapted rule has correct meta for cross-file analysis', () => {
    expect(eslintRule).toBeDefined();
    expect(eslintRule.meta).toBeDefined();
    expect(eslintRule.meta?.messages).toHaveProperty('treeCheckViolation');
    expect(eslintRule.create).toBeInstanceOf(Function);
  });
});
