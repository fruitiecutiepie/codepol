import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  WorkspaceDaemonConnectFn,
  WorkspaceDaemonDescriptor,
  WorkspaceDaemonRequestClient,
  WorkspacePolicyCheckOptions,
  WorkspacePolicyCheckResult,
} from '@codepol/workspace-service';
import {
  policyCheck as workspacePolicyCheck,
  workspaceDaemonDescriptorCreate,
  workspaceDaemonDescriptorWrite,
  WorkspaceDaemonSession,
} from '@codepol/workspace-service';
import { policyCheck } from '../apps/cli/src/index';

function tempWorkspaceCreate(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function noInterfaceConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["src"]
`;
}

function noUnusedVarsConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/eslint"
targets = ["src"]
args.configPath = "./eslint.config.mjs"

[[rules]]
ruleId = "@codepol/plugin/no-unused-vars"
targets = ["src"]
`;
}

function daemonConnectCreate(options: {
  descriptor: WorkspaceDaemonDescriptor;
  policyCheck?: (
    input: WorkspacePolicyCheckOptions,
  ) => Promise<WorkspacePolicyCheckResult>;
}): WorkspaceDaemonConnectFn {
  return async (descriptor): Promise<WorkspaceDaemonRequestClient> => {
    if (descriptor.sessionNonce !== options.descriptor.sessionNonce) {
      throw new Error('daemon unavailable');
    }
    const session = new WorkspaceDaemonSession({
      descriptor: options.descriptor,
      policyCheck: options.policyCheck,
    });
    return {
      async request<TResponse extends Record<string, unknown>>(
        message: Parameters<WorkspaceDaemonRequestClient['request']>[0],
      ): Promise<TResponse> {
        const response = await session.handleMessage(message);
        if (response.type === 'error') {
          throw new Error(response.message);
        }
        return response as unknown as TResponse;
      },
      async close(): Promise<void> {},
    };
  };
}

describe('CLI daemon policy checks', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses a daemon-backed policy check by default', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-cli-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const workspaceRoot = tempWorkspaceCreate('codepol-cli-daemon-workspace-');
    createdDirs.push(workspaceRoot);

    const expectedResult: WorkspacePolicyCheckResult = {
      policy: {
        exclude: [],
        plugins: [],
        targets: {},
        rules: [],
      } as WorkspacePolicyCheckResult['policy'],
      files: ['src/app.ts'],
      violations: [],
      treeViolations: [],
      workspaceDiagnostics: [],
      eslintOutput: '',
      eslintHasErrors: false,
    };
    const resolved: Array<{ mode: string; launched?: boolean }> = [];

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    const connect = daemonConnectCreate({
      descriptor,
      policyCheck: async (input) => {
        expect(input.cwd).toBe(workspaceRoot);
        expect(input.configPath).toBe('codepol.toml');
        expect(input.fix).toBe(false);
        return expectedResult;
      },
    });

    const result = await policyCheck({
      config: {
        exclude: [],
        plugins: [],
        targets: {},
        rules: [],
      } as WorkspacePolicyCheckResult['policy'],
      configPath: 'codepol.toml',
      fix: false,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
      },
      connect,
      startDaemon: async () => {
        throw new Error('startDaemon should not run for a healthy daemon descriptor');
      },
      onResolved: (info) => {
        resolved.push({
          mode: info.mode,
          launched: 'launched' in info ? info.launched : undefined,
        });
      },
    });

    expect(result).toEqual(expectedResult);
    expect(resolved).toEqual([{ mode: 'daemon', launched: false }]);
  });

  it('falls back to in-process policy checks when a daemon misses in-memory builtin plugin registrations', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-cli-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const workspaceRoot = tempWorkspaceCreate('codepol-cli-daemon-workspace-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), '# inline config\n', 'utf8');
    fs.writeFileSync(
      path.join(workspaceRoot, 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
      'utf8',
    );

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    const connect = daemonConnectCreate({
      descriptor,
      policyCheck: async () => {
        throw new Error(
          'Builtin plugin test-inline-plugin is not registered. Register it with pluginBuiltinRegister() before loading the config.',
        );
      },
    });

    const result = await policyCheck({
      config: {
        exclude: [],
        plugins: [],
        targets: {},
        rules: [],
      } as WorkspacePolicyCheckResult['policy'],
      configPath: 'codepol.toml',
      fix: false,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
      },
      connect,
      startDaemon: async () => {
        throw new Error('startDaemon should not run for a healthy daemon descriptor');
      },
    });

    expect(result.files).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.treeViolations).toEqual([]);
    expect(result.workspaceDiagnostics).toEqual([]);
    expect(result.eslintOutput).toBe('');
    expect(result.eslintHasErrors).toBe(false);
  });

  it('preserves one-shot fix behavior through the daemon-backed policy check', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-cli-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const workspaceRoot = tempWorkspaceCreate('codepol-cli-daemon-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
      'utf8',
    );

    const appPath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.writeFileSync(
      appPath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    const connect = daemonConnectCreate({
      descriptor,
      policyCheck: workspacePolicyCheck,
    });

    const result = await policyCheck({
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      fix: true,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
      },
      connect,
      startDaemon: async () => {
        throw new Error('startDaemon should not run for a healthy daemon descriptor');
      },
    });

    expect(fs.readFileSync(appPath, 'utf8')).toContain('type User =');
    expect(fs.readFileSync(appPath, 'utf8')).not.toContain('interface User');
    expect(result.violations).toHaveLength(0);
    expect(result.workspaceDiagnostics).toHaveLength(0);
  });

  it('reports migrated no-unused-vars diagnostics through the in-process CLI policy check', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-cli-in-process-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noUnusedVarsConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'app.ts'),
      `function demo() {
  const unused = 1;
  return 1;
}

demo();
`,
      'utf8',
    );

    const resolved: Array<{ mode: string }> = [];
    const result = await policyCheck({
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      fix: false,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEPOL_WORKSPACE_SERVICE_MODE: 'in_process',
      },
      onResolved: (info) => {
        resolved.push({
          mode: info.mode,
        });
      },
    });

    expect(resolved).toEqual([{ mode: 'in_process' }]);
    expect(result.violations).toEqual([
      expect.objectContaining({
        ruleId: '@codepol/plugin/no-unused-vars',
        message: "'unused' is assigned a value but never used.",
      }),
    ]);
    expect(result.workspaceDiagnostics).toEqual([
      expect.objectContaining({
        source: 'codepol',
        code: '@codepol/plugin/no-unused-vars',
        message: "'unused' is assigned a value but never used.",
      }),
    ]);
    expect(result.eslintOutput).toBe('');
    expect(result.eslintHasErrors).toBe(false);
  });

  it('preserves migrated no-unused-vars fixes through the daemon-backed policy check', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-cli-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const workspaceRoot = tempWorkspaceCreate('codepol-cli-daemon-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noUnusedVarsConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
      'utf8',
    );

    const appPath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.writeFileSync(
      appPath,
      `function demo() {
  const unused = 1;
  return 1;
}

demo();
`,
      'utf8',
    );

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    const connect = daemonConnectCreate({
      descriptor,
      policyCheck: workspacePolicyCheck,
    });

    const result = await policyCheck({
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      fix: true,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
      },
      connect,
      startDaemon: async () => {
        throw new Error('startDaemon should not run for a healthy daemon descriptor');
      },
    });

    expect(fs.readFileSync(appPath, 'utf8')).toBe(`function demo() {
  return 1;
}

demo();
`);
    expect(result.violations).toHaveLength(0);
    expect(result.workspaceDiagnostics).toHaveLength(0);
    expect(result.eslintOutput).toBe('');
    expect(result.eslintHasErrors).toBe(false);
  });

  it('uses an in-process policy check when explicitly requested', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-cli-in-process-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'app.ts'),
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    let startDaemonCalls = 0;
    const resolved: Array<{ mode: string }> = [];
    const result = await policyCheck({
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      fix: false,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEPOL_WORKSPACE_SERVICE_MODE: 'in_process',
      },
      startDaemon: async () => {
        startDaemonCalls += 1;
      },
      onResolved: (info) => {
        resolved.push({
          mode: info.mode,
        });
      },
    });

    expect(startDaemonCalls).toBe(0);
    expect(resolved).toEqual([{ mode: 'in_process' }]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.ruleId).toBe('@codepol/plugin/no-interface');
  });

  it('falls back to in-process policy checks when daemon startup fails', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-cli-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const workspaceRoot = tempWorkspaceCreate('codepol-cli-daemon-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'app.ts'),
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const resolved: Array<{ mode: string; error?: string }> = [];
    const result = await policyCheck({
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      fix: false,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
      },
      startDaemon: async () => {
        throw new Error('daemon launch failed');
      },
      onResolved: (info) => {
        resolved.push({
          mode: info.mode,
          error: 'error' in info ? info.error.message : undefined,
        });
      },
    });

    expect(resolved).toEqual([
      {
        mode: 'in_process_fallback',
        error: 'daemon launch failed',
      },
    ]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.ruleId).toBe('@codepol/plugin/no-interface');
  });

  it('falls back to in-process policy checks when daemon install ids differ', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-cli-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const { descriptor } = workspaceDaemonDescriptorCreate({
      runtimeDir,
      installId: 'stable',
    });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);

    const workspaceRoot = tempWorkspaceCreate('codepol-cli-daemon-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'src', 'app.ts'),
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    let startDaemonCalls = 0;
    const resolved: Array<{ mode: string; error?: string }> = [];
    const result = await policyCheck({
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      fix: false,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
        CODEPOL_INSTALL_ID: 'insiders',
      },
      connect: daemonConnectCreate({
        descriptor,
      }),
      startDaemon: async () => {
        startDaemonCalls += 1;
      },
      onResolved: (info) => {
        resolved.push({
          mode: info.mode,
          error: 'error' in info ? info.error.message : undefined,
        });
      },
    });

    expect(startDaemonCalls).toBe(0);
    expect(resolved).toEqual([
      {
        mode: 'in_process_fallback',
        error: 'Daemon handshake failed: unexpected_install_id',
      },
    ]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.ruleId).toBe('@codepol/plugin/no-interface');
  });
});
