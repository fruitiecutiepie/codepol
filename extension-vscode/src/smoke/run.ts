import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index.js');

  await runTests({
    version: 'stable',
    extensionDevelopmentPath,
    extensionTestsPath,
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
