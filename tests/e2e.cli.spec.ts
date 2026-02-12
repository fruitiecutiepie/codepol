/**
 * E2E tests for @codepol/cli.
 *
 * Each test spawns the CLI as a subprocess and asserts on exit code,
 * stdout, and stderr. The CLI binary must be built before running
 * these tests (`pnpm build` does this).
 *
 * Temp directories symlink the monorepo's `node_modules` so that
 * `@codepol/plugin` and `@codepol/eslint-plugin` resolve correctly
 * from the subprocess.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Workspace root (monorepo root). */
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

/** Resolved path to the built CLI entry point. */
const CLI_PATH = path.join(WORKSPACE_ROOT, 'apps', 'cli', 'dist', 'index.js');

/** Monorepo node_modules — symlinked into each temp project dir. */
const NODE_MODULES_PATH = path.join(WORKSPACE_ROOT, 'node_modules');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/**
 * Spawn the CLI as a child process and capture its output.
 * Uses `spawn` + 'close' event for reliable exit code capture.
 *
 * @param args - CLI arguments (e.g. `['--help']`)
 * @param cwd  - Working directory for the subprocess
 */
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

    // Safety: kill if the process doesn't exit within 30s
    setTimeout(() => {
      child.kill('SIGTERM');
    }, 30_000);
  });
}

/**
 * Create a temp project directory with node_modules symlinked
 * and a proper ESLint config that registers the codepol plugin.
 */
function tempProjectCreate(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-e2e-cli-'));

  // Symlink monorepo node_modules so @codepol/* packages resolve.
  fs.symlinkSync(NODE_MODULES_PATH, path.join(dir, 'node_modules'), 'junction');

  // ESLint flat config that registers the codepol plugin for .ts files.
  // Required because the CLI collects ESLint providers from all loaded
  // plugin rules (including ones not referenced in the policy).
  fs.writeFileSync(
    path.join(dir, 'eslint.config.mjs'),
    `import { eslintPluginCreate } from '@codepol/eslint-plugin';
import pluginRules from '@codepol/plugin';
const codepol = eslintPluginCreate(pluginRules);
export default [{ files: ['**/*.ts'], plugins: { codepol } }];
`,
    'utf8',
  );

  return dir;
}

// ---------------------------------------------------------------------------
// Config and source helpers
// ---------------------------------------------------------------------------

/** Codepol config: logger rule targeting src/app.ts via treesitter only. */
function configContentCreate(): string {
  return `module.exports = {
  plugins: [{ module: '@codepol/plugin' }],
  exclude: [],
  targets: {
    src: {
      language: 'typescript',
      files: ['src/app.ts'],
    },
  },
  rules: [
    {
      id: 'function-logging',
      ruleId: '@codepol/plugin/require-logger-enter-exit',
      description: 'Ensure functions include logger enter/exit',
      args: {
        logger: {
          identifier: 'logger',
          enterMethod: 'enter',
          exitMethod: 'exit',
          import: { module: './logger', named: 'logger' },
        },
      },
      targets: ['src'],
      providers: ['treesitter'],
    },
  ],
};
`;
}

/** Source code for a function that is already instrumented (no violation). */
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

/** Source code for a function missing logger instrumentation (violation). */
const SOURCE_VIOLATION = `\
export function run() {
  return 1;
}
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI E2E', () => {
  /**
   * A shared temp dir with node_modules symlink. Each scenario that
   * needs a project writes its own config and source files here.
   */
  let projectDir: string;

  beforeAll(() => {
    projectDir = tempProjectCreate();
  });

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  // --help and --version work from any directory (yargs handles them
  // after parserInit but before config loading).

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
      // yargs outputs the version string from package.json
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  // Scenarios that need a codepol config and source files.

  describe('--check-plugins', () => {
    it('validates config and prints plugin names', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'codepol.config.js'),
        configContentCreate(),
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
        path.join(projectDir, 'codepol.config.js'),
        configContentCreate(),
        'utf8',
      );
      fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, 'src', 'app.ts'),
        SOURCE_VALID,
        'utf8',
      );

      const result = await runCli([], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Policy checks passed');
    });
  });

  describe('violations present', () => {
    it('exits non-zero when violations exist', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'codepol.config.js'),
        configContentCreate(),
        'utf8',
      );
      fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, 'src', 'app.ts'),
        SOURCE_VIOLATION,
        'utf8',
      );

      const result = await runCli([], projectDir);

      expect(result.exitCode).toBe(1);
      // Output should mention the violating function
      expect(result.stdout).toContain('run');
      expect(result.stdout).toContain('function-logging');
    });
  });

  describe('config not found', () => {
    it('exits with error when no config exists', async () => {
      // Create in a top-level temp location, NOT inside projectDir,
      // so configFileDiscover won't find a config when walking up.
      const systemTmp = fs.realpathSync(os.tmpdir());
      const emptyDir = fs.mkdtempSync(
        path.join(systemTmp, 'codepol-e2e-noconfig-'),
      );

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

  // -------------------------------------------------------------------------
  // Skipped scenarios
  // -------------------------------------------------------------------------

  // TODO: Remove .skip once the esbuild/eslint plugin wiring gap is resolved.
  // The CLI's --fix flag applies ESLint fixes, but the codepol ESLint rules
  // need proper overrideConfig wiring to work end-to-end (same gap as the
  // esbuild plugin fix:true scenario).
  it.skip('--fix applies fixes to disk', () => {});

  // TODO: Remove .skip once --config <path> explicit config test is added.
  // Lower priority — auto-discovery is already tested above.
  it.skip('--config <path> uses explicit config', () => {});

  // TODO: Remove .skip once --watch mode test is implemented.
  // --watch starts a chokidar file watcher with debounced re-runs.
  // Testing requires spawning a long-running process, modifying files,
  // and asserting on incremental output — complex async lifecycle.
  it.skip('--watch mode starts and responds to changes', () => {});
});
