import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

const ELECTRON_RUN_AS_NODE_ENV_KEYS = [
  'ELECTRON_RUN_AS_NODE',
  'ATOM_SHELL_INTERNAL_RUN_AS_NODE',
] as const;

function electronRunAsNodeEnvClear(): void {
  for (const key of ELECTRON_RUN_AS_NODE_ENV_KEYS) {
    delete process.env[key];
  }
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index.js');
  const vscodeVersion = process.env.CODEPOL_VSCODE_TEST_VERSION ?? 'stable';

  // The smoke runner often executes from an Electron-backed shell.
  // If the parent process leaks run-as-node flags, VS Code's test host
  // treats its app binary like plain Electron and rejects extension-test args.
  electronRunAsNodeEnvClear();

  await runTests({
    version: vscodeVersion,
    extensionDevelopmentPath,
    extensionTestsPath,
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
