import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { esbuildPluginCreate } from '@codepol/plugin-esbuild';

function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

/** Standard codepol config content for a single logger rule. */
function codepolConfigContent(opts?: { targetFiles?: string[]; rules?: string }): string {
  const files = opts?.targetFiles ?? ['index.ts'];
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.ts-entry]
language = "typescript"
files = ${tomlStringArray(files)}

${opts?.rules ?? `[[rules]]
id = "function-logging"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Ensure functions include logger enter/exit"
targets = ["ts-entry"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "./logger", named = "logger" }
`}
`;
}

/** Standard logger mock module. */
const loggerModuleContent = `export const logger = {
  enter(payload: unknown) { return payload; },
  exit(payload: unknown) { return payload; },
};
`;

/** Minimal ESLint flat config with no rules enabled. */
const eslintConfigMinimal = `export default [
  {
    files: ['**/*.ts'],
    rules: {},
  },
];
`;

/** Conforming function source that passes the logger rule. */
const conformingSource = `import { logger } from './logger';
export const f = () => {
  logger.enter({});
  try {
    return 1;
  } finally {
    logger.exit({});
  }
};
`;

/** Violating function source that fails the logger rule. */
const violatingSource = 'export const f = () => 1;';

/** Sets up a standard temp project dir with config, logger mock, and eslint config. */
function tempProjectCreate(opts?: {
  configContent?: string;
  eslintConfigContent?: string;
  targetFiles?: string[];
}): {
  dir: string;
  configPath: string;
  loggerPath: string;
  eslintConfigPath: string;
  outfile: string;
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'codepol-esbuild-'));
  const configPath = path.join(dir, 'codepol.toml');
  const loggerPath = path.join(dir, 'logger.ts');
  const eslintConfigPath = path.join(dir, 'eslint.config.mjs');
  const outfile = path.join(dir, 'out.js');

  writeFileSync(configPath, opts?.configContent ?? codepolConfigContent({ targetFiles: opts?.targetFiles }));
  writeFileSync(loggerPath, loggerModuleContent);
  writeFileSync(eslintConfigPath, opts?.eslintConfigContent ?? eslintConfigMinimal);

  return { dir, configPath, loggerPath, eslintConfigPath, outfile };
}

describe('esbuild policy plugin', () => {
  it('fails the build when policy violations are present and succeeds after fixes', async () => {
    const { dir, outfile } = tempProjectCreate();
    const entryPath = path.join(dir, 'index.ts');

    writeFileSync(entryPath, violatingSource);

    const failure = await build({
      absWorkingDir: dir,
      entryPoints: [entryPath],
      outfile,
      bundle: false,
      logLevel: 'silent',
      plugins: [esbuildPluginCreate({ configPath: 'codepol.toml' })],
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(Error);

    writeFileSync(entryPath, conformingSource);

    const result = await build({
      absWorkingDir: dir,
      entryPoints: [entryPath],
      outfile,
      bundle: false,
      logLevel: 'silent',
      plugins: [esbuildPluginCreate({ configPath: 'codepol.toml' })],
    });

    expect(result.errors.length).toBe(0);
  });

  it('fix: true still reports tree-sitter violations when no ESLint autofix is available', async () => {
    const { dir, outfile } = tempProjectCreate();
    const entryPath = path.join(dir, 'index.ts');

    writeFileSync(entryPath, violatingSource);

    const failure = await build({
      absWorkingDir: dir,
      entryPoints: [entryPath],
      outfile,
      bundle: false,
      logLevel: 'silent',
      plugins: [esbuildPluginCreate({ configPath: 'codepol.toml', fix: true })],
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('logger.enter');
  });

  it('auto-discovers config when configPath is not specified', async () => {
    const { dir, outfile } = tempProjectCreate();
    const entryPath = path.join(dir, 'index.ts');

    writeFileSync(entryPath, conformingSource);

    const result = await build({
      absWorkingDir: dir,
      entryPoints: [entryPath],
      outfile,
      bundle: false,
      logLevel: 'silent',
      plugins: [esbuildPluginCreate()],
    });

    expect(result.errors.length).toBe(0);
  });

  it('build passes when no files match the policy targets', async () => {
    const configContent = codepolConfigContent({ targetFiles: ['nonexistent/**/*.ts'] });
    const { dir, outfile } = tempProjectCreate({ configContent });
    const entryPath = path.join(dir, 'index.ts');

    writeFileSync(entryPath, violatingSource);

    const result = await build({
      absWorkingDir: dir,
      entryPoints: [entryPath],
      outfile,
      bundle: false,
      logLevel: 'silent',
      plugins: [esbuildPluginCreate({ configPath: 'codepol.toml' })],
    });

    expect(result.errors.length).toBe(0);
  });

  it('multiple rules — all are checked', async () => {
    const configContent = `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.entry-a]
language = "typescript"
files = ["a.ts"]

[targets.entry-b]
language = "typescript"
files = ["b.ts"]

[[rules]]
id = "logging-a"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Logger rule for file A"
targets = ["entry-a"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "./logger", named = "logger" }

[[rules]]
id = "logging-b"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Logger rule for file B"
targets = ["entry-b"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "./logger", named = "logger" }
`;

    const { dir, outfile } = tempProjectCreate({ configContent });
    const aPath = path.join(dir, 'a.ts');
    const bPath = path.join(dir, 'b.ts');

    writeFileSync(aPath, 'export function doA() { return 1; }');
    writeFileSync(bPath, 'export function doB() { return 2; }');

    const failure = await build({
      absWorkingDir: dir,
      entryPoints: [aPath],
      outfile,
      bundle: false,
      logLevel: 'silent',
      plugins: [esbuildPluginCreate({ configPath: 'codepol.toml' })],
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    const errorMessage = (failure as Error).message;
    expect(errorMessage).toContain('a.ts');
    expect(errorMessage).toContain('b.ts');
  });
});
