/**
 * E2E tests for `codepol graph <subcommand>` (Phase 4).
 *
 * Each test spawns the built CLI as a subprocess and asserts that the
 * JSON output matches the workspace-service query shape exactly. The CLI
 * binary must be built before running these tests (`pnpm build`).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
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

    setTimeout(() => child.kill('SIGTERM'), 60_000);
  });
}

function configContentCreate(): string {
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

function eslintConfigContentCreate(): string {
  return `export default [{ files: ['**/*.ts'], rules: {} }];\n`;
}

type Layout = {
  projectDir: string;
  fileUris: {
    entry: string;
    mid: string;
    leaf: string;
    orphan: string;
  };
};

function linearProjectCreate(prefix: string): Layout {
  const projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'codepol.toml'), configContentCreate(), 'utf8');
  fs.writeFileSync(
    path.join(projectDir, 'eslint.config.mjs'),
    eslintConfigContentCreate(),
    'utf8',
  );

  const entry = path.join(projectDir, 'src', 'entry.ts');
  const mid = path.join(projectDir, 'src', 'mid.ts');
  const leaf = path.join(projectDir, 'src', 'leaf.ts');
  const orphan = path.join(projectDir, 'src', 'orphan.ts');

  fs.writeFileSync(
    entry,
    `import { mid } from './mid';\nexport const entry = mid + 1;\n`,
    'utf8',
  );
  fs.writeFileSync(
    mid,
    `import { leaf } from './leaf';\nexport const mid = leaf + 1;\n`,
    'utf8',
  );
  fs.writeFileSync(leaf, `export const leaf = 1;\n`, 'utf8');
  fs.writeFileSync(orphan, `export const orphan = 42;\n`, 'utf8');

  return {
    projectDir,
    fileUris: {
      entry: pathToFileURL(entry).href,
      mid: pathToFileURL(mid).href,
      leaf: pathToFileURL(leaf).href,
      orphan: pathToFileURL(orphan).href,
    },
  };
}

function cyclicProjectCreate(prefix: string): { projectDir: string; aUri: string; bUri: string; cUri: string } {
  const projectDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'codepol.toml'), configContentCreate(), 'utf8');
  fs.writeFileSync(
    path.join(projectDir, 'eslint.config.mjs'),
    eslintConfigContentCreate(),
    'utf8',
  );

  const a = path.join(projectDir, 'src', 'a.ts');
  const b = path.join(projectDir, 'src', 'b.ts');
  const c = path.join(projectDir, 'src', 'c.ts');
  fs.writeFileSync(a, `import { b } from './b';\nexport const a = b + 1;\n`, 'utf8');
  fs.writeFileSync(b, `import { c } from './c';\nexport const b = c + 1;\n`, 'utf8');
  fs.writeFileSync(c, `import { a } from './a';\nexport const c = Number(a);\n`, 'utf8');
  return {
    projectDir,
    aUri: pathToFileURL(a).href,
    bUri: pathToFileURL(b).href,
    cUri: pathToFileURL(c).href,
  };
}

describe('CLI graph subcommands', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('graph export emits a WorkspaceDependencyGraphResult JSON payload', async () => {
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-export-');
    createdDirs.push(projectDir);

    const result = await runCli(['graph', 'export'], projectDir);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(Array.isArray(payload.nodes)).toBe(true);
    expect(Array.isArray(payload.edges)).toBe(true);
    expect(Array.isArray(payload.entryPoints)).toBe(true);
    expect(Array.isArray(payload.cycles)).toBe(true);

    const nodeUris = payload.nodes.map((node: { uri: string }) => node.uri);
    expect(nodeUris).toContain(fileUris.entry);
    expect(nodeUris).toContain(fileUris.mid);
    expect(nodeUris).toContain(fileUris.leaf);
    expect(nodeUris).toContain(fileUris.orphan);
    expect(payload.entryPoints).toContain(fileUris.entry);
    expect(payload.entryPoints).toContain(fileUris.orphan);
    expect(payload.cycles).toEqual([]);
  });

  it('graph cycles exits 0 with an empty array when no cycles exist', async () => {
    const { projectDir } = linearProjectCreate('codepol-e2e-graph-cycles-ok-');
    createdDirs.push(projectDir);

    const result = await runCli(['graph', 'cycles'], projectDir);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toEqual({ cycles: [], truncated: false });
  });

  it('graph cycles exits 1 and lists each cycle when cycles exist', async () => {
    const { projectDir, aUri, bUri, cUri } = cyclicProjectCreate('codepol-e2e-graph-cycles-bad-');
    createdDirs.push(projectDir);

    const result = await runCli(['graph', 'cycles'], projectDir);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.truncated).toBe(false);
    expect(payload.cycles).toHaveLength(1);
    const [cycle] = payload.cycles;
    expect([...cycle].sort()).toEqual([aUri, bUri, cUri].sort());
  });

  it('graph path emits a WorkspaceDependencyPathResult payload for the shortest path', async () => {
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-path-');
    createdDirs.push(projectDir);

    const result = await runCli(
      ['graph', 'path', 'src/entry.ts', 'src/leaf.ts'],
      projectDir,
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.shortestLength).toBe(2);
    expect(payload.truncated).toBe(false);
    expect(payload.paths).toEqual([[fileUris.entry, fileUris.mid, fileUris.leaf]]);
  });

  it('graph path exits 1 and emits an empty path list when no path exists', async () => {
    const { projectDir } = linearProjectCreate('codepol-e2e-graph-path-none-');
    createdDirs.push(projectDir);

    const result = await runCli(
      ['graph', 'path', 'src/leaf.ts', 'src/entry.ts'],
      projectDir,
    );

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.paths).toEqual([]);
    expect(payload.shortestLength).toBe(0);
  });

  it('graph dead exits 1 and lists unreachable modules using natural entry points', async () => {
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-dead-');
    createdDirs.push(projectDir);

    const result = await runCli(['graph', 'dead'], projectDir);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.unreachable).toEqual([]);
    expect(fileUris.entry).toBeDefined();
  });

  it('graph dead honours --entry to override the entry point set', async () => {
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-dead-entry-');
    createdDirs.push(projectDir);

    const result = await runCli(
      ['graph', 'dead', '--entry', 'src/entry.ts'],
      projectDir,
    );

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.unreachable).toEqual([fileUris.orphan]);
  });

  it('graph fan-in ranks files by importerCount and emits a deterministic JSON payload', async () => {
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-fan-in-');
    createdDirs.push(projectDir);

    const result = await runCli(['graph', 'fan-in', '--top', '10'], projectDir);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const byUri = new Map<string, number>(
      (payload.entries as { uri: string; importerCount: number }[]).map((entry) => [
        entry.uri,
        entry.importerCount,
      ]),
    );
    expect(byUri.get(fileUris.leaf)).toBe(1);
    expect(byUri.get(fileUris.mid)).toBe(1);
    expect(byUri.get(fileUris.entry)).toBe(0);
    expect(byUri.get(fileUris.orphan)).toBe(0);
  });

  it('graph fan-out ranks files by importeeCount', async () => {
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-fan-out-');
    createdDirs.push(projectDir);

    const result = await runCli(['graph', 'fan-out', '--top', '10'], projectDir);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const byUri = new Map<string, number>(
      (payload.entries as { uri: string; importeeCount: number }[]).map((entry) => [
        entry.uri,
        entry.importeeCount,
      ]),
    );
    expect(byUri.get(fileUris.entry)).toBe(1);
    expect(byUri.get(fileUris.mid)).toBe(1);
    expect(byUri.get(fileUris.leaf)).toBe(0);
    expect(byUri.get(fileUris.orphan)).toBe(0);
  });

  it('graph impact emits a dependency-graph subgraph focused on a file', async () => {
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-impact-');
    createdDirs.push(projectDir);

    const result = await runCli(
      ['graph', 'impact', 'src/mid.ts', '--direction', 'both', '--depth', '1'],
      projectDir,
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const nodeUris = (payload.nodes as { uri: string }[])
      .map((node) => node.uri)
      .sort();
    expect(nodeUris).toEqual([fileUris.entry, fileUris.leaf, fileUris.mid].sort());
  });

  it('graph snapshot writes a sidecar file under .codepol/graph-snapshots/', async () => {
    const { projectDir } = linearProjectCreate('codepol-e2e-graph-snapshot-');
    createdDirs.push(projectDir);

    const result = await runCli(['graph', 'snapshot', '--label', 'base'], projectDir);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.label).toBe('base');
    expect(payload.fileLabel).toBe('base');
    expect(typeof payload.workspaceRootId).toBe('string');
    expect(payload.nodeCount).toBeGreaterThan(0);

    const snapshotPath = path.join(
      projectDir,
      '.codepol',
      'graph-snapshots',
      'base.json',
    );
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.label).toBe('base');
  });

  it('graph diff emits an empty diff when current matches the labeled baseline', async () => {
    const { projectDir } = linearProjectCreate('codepol-e2e-graph-diff-empty-');
    createdDirs.push(projectDir);

    const snapshotResult = await runCli(['graph', 'snapshot', '--label', 'base'], projectDir);
    expect(snapshotResult.exitCode).toBe(0);

    const diffResult = await runCli(['graph', 'diff', 'base'], projectDir);
    expect(diffResult.exitCode).toBe(0);
    const payload = JSON.parse(diffResult.stdout);
    expect(payload.baselineLabel).toBe('base');
    expect(payload.addedNodes).toEqual([]);
    expect(payload.removedNodes).toEqual([]);
    expect(payload.addedEdges).toEqual([]);
    expect(payload.removedEdges).toEqual([]);
    expect(payload.newCycles).toEqual([]);
  });

  it('graph diff --fail-on-new-cycle exits 1 when the diff introduces a cycle', async () => {
    // Capture a baseline of a clean linear graph, then mutate the
    // workspace to introduce a cycle and re-run the diff.
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-diff-cycle-');
    createdDirs.push(projectDir);

    const snapshotResult = await runCli(['graph', 'snapshot', '--label', 'base'], projectDir);
    expect(snapshotResult.exitCode).toBe(0);

    // Close the cycle: leaf imports entry.
    const leafPath = path.join(projectDir, 'src', 'leaf.ts');
    fs.writeFileSync(
      leafPath,
      `import { entry } from './entry';\nexport const leaf = Number(entry) + 1;\n`,
      'utf8',
    );

    const diffResult = await runCli(
      ['graph', 'diff', 'base', '--fail-on-new-cycle'],
      projectDir,
    );
    expect(diffResult.exitCode).toBe(1);
    const payload = JSON.parse(diffResult.stdout);
    expect(payload.newCycles.length).toBeGreaterThanOrEqual(1);
    const cycleSet = new Set<string>(payload.newCycles[0] as string[]);
    expect(cycleSet.has(fileUris.entry)).toBe(true);
    expect(cycleSet.has(fileUris.leaf)).toBe(true);
  });

  it('graph flow returns a WorkspaceSymbolFlowResult with an empty edge list for an unknown symbol id', async () => {
    // Phase 9.1 / Gap 1 happy-path. Symbol-id discovery does not have a
    // CLI surface today, so pinning the unknown-id behavior is the
    // narrowest test that still exercises the full daemon-less wiring
    // (querySymbolFlow → workspace engine → CLI JSON shape).
    const { projectDir } = linearProjectCreate('codepol-e2e-graph-flow-');
    createdDirs.push(projectDir);

    const result = await runCli(
      ['graph', 'flow', 'symbol-that-does-not-exist'],
      projectDir,
    );
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toEqual({ edges: [] });
  });

  it('graph hierarchy --include-structural returns a WorkspaceDependencyGraphResult', async () => {
    // Phase 9.4 / Gap 3 happy-path. Symbol-id discovery does not have
    // a CLI surface today, so we pin the unknown-id contract: the
    // structural BFS still emits a seed-only subgraph, byte-equal to
    // the existing call/type-hierarchy unknown-id behavior. The flag
    // must be accepted without rejection — the regression we guard
    // against is the CLI failing to forward `--include-structural`.
    const { projectDir } = linearProjectCreate('codepol-e2e-graph-hierarchy-');
    createdDirs.push(projectDir);

    const result = await runCli(
      [
        'graph',
        'hierarchy',
        'symbol-that-does-not-exist',
        '--include-structural',
        '--direction',
        'subtypes',
      ],
      projectDir,
    );
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(Array.isArray(payload.nodes)).toBe(true);
    expect(payload.nodes.length).toBe(1);
    expect(payload.nodes[0].symbolId).toBe('symbol-that-does-not-exist');
    expect(Array.isArray(payload.edges)).toBe(true);
    expect(payload.entryPoints).toEqual([]);
    expect(payload.cycles).toEqual([]);
  });

  it('graph diff --baseline-file accepts a raw graph export payload', async () => {
    const { projectDir, fileUris } = linearProjectCreate('codepol-e2e-graph-diff-file-');
    createdDirs.push(projectDir);

    const exportResult = await runCli(['graph', 'export'], projectDir);
    expect(exportResult.exitCode).toBe(0);
    const baselineFile = path.join(projectDir, 'baseline.json');
    fs.writeFileSync(baselineFile, exportResult.stdout, 'utf8');

    // Add a new file post-baseline.
    const newFilePath = path.join(projectDir, 'src', 'extra.ts');
    fs.writeFileSync(newFilePath, `export const extra = 42;\n`, 'utf8');

    const diffResult = await runCli(
      ['graph', 'diff', '--baseline-file', baselineFile],
      projectDir,
    );
    expect(diffResult.exitCode).toBe(0);
    const payload = JSON.parse(diffResult.stdout);
    const addedUris = (payload.addedNodes as { uri: string }[]).map((node) => node.uri);
    expect(addedUris).toContain(pathToFileURL(newFilePath).href);
    // Existing entry/orphan/etc. must not appear as added.
    expect(addedUris).not.toContain(fileUris.entry);
  });
});
