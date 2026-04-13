import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  smokeFixtureWorkspacePathResolve,
  smokeWorkspaceCreate,
} from '../extension-vscode/src/smoke/workspace';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('extension-vscode smoke workspace', () => {
  it('resolves the checked-in fixture workspace from the compiled smoke output path', () => {
    const resolved = smokeFixtureWorkspacePathResolve(
      path.resolve(process.cwd(), 'extension-vscode', 'dist', 'smoke'),
    );
    expect(resolved).toBe(
      path.resolve(process.cwd(), 'extension-vscode', 'fixtures', 'workspace'),
    );
  });

  it('copies the checked-in fixture workspace before mutation-capable smoke flows', () => {
    const fixtureWorkspacePath = smokeFixtureWorkspacePathResolve();
    const fixtureManifestPath = path.join(
      fixtureWorkspacePath,
      'packages',
      'lib',
      'package.json',
    );
    const originalManifest = fs.readFileSync(fixtureManifestPath, 'utf8');

    const smokeWorkspace = smokeWorkspaceCreate();
    createdDirs.push(path.dirname(smokeWorkspace.workspacePath));

    expect(smokeWorkspace.workspacePath).not.toBe(fixtureWorkspacePath);
    expect(
      fs.readFileSync(
        path.join(smokeWorkspace.workspacePath, 'packages', 'lib', 'package.json'),
        'utf8',
      ),
    ).toBe(originalManifest);
    expect(
      fs.readFileSync(
        path.join(smokeWorkspace.workspacePath, 'apps', 'web', 'src', 'app.ts'),
        'utf8',
      ),
    ).toContain('@acme/lib');

    fs.writeFileSync(
      path.join(smokeWorkspace.workspacePath, 'packages', 'lib', 'package.json'),
      `${JSON.stringify({ name: '@acme/lib-renamed', main: './dist/index.js' }, null, 2)}\n`,
      'utf8',
    );

    expect(fs.readFileSync(fixtureManifestPath, 'utf8')).toBe(originalManifest);
  });

  it('removes the copied workspace when cleanup is requested', () => {
    const smokeWorkspace = smokeWorkspaceCreate();
    const tempDir = path.dirname(smokeWorkspace.workspacePath);

    expect(fs.existsSync(smokeWorkspace.workspacePath)).toBe(true);
    smokeWorkspace.cleanup();
    expect(fs.existsSync(tempDir)).toBe(false);
  });
});
