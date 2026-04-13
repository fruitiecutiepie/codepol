import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SmokeWorkspace = {
  workspacePath: string;
  cleanup(): void;
};

export function smokeFixtureWorkspacePathResolve(baseDir: string = __dirname): string {
  return path.resolve(baseDir, '../../fixtures/workspace');
}

export function smokeWorkspaceCreate(
  options: {
    fixtureWorkspacePath?: string;
    tempRoot?: string;
    tempPrefix?: string;
  } = {},
): SmokeWorkspace {
  const fixtureWorkspacePath =
    options.fixtureWorkspacePath ?? smokeFixtureWorkspacePathResolve();
  const tempDir = fs.mkdtempSync(
    path.join(options.tempRoot ?? os.tmpdir(), options.tempPrefix ?? 'codepol-extension-smoke-'),
  );
  const workspacePath = path.join(tempDir, 'workspace');
  fs.cpSync(fixtureWorkspacePath, workspacePath, { recursive: true });

  return {
    workspacePath,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
