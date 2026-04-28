/**
 * Workspace runtime initialization.
 *
 * Builtin plugins (`@codepol/plugin`, `@codepol/plugin-vulture`) are loaded from each
 * package’s published entry (`package.json` `main` / `exports` → `dist/…`). Editing `src`
 * still requires rebuilding that package; {@link builtinPluginsRefresh} picks up rebuilt
 * `dist` on the next analysis without restarting the process.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pluginBuiltinModule from '@codepol/plugin';
import * as pluginVultureModule from '@codepol/plugin-vulture';
import {
  langAdd,
  parserInit,
  parserRuntimeIsReady,
  pluginModuleRegister,
} from '@codepol/core';

/** Resolved at runtime from compiled `dist/runtime.js` (CommonJS). */
const nodeRequire = createRequire(path.join(__dirname, 'runtime.js'));
const runtimeBundled = process.env.CODEPOL_BUNDLED_RUNTIME === '1';

/**
 * Builtin rule packages registered into `@codepol/core` for `source = { kind = "builtin" }`.
 */
const BUILTIN_PLUGIN_PACKAGES = ['@codepol/plugin', '@codepol/plugin-vulture'] as const;
const BUILTIN_PLUGIN_BUNDLED_MODULES: Record<(typeof BUILTIN_PLUGIN_PACKAGES)[number], unknown> = {
  '@codepol/plugin': pluginBuiltinModule,
  '@codepol/plugin-vulture': pluginVultureModule,
};

let runtimeInitPromise: Promise<void> | undefined;
let runtimeInitCompleted = false;

type CoreRuntimeApi = {
  langAdd: typeof langAdd;
  parserInit: typeof parserInit;
  parserRuntimeIsReady: typeof parserRuntimeIsReady;
};

function runtimeCoreModulesGet(): CoreRuntimeApi[] {
  const runtimes: CoreRuntimeApi[] = [{ langAdd, parserInit, parserRuntimeIsReady }];
  try {
    const runtimePkg = nodeRequire('@codepol/core') as Partial<CoreRuntimeApi>;
    if (
      typeof runtimePkg.langAdd === 'function' &&
      typeof runtimePkg.parserInit === 'function' &&
      typeof runtimePkg.parserRuntimeIsReady === 'function' &&
      runtimePkg.langAdd !== langAdd
    ) {
      runtimes.push({
        langAdd: runtimePkg.langAdd,
        parserInit: runtimePkg.parserInit,
        parserRuntimeIsReady: runtimePkg.parserRuntimeIsReady,
      });
    }
  } catch {
    // Source-mode tests may not have a second published install to load.
  }
  return runtimes;
}

function runtimeParsersReady(runtimes: CoreRuntimeApi[]): boolean {
  return runtimes.every((runtime) => runtime.parserRuntimeIsReady());
}

async function runtimeParsersInit(runtimes: CoreRuntimeApi[]): Promise<void> {
  await Promise.all(runtimes.map((runtime) => runtime.parserInit()));
}

async function runtimeLanguageSupportEnsure(): Promise<void> {
  const runtimes = runtimeCoreModulesGet();
  for (const runtime of runtimes) {
    runtime.langAdd({ langId: 'typescript', fileExtensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'] });
    runtime.langAdd({ langId: 'tsx', fileExtensions: ['.tsx', '.jsx'] });
    runtime.langAdd({ langId: 'python', fileExtensions: ['.py', '.pyw'] });
  }
  await runtimeParsersInit(runtimes);
  if (runtimeParsersReady(runtimes)) {
    return;
  }
  await runtimeParsersInit(runtimes);
  if (!runtimeParsersReady(runtimes)) {
    throw new Error('Codepol parser runtime was invalidated during initialization.');
  }
}

/**
 * Finds the package root directory for a workspace dependency. We cannot use
 * `require.resolve(pkgName + '/package.json')` because `package.json` is often not listed
 * in `exports`.
 */
function packageRootFindFromEntry(moduleEntryPath: string, expectedName: string): string {
  let dir = path.dirname(moduleEntryPath);
  while (true) {
    const pkgJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const raw = fs.readFileSync(pkgJsonPath, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name === expectedName) {
          return dir;
        }
      } catch {
        // ignore invalid JSON
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find package root for ${expectedName}`);
    }
    dir = parent;
  }
}

function packageCacheInvalidateUnderRoot(rootAbs: string): void {
  const root = path.resolve(rootAbs);
  const prefix = root + path.sep;
  for (const cachePath of Object.keys(nodeRequire.cache)) {
    if (!cachePath) {
      continue;
    }
    const resolved = path.resolve(cachePath);
    if (resolved === root || resolved.startsWith(prefix)) {
      delete nodeRequire.cache[cachePath];
    }
  }
}

function packageFilesCollect(rootAbs: string): string[] {
  const entries = fs.readdirSync(rootAbs, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(rootAbs, entry.name);
    if (entry.isDirectory()) {
      files.push(...packageFilesCollect(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function pluginRuleExportsNormalize(moduleExports: unknown): unknown {
  if (Array.isArray(moduleExports)) {
    return moduleExports;
  }
  if (moduleExports && typeof moduleExports === 'object') {
    const obj = moduleExports as Record<string, unknown>;
    if (Array.isArray(obj.default) || Array.isArray(obj.pluginRules)) {
      return moduleExports;
    }

    const namedRules = Object.values(obj).filter((value) => {
      return (
        value &&
        typeof value === 'object' &&
        'id' in value &&
        'capabilities' in value
      );
    });
    if (namedRules.length > 0) {
      return namedRules;
    }
  }
  return moduleExports;
}

function builtinPluginModuleLoad(
  pkgName: (typeof BUILTIN_PLUGIN_PACKAGES)[number],
): { default?: unknown } | unknown {
  if (!runtimeBundled) {
    try {
      return nodeRequire(pkgName) as { default?: unknown };
    } catch {
      // Fall back to bundled modules when package resolution is unavailable.
    }
  }
  return BUILTIN_PLUGIN_BUNDLED_MODULES[pkgName];
}

/**
 * Clears Node’s `require` cache for each builtin plugin package and re-registers rules in
 * core. Call before `policyPluginsGet` so long-lived processes see rebuilt package output.
 */
export function builtinPluginsRefresh(): void {
  const roots: string[] = [];
  if (!runtimeBundled) {
    for (const pkgName of BUILTIN_PLUGIN_PACKAGES) {
      const entry = nodeRequire.resolve(pkgName);
      roots.push(packageRootFindFromEntry(entry, pkgName));
    }
  }
  for (const root of roots) {
    packageCacheInvalidateUnderRoot(root);
  }
  for (const pkgName of BUILTIN_PLUGIN_PACKAGES) {
    const mod = builtinPluginModuleLoad(pkgName) as { default?: unknown };
    const exported = pluginRuleExportsNormalize(mod.default ?? mod);
    pluginModuleRegister(pkgName, exported);
  }
}

export function builtinPluginArtifactPathsResolve(moduleSpecifier: string): string[] {
  if (runtimeBundled) {
    const candidates = [
      path.resolve(__filename),
      path.resolve(__dirname, 'tree-sitter.wasm'),
      path.resolve(__dirname, 'tree-sitter-python.wasm'),
      path.resolve(__dirname, 'tree-sitter-tsx.wasm'),
      path.resolve(__dirname, 'tree-sitter-typescript.wasm'),
    ];
    return [...new Set(candidates)]
      .filter((candidate) => {
        try {
          return fs.statSync(candidate).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  }
  try {
    const entry = nodeRequire.resolve(moduleSpecifier);
    const root = packageRootFindFromEntry(entry, moduleSpecifier);
    const distDir = path.join(root, 'dist');
    const candidates = [
      path.join(root, 'package.json'),
      ...(fs.existsSync(distDir) ? packageFilesCollect(distDir) : [entry]),
    ];
    return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
      .filter((candidate) => {
        try {
          return fs.statSync(candidate).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

export function ensureWorkspaceRuntimeReady(): Promise<void> {
  const runtimes = runtimeCoreModulesGet();
  const parserRuntimeReady = runtimeParsersReady(runtimes);
  if (runtimeInitPromise && (!runtimeInitCompleted || parserRuntimeReady)) {
    return runtimeInitPromise;
  }

  runtimeInitCompleted = false;
  runtimeInitPromise = runtimeLanguageSupportEnsure()
    .then(() => {
      runtimeInitCompleted = true;
    })
    .catch((error) => {
      runtimeInitPromise = undefined;
      runtimeInitCompleted = false;
      throw error;
    });
  return runtimeInitPromise;
}
