/**
 * E2E tests for @codepol/cli.
 *
 * Each test spawns the CLI as a subprocess and asserts on exit code,
 * stdout, and stderr. The CLI binary must be built before running
 * these tests (`pnpm build` does this).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Workspace root (monorepo root). */
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

/** Resolved path to the built CLI entry point. */
const CLI_PATH = path.join(WORKSPACE_ROOT, 'apps', 'cli', 'dist', 'index.js');

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });

    setTimeout(() => {
      child.kill('SIGTERM');
    }, 30_000);
  });
}

function tempProjectCreate(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-e2e-cli-'));

  fs.writeFileSync(
    path.join(dir, 'eslint.config.mjs'),
    `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
    'utf8',
  );

  return dir;
}

function loggerConfigContentCreate(): string {
  return `exclude = []

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/app.ts"]

[[rules]]
id = "function-logging"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Ensure functions include logger enter/exit"
targets = ["src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "./logger", named = "logger" }
`;
}

function noInterfaceConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/app.ts"]

[[rules]]
id = "no-interface"
ruleId = "@codepol/plugin/no-interface"
targets = ["src"]
`;
}

function enforceCasingConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "enforce-casing"
ruleId = "@codepol/plugin/enforce-casing"
targets = ["src"]

[rules.args.symbols]
function = ["camelCase"]
`;
}

function forbiddenDeclarationsConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "forbidden-declarations"
ruleId = "@codepol/plugin/forbidden-declarations"
targets = ["src"]
args.symbols = ["class"]
args.bindings = ["import"]
args.syntax = ["var"]
`;
}

const SOURCE_VALID = `\
import { logger } from './logger';

export function run() {
  logger.enter({});
  try {
    return 1;
  } finally {
    logger.exit({});
  }
}
`;

const SOURCE_VIOLATION = `\
export function run() {
  return 1;
}
`;

const SOURCE_INTERFACE = `\
export interface User {
  name: string;
}
`;

const SOURCE_BAD_EXPORT = `\
export function BAD_NAME() {
  return 1;
}
`;

const SOURCE_BAD_IMPORT_ALIAS = `\
import { BAD_NAME as goodAlias } from './dep';

export function runTask() {
  return goodAlias();
}
`;

const SOURCE_FORBIDDEN_DECLARATIONS = `\
import foo from './dep';

var legacyValue = 1;

class Widget {}

export function runTask() {
  return foo + legacyValue + Widget.length;
}
`;

describe('CLI E2E', () => {
  let projectDir: string;

  beforeAll(() => {
    projectDir = tempProjectCreate();
  });

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  describe('--help', () => {
    it('prints usage and exits 0', async () => {
      const result = await runCli(['--help'], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Options');
      expect(result.stdout).toContain('--fix');
      expect(result.stdout).toContain('--watch');
      expect(result.stdout).toContain('--config');
      expect(result.stdout).toContain('--check-plugins');
    });
  });

  describe('--version', () => {
    it('prints version and exits 0', async () => {
      const result = await runCli(['--version'], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('--check-plugins', () => {
    it('validates config and prints plugin names', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'codepol.toml'),
        loggerConfigContentCreate(),
        'utf8',
      );

      const result = await runCli(['--check-plugins'], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Config loaded from');
      expect(result.stdout).toContain('Plugins validated');
      expect(result.stdout).toContain('require-logger-enter-exit');
    });
  });

  describe('no violations', () => {
    it('exits 0 when all functions are instrumented', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'codepol.toml'),
        loggerConfigContentCreate(),
        'utf8',
      );
      fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), SOURCE_VALID, 'utf8');

      const result = await runCli([], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Policy checks passed');
    });
  });

  describe('violations present', () => {
    it('exits non-zero when violations exist', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'codepol.toml'),
        loggerConfigContentCreate(),
        'utf8',
      );
      fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), SOURCE_VIOLATION, 'utf8');

      const result = await runCli([], projectDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('run');
      expect(result.stdout).toContain('function-logging');
    });

    it('loads nested forbidden-declarations args from policy config', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'codepol.toml'),
        forbiddenDeclarationsConfigContentCreate(),
        'utf8',
      );
      fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, 'src', 'app.ts'),
        SOURCE_FORBIDDEN_DECLARATIONS,
        'utf8',
      );
      fs.writeFileSync(path.join(projectDir, 'src', 'dep.ts'), 'export default 1;\n', 'utf8');

      const result = await runCli([], projectDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('forbidden-declarations');
      expect(result.stdout).toContain('foo');
      expect(result.stdout).toContain('legacyValue');
      expect(result.stdout).toContain('Widget');
    });
  });

  describe('config not found', () => {
    it('exits with error when no config exists', async () => {
      const systemTmp = fs.realpathSync(os.tmpdir());
      const emptyDir = fs.mkdtempSync(path.join(systemTmp, 'codepol-e2e-noconfig-'));

      try {
        const result = await runCli([], emptyDir);

        expect(result.exitCode).not.toBe(0);
        const combined = result.stdout + result.stderr;
        expect(combined.toLowerCase()).toMatch(/config|not found|no.*config/i);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('--fix', () => {
    let fixDir: string;

    beforeAll(() => {
      fixDir = tempProjectCreate();
      fs.writeFileSync(
        path.join(fixDir, 'codepol.toml'),
        noInterfaceConfigContentCreate(),
        'utf8',
      );
      fs.mkdirSync(path.join(fixDir, 'src'), { recursive: true });
    });

    afterAll(() => {
      fs.rmSync(fixDir, { recursive: true, force: true });
    });

    it('applies rule fixes to disk', async () => {
      const appPath = path.join(fixDir, 'src', 'app.ts');
      fs.writeFileSync(appPath, SOURCE_INTERFACE, 'utf8');
      const originalContent = fs.readFileSync(appPath, 'utf8');

      const result = await runCli(['--fix'], fixDir);

      const fixedContent = fs.readFileSync(appPath, 'utf8');
      expect(fixedContent).not.toBe(originalContent);
      expect(fixedContent).toContain('type User =');
      expect(fixedContent).not.toContain('interface User');
      expect(result.exitCode).toBe(0);
    });

    it('applies cross-file casing renames while preserving aliased local references', async () => {
      fs.writeFileSync(
        path.join(fixDir, 'codepol.toml'),
        enforceCasingConfigContentCreate(),
        'utf8',
      );

      const depPath = path.join(fixDir, 'src', 'dep.ts');
      const appPath = path.join(fixDir, 'src', 'app.ts');
      fs.writeFileSync(depPath, SOURCE_BAD_EXPORT, 'utf8');
      fs.writeFileSync(appPath, SOURCE_BAD_IMPORT_ALIAS, 'utf8');

      const result = await runCli(['--fix'], fixDir);

      const fixedDep = fs.readFileSync(depPath, 'utf8');
      const fixedApp = fs.readFileSync(appPath, 'utf8');

      expect(fixedDep).toContain('export function badName()');
      expect(fixedApp).toContain("import { badName as goodAlias } from './dep';");
      expect(fixedApp).toContain('return goodAlias();');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Policy checks passed');
    });
  });

  describe('--config <path>', () => {
    let configProjectDir: string;

    beforeAll(() => {
      configProjectDir = tempProjectCreate();
      fs.mkdirSync(path.join(configProjectDir, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(configProjectDir, 'config', 'codepol.toml'),
        loggerConfigContentCreate(),
        'utf8',
      );
      const rootConfig = path.join(configProjectDir, 'codepol.toml');
      if (fs.existsSync(rootConfig)) {
        fs.unlinkSync(rootConfig);
      }
    });

    afterAll(() => {
      fs.rmSync(configProjectDir, { recursive: true, force: true });
    });

    it('uses explicit config and exits 0 when no violations', async () => {
      fs.mkdirSync(path.join(configProjectDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(configProjectDir, 'src', 'app.ts'), SOURCE_VALID, 'utf8');

      const configPath = path.join(configProjectDir, 'config', 'codepol.toml');
      const result = await runCli(['--config', configPath], configProjectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Policy checks passed');
    });

    it('uses explicit config and detects violations', async () => {
      fs.mkdirSync(path.join(configProjectDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(configProjectDir, 'src', 'app.ts'),
        SOURCE_VIOLATION,
        'utf8',
      );

      const configPath = path.join(configProjectDir, 'config', 'codepol.toml');
      const result = await runCli(['--config', configPath], configProjectDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('run');
      expect(result.stdout).toContain('function-logging');
    });
  });

  it.skip('--watch mode starts and responds to changes', () => {});
});
