/**
 * @packageDocumentation
 * Workspace package discovery for monorepo-aware module resolution.
 *
 * Scans pnpm-workspace.yaml / package.json workspaces to build a map
 * from package names to their source entry-point files.
 */

import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

/**
 * Discover all workspace packages and map each package name to the
 * absolute path of its source entry-point file.
 *
 * Discovery order:
 * 1. `pnpm-workspace.yaml`  (pnpm)
 * 2. root `package.json` `workspaces` field  (npm / yarn)
 *
 * Entry-point resolution per package:
 * 1. Derive source path from `exports["."]` or `main` (dist → src, .js → .ts)
 * 2. Fallback to `src/index.ts` next to the package.json
 *
 * @returns Map of package name → absolute source entry file path
 */
export function workspacePackageMapDiscover(
  rootDir: string,
): Map<string, string> {
  const result = new Map<string, string>();

  const patterns = workspacePatternsRead(rootDir);
  if (patterns.length === 0) return result;

  const pkgJsonGlobs = patterns.map(p => path.posix.join(p, 'package.json'));
  const pkgJsonPaths = fg.sync(pkgJsonGlobs, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
  });

  for (const pkgJsonPath of pkgJsonPaths) {
    try {
      const raw = fs.readFileSync(pkgJsonPath, 'utf8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const name = pkg.name;
      if (typeof name !== 'string') continue;

      const entryPoint = packageSourceEntryPoint(pkgJsonPath, pkg);
      if (entryPoint) {
        result.set(name, entryPoint);
      }
    } catch {
      // Skip unreadable / unparseable package.json files
      continue;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read workspace glob patterns from pnpm-workspace.yaml or package.json.
 */
function workspacePatternsRead(rootDir: string): string[] {
  // Try pnpm-workspace.yaml first
  const pnpmPath = path.join(rootDir, 'pnpm-workspace.yaml');
  try {
    const content = fs.readFileSync(pnpmPath, 'utf8');
    const patterns = pnpmWorkspacePatternsParse(content);
    if (patterns.length > 0) return patterns;
  } catch {
    // File not found — fall through
  }

  // Try package.json workspaces
  const pkgPath = path.join(rootDir, 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) {
      return ws.filter((p): p is string => typeof p === 'string');
    }
    // yarn-style { packages: [...] }
    if (ws && typeof ws === 'object' && 'packages' in ws) {
      const pkgs = (ws as Record<string, unknown>).packages;
      if (Array.isArray(pkgs)) {
        return pkgs.filter((p): p is string => typeof p === 'string');
      }
    }
  } catch {
    // File not found — fall through
  }

  return [];
}

/**
 * Parse pnpm-workspace.yaml to extract the `packages:` list.
 * Uses simple line-based parsing — no YAML library needed.
 */
function pnpmWorkspacePatternsParse(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (line === 'packages:') {
      inPackages = true;
      continue;
    }

    // Any non-list-item line after `packages:` ends the section
    if (inPackages) {
      if (line.startsWith('- ')) {
        // Strip `- `, surrounding quotes, and whitespace
        const value = line
          .slice(2)
          .trim()
          .replace(/^['"]|['"]$/g, '');
        if (value) patterns.push(value);
      } else if (line.length > 0 && !line.startsWith('#')) {
        break;
      }
    }
  }

  return patterns;
}

/**
 * Resolve a package.json's exports/main to a source entry-point file.
 *
 * Strategy:
 * 1. Read the dist entry from `exports["."]` or `main`
 * 2. Map dist path to source: `./dist/foo.js` → `./src/foo.ts`
 * 3. Fallback: `src/index.ts` next to the package.json
 */
function packageSourceEntryPoint(
  pkgJsonPath: string,
  pkg: Record<string, unknown>,
): string | undefined {
  const pkgDir = path.dirname(pkgJsonPath);

  // Extract the dist entry point string
  const distEntry = packageDistEntryPointRead(pkg);

  if (distEntry) {
    const sourcePath = distPathToSourcePath(distEntry);
    const full = path.resolve(pkgDir, sourcePath);
    if (fs.existsSync(full)) return full;
  }

  // Fallback: conventional src/index.ts
  const fallback = path.resolve(pkgDir, 'src/index.ts');
  if (fs.existsSync(fallback)) return fallback;

  return undefined;
}

/**
 * Extract the primary dist entry-point string from package.json
 * exports/main fields.
 */
function packageDistEntryPointRead(
  pkg: Record<string, unknown>,
): string | undefined {
  const exportsField = pkg.exports;

  if (exportsField && typeof exportsField === 'object') {
    const dot = (exportsField as Record<string, unknown>)['.'];

    if (typeof dot === 'string') return dot;

    if (dot && typeof dot === 'object') {
      const entry = dot as Record<string, unknown>;
      // Prefer: import > require > default > types
      for (const key of ['import', 'require', 'default', 'types']) {
        const val = entry[key];
        if (typeof val === 'string') return val;
      }
    }
  }

  if (typeof pkg.main === 'string') return pkg.main;
  if (typeof pkg.types === 'string') return pkg.types;

  return undefined;
}

/**
 * Map a dist path to a source path.
 * `./dist/index.js` → `./src/index.ts`
 */
function distPathToSourcePath(distPath: string): string {
  return distPath
    .replace(/^(\.\/)?dist\//, '$1src/')
    .replace(/\.d\.ts$/, '.ts')
    .replace(/\.js$/, '.ts')
    .replace(/\.cjs$/, '.ts')
    .replace(/\.mjs$/, '.ts');
}
