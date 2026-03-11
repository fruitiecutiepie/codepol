/**
 * @packageDocumentation
 * Module path resolution for cross-file symbol resolution.
 *
 * Resolves import specifiers (e.g., './utils', 'lodash') to absolute file paths.
 * Supports:
 * - Relative imports (./foo, ../bar)
 * - Extension resolution (.ts, .tsx, .js, etc.)
 * - Index file resolution (./foo -> ./foo/index.ts)
 * - Path aliases (tsconfig paths) - optional
 */

import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for module resolution.
 */
export type ModuleResolveOptions = {
  /** Base directory for resolving paths */
  baseDir: string;
  /** File extensions to try (in order) */
  extensions: string[];
  /** Path aliases from tsconfig.json (optional) */
  pathAliases?: Record<string, string[]>;
  /** Set of indexed file paths for validation */
  indexedFiles?: Set<string>;
  /** Workspace package name → source entry file (from package.json) */
  workspacePackages?: Map<string, string>;
};

/**
 * Default extensions to try when resolving modules.
 */
export const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
];

/**
 * Default index file names.
 */
const INDEX_FILES = ['index'];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a specifier is a relative import.
 */
export function isRelativeImport(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * Check if a specifier is likely an external package.
 * External packages don't start with ./ or ../ and aren't absolute paths.
 */
export function isExternalPackage(specifier: string): boolean {
  if (isRelativeImport(specifier)) return false;
  if (path.isAbsolute(specifier)) return false;
  // Scoped packages like @org/package
  if (specifier.startsWith('@')) return true;
  // Regular packages
  return !specifier.includes('/') || !specifier.startsWith('/');
}

/**
 * Check if a file exists.
 */
function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory.
 */
function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Try to resolve a file with various extensions.
 */
function tryResolveWithExtensions(
  basePath: string,
  extensions: string[]
): string | undefined {
  // First, try the exact path
  if (fileExists(basePath)) {
    return basePath;
  }

  // Then try with each extension
  for (const ext of extensions) {
    const withExt = basePath + ext;
    if (fileExists(withExt)) {
      return withExt;
    }
  }

  return undefined;
}

/**
 * Try to resolve an index file in a directory.
 */
function tryResolveIndex(
  dirPath: string,
  extensions: string[]
): string | undefined {
  if (!isDirectory(dirPath)) {
    return undefined;
  }

  for (const indexName of INDEX_FILES) {
    const indexBase = path.join(dirPath, indexName);
    const resolved = tryResolveWithExtensions(indexBase, extensions);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

// ============================================================================
// Main Resolution Function
// ============================================================================

/**
 * Resolve a module specifier to an absolute file path.
 *
 * Resolution strategy:
 * 1. For relative imports: resolve relative to the importing file
 * 2. Try exact path, then with extensions, then as directory with index
 * 3. For path aliases: expand alias and resolve
 * 4. For external packages: return undefined
 *
 * @param specifier - The import specifier (e.g., './utils', 'lodash')
 * @param fromFile - Absolute path of the importing file
 * @param options - Resolution options
 * @returns Absolute file path if resolved, undefined otherwise
 */
export function moduleResolve(
  specifier: string,
  fromFile: string,
  options: ModuleResolveOptions
): string | undefined {
  // Workspace packages resolve to their source entry file
  if (options.workspacePackages) {
    const wsEntry = options.workspacePackages.get(specifier);
    if (wsEntry) return wsEntry;
  }

  // Python files use a different resolution strategy
  if (fromFile.endsWith('.py')) {
    return pythonModuleResolve(specifier, fromFile, options);
  }

  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;

  // External packages can't be resolved to local files
  if (isExternalPackage(specifier)) {
    return undefined;
  }

  // Handle relative imports
  if (isRelativeImport(specifier)) {
    const fromDir = path.dirname(fromFile);
    const targetPath = path.resolve(fromDir, specifier);

    // Try as file (with extensions)
    const asFile = tryResolveWithExtensions(targetPath, extensions);
    if (asFile) {
      return asFile;
    }

    // Try as directory (with index file)
    const asDir = tryResolveIndex(targetPath, extensions);
    if (asDir) {
      return asDir;
    }

    return undefined;
  }

  // Handle path aliases (if provided)
  if (options.pathAliases) {
    for (const [alias, targets] of Object.entries(options.pathAliases)) {
      // Handle wildcard aliases like "@/*" -> ["src/*"]
      if (alias.endsWith('/*') && specifier.startsWith(alias.slice(0, -1))) {
        const suffix = specifier.slice(alias.length - 1);
        for (const target of targets) {
          const targetBase = target.endsWith('/*')
            ? target.slice(0, -1)
            : target;
          const fullPath = path.resolve(options.baseDir, targetBase + suffix);

          const asFile = tryResolveWithExtensions(fullPath, extensions);
          if (asFile) return asFile;

          const asDir = tryResolveIndex(fullPath, extensions);
          if (asDir) return asDir;
        }
      }
      // Handle exact aliases like "utils" -> ["src/utils"]
      else if (specifier === alias || specifier.startsWith(alias + '/')) {
        const suffix = specifier.slice(alias.length);
        for (const target of targets) {
          const fullPath = path.resolve(options.baseDir, target + suffix);

          const asFile = tryResolveWithExtensions(fullPath, extensions);
          if (asFile) return asFile;

          const asDir = tryResolveIndex(fullPath, extensions);
          if (asDir) return asDir;
        }
      }
    }
  }

  // Absolute path (rare, but handle it)
  if (path.isAbsolute(specifier)) {
    const asFile = tryResolveWithExtensions(specifier, extensions);
    if (asFile) return asFile;

    const asDir = tryResolveIndex(specifier, extensions);
    if (asDir) return asDir;
  }

  return undefined;
}

// ============================================================================
// Python Module Resolution
// ============================================================================

/**
 * Check if a Python import specifier is relative (starts with dots).
 * Python uses `.` for current package and `..` for parent, etc.
 */
export function isPythonRelativeImport(specifier: string): boolean {
  return specifier.startsWith('.');
}

/**
 * Try to resolve a Python module path — checks `path.py` then `path/__init__.py`.
 */
function tryResolvePythonModule(basePath: string): string | undefined {
  const asPy = basePath + '.py';
  if (fileExists(asPy)) return asPy;

  const asInit = path.join(basePath, '__init__.py');
  if (fileExists(asInit)) return asInit;

  return undefined;
}

/**
 * Resolve a Python submodule path given a package's `__init__.py` and a
 * submodule name.  Used as a fallback when `from package import name` doesn't
 * find `name` in the package's export map — `name` might be a child module
 * file (`package/name.py`) or sub-package (`package/name/__init__.py`).
 */
export function pythonSubmoduleResolve(
  packageInitPath: string,
  submoduleName: string
): string | undefined {
  const packageDir = path.dirname(packageInitPath);
  return tryResolvePythonModule(path.join(packageDir, submoduleName));
}

/**
 * Resolve a Python import specifier to an absolute file path.
 *
 * Handles:
 * - Relative imports: `.foo` (sibling), `..foo` (parent), `.` (package __init__)
 * - Absolute imports: `mypkg.sub` resolved relative to project baseDir
 * - Extension-free specifiers with `.py` and `__init__.py` resolution
 */
function pythonModuleResolve(
  specifier: string,
  fromFile: string,
  options: ModuleResolveOptions
): string | undefined {
  if (isPythonRelativeImport(specifier)) {
    // Count leading dots to determine traversal depth
    let dotCount = 0;
    while (dotCount < specifier.length && specifier[dotCount] === '.') {
      dotCount++;
    }
    const rest = specifier.slice(dotCount);

    // Each dot means one directory up from the current file's directory.
    // `.foo`  → same directory, resolve `foo`
    // `..foo` → one directory up, resolve `foo`
    // `.`     → same directory, resolve `__init__.py`
    let baseDir = path.dirname(fromFile);
    for (let i = 1; i < dotCount; i++) {
      baseDir = path.dirname(baseDir);
    }

    if (!rest) {
      // Bare relative: `from . import foo` — specifier is just dots,
      // the actual binding comes from the import query, not the specifier.
      // Resolve to the package's __init__.py.
      const initPath = path.join(baseDir, '__init__.py');
      if (fileExists(initPath)) return initPath;
      return undefined;
    }

    // Convert dotted module path to filesystem path: `foo.bar` → `foo/bar`
    const modulePath = rest.replace(/\./g, '/');
    const targetPath = path.join(baseDir, modulePath);
    return tryResolvePythonModule(targetPath);
  }

  // Absolute (non-relative) import — resolve relative to baseDir
  // Converts dotted path: `mypkg.sub` → `mypkg/sub`
  const modulePath = specifier.replace(/\./g, '/');
  const targetPath = path.resolve(options.baseDir, modulePath);
  return tryResolvePythonModule(targetPath);
}
