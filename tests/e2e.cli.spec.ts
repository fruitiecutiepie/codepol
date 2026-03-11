/**
 * E2E tests for @codepol/cli.
 *
 * Each test spawns the CLI as a subprocess and asserts on exit code,
 * stdout, and stderr. The CLI binary must be built before running
 * these tests (`pnpm build` does this).
 *
 * Temp directories symlink the monorepo's `node_modules` so that
 * `@codepol/plugin` and `@codepol/plugin-eslint` resolve correctly
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
    `import { eslintPluginCreate } from '@codepol/plugin-eslint';
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

/**
 * Codepol config that enables both ESLint and treesitter providers.
 * Used for --fix tests where ESLint autofix must actually run.
 */
function configContentCreateWithEslint(): string {
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

  describe('--fix', () => {
    let fixDir: string;

    beforeAll(() => {
      fixDir = tempProjectCreate();
      // Config that enables ESLint providers (no `providers: ['treesitter']` restriction)
      fs.writeFileSync(
        path.join(fixDir, 'codepol.config.js'),
        configContentCreateWithEslint(),
        'utf8',
      );
      // Logger mock module so the ESLint autofix import resolves
      fs.mkdirSync(path.join(fixDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(fixDir, 'src', 'logger.ts'),
        'export const logger = { enter(p: unknown) { return p; }, exit(p: unknown) { return p; } };\n',
        'utf8',
      );
    });

    afterAll(() => {
      fs.rmSync(fixDir, { recursive: true, force: true });
    });

    it('applies ESLint fixes to disk', async () => {
      const appPath = path.join(fixDir, 'src', 'app.ts');
      fs.writeFileSync(appPath, SOURCE_VIOLATION, 'utf8');
      const originalContent = fs.readFileSync(appPath, 'utf8');

      const result = await runCli(['--fix'], fixDir);

      // After fix, the file should be modified with logger instrumentation
      const fixedContent = fs.readFileSync(appPath, 'utf8');
      expect(fixedContent).not.toBe(originalContent);
      expect(fixedContent).toContain('logger.enter');
      expect(fixedContent).toContain('logger.exit');

      // Tree-sitter re-reads the fixed file from disk and should pass
      expect(result.exitCode).toBe(0);
    });
  });

  describe('--config <path>', () => {
    /**
     * Separate temp dir with NO root config — auto-discovery would fail.
     * Config is placed in a subdirectory and referenced via --config.
     */
    let configProjectDir: string;

    beforeAll(() => {
      configProjectDir = tempProjectCreate();
      // Write config in a subdirectory (not auto-discoverable from root)
      fs.mkdirSync(path.join(configProjectDir, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(configProjectDir, 'config', 'codepol.config.js'),
        configContentCreate(),
        'utf8',
      );
      // Ensure NO root-level config exists
      const rootConfig = path.join(configProjectDir, 'codepol.config.js');
      if (fs.existsSync(rootConfig)) {
        fs.unlinkSync(rootConfig);
      }
    });

    afterAll(() => {
      fs.rmSync(configProjectDir, { recursive: true, force: true });
    });

    it('uses explicit config and exits 0 when no violations', async () => {
      fs.mkdirSync(path.join(configProjectDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(configProjectDir, 'src', 'app.ts'),
        SOURCE_VALID,
        'utf8',
      );

      const configPath = path.join(configProjectDir, 'config', 'codepol.config.js');
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

      const configPath = path.join(configProjectDir, 'config', 'codepol.config.js');
      const result = await runCli(['--config', configPath], configProjectDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('run');
      expect(result.stdout).toContain('function-logging');
    });
  });

  // TODO: Remove .skip once --watch mode test is implemented.
  // --watch starts a chokidar file watcher with debounced re-runs.
  // Testing requires spawning a long-running process, modifying files,
  // and asserting on incremental output — complex async lifecycle.
  it.skip('--watch mode starts and responds to changes', () => {});
});
