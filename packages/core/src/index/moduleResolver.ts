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
export const INDEX_FILES = ['index'];

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
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;

  // Workspace packages resolve to their source entry file
  if (options.workspacePackages) {
    const wsEntry = options.workspacePackages.get(specifier);
    if (wsEntry) return wsEntry;
  }

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

/**
 * Normalize a resolved path to match indexed file paths.
 * Ensures consistent path separators and casing.
 */
export function normalizeModulePath(filePath: string): string {
  // Use forward slashes consistently
  return filePath.replace(/\\/g, '/');
}

/**
 * Get the module name from a file path (without extension).
 * Used for matching imports to files.
 */
export function moduleNameFromPath(filePath: string): string {
  const basename = path.basename(filePath);
  const ext = path.extname(basename);
  return basename.slice(0, -ext.length);
}
