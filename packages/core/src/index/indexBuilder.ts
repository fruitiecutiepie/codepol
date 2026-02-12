/**
 * @packageDocumentation
 * Index builder that orchestrates language adapters and builds the ProjectIndex.
 *
 * This module coordinates:
 * - File discovery and language detection
 * - Routing files to appropriate language adapters
 * - Aggregating results into the IndexStore
 * - Returning a ProjectIndex query interface
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Language } from 'web-tree-sitter';
import type { IndexCapabilities, ImportBindingRelation, ReferencesRelation } from './indexTypes';
import { IndexStore, indexStoreNew } from './indexStore';
import { projectIndexCreate, type ProjectIndex } from './indexQuery';
import type { LangConfig, IndexAdapter } from '../adapters/treeSitter/adapterTypes';
import { indexAdapterCreate } from '../adapters/treeSitter/adapterCore';
import { typescriptConfigCreate } from '../adapters/treeSitter/languages/typescript/config';
import { pythonConfigCreate } from '../adapters/treeSitter/languages/python/config';
import { langGetForFile } from '../parser/parserLangs';
import { moduleResolve, DEFAULT_EXTENSIONS, type ModuleResolveOptions } from './moduleResolver';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for building a project index.
 */
export type IndexBuildOptions = {
  /** Files to index (absolute paths) */
  files: string[];
  /** Working directory for relative paths */
  dir: string;
  /** Filter to specific languages (optional) */
  languages?: string[];
  /** Existing index store to update (optional, creates new if not provided) */
  store?: IndexStore;
  /** Enable cross-file symbol resolution (default: true) */
  crossFileResolution?: boolean;
  /** Path aliases for module resolution (e.g., from tsconfig) */
  pathAliases?: Record<string, string[]>;
};

/**
 * Result of building a project index.
 */
export type IndexBuildResult = {
  /** The project index query interface */
  index: ProjectIndex;
  /** Statistics about the build */
  stats: {
    filesIndexed: number;
    filesSkipped: number;
    errors: string[];
  };
};

// ============================================================================
// Adapter Registry
// ============================================================================

/**
 * Registry of language adapters.
 * Maps language ID to adapter factory.
 */
type AdapterFactory = (language: Language) => IndexAdapter;

const adapterFactories = new Map<string, AdapterFactory>();

/**
 * Register an adapter factory for a language.
 */
export function adapterRegister(languageId: string, factory: AdapterFactory): void {
  adapterFactories.set(languageId, factory);
}

/**
 * Get an adapter for a language.
 */
function adapterGet(languageId: string, language: Language): IndexAdapter | undefined {
  const factory = adapterFactories.get(languageId);
  if (!factory) return undefined;
  return factory(language);
}

// Register built-in adapters
adapterRegister('typescript', (lang) => indexAdapterCreate(typescriptConfigCreate(lang)));
adapterRegister('tsx', (lang) => indexAdapterCreate(typescriptConfigCreate(lang)));
adapterRegister('python', (lang) => indexAdapterCreate(pythonConfigCreate(lang)));

// ============================================================================
// Revision Computation
// ============================================================================

/**
 * Compute a revision identifier for file content.
 * Uses SHA-256 hash truncated to 16 hex characters.
 */
function revisionCompute(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ============================================================================
// Index Builder
// ============================================================================

/**
 * Internal implementation of index building.
 * Used by both sync and async variants.
 */
function projectIndexBuildImpl(options: IndexBuildOptions): IndexBuildResult {
  const store = options.store ?? indexStoreNew();
  const stats = {
    filesIndexed: 0,
    filesSkipped: 0,
    errors: [] as string[],
  };

  const supportedLanguages = new Set<string>();

  for (const file of options.files) {
    try {
      // Get language for file
      const language = langGetForFile(file);
      if (!language) {
        stats.filesSkipped++;
        continue;
      }

      // Detect language ID from file extension
      const languageId = languageIdFromFile(file);
      if (!languageId) {
        stats.filesSkipped++;
        continue;
      }

      // Filter by requested languages
      if (options.languages && options.languages.length > 0) {
        if (!options.languages.includes(languageId)) {
          stats.filesSkipped++;
          continue;
        }
      }

      // Get adapter for language
      const adapter = adapterGet(languageId, language);
      if (!adapter) {
        stats.filesSkipped++;
        continue;
      }

      // Read file content
      const content = fs.readFileSync(file);
      const bytes = new Uint8Array(content);
      const revision = revisionCompute(bytes);

      // Check if already indexed with same revision
      if (store.fileHasRevision(file, revision)) {
        stats.filesSkipped++;
        continue;
      }

      // Index file
      const delta = adapter.indexFile(file, bytes, revision);
      store.filePut(delta);
      
      supportedLanguages.add(languageId);
      stats.filesIndexed++;
    } catch (error) {
      stats.errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Perform cross-file resolution if enabled (default: true)
  const doCrossFileResolution = options.crossFileResolution !== false;
  if (doCrossFileResolution) {
    crossFileResolve(store, {
      baseDir: options.dir,
      extensions: DEFAULT_EXTENSIONS,
      pathAliases: options.pathAliases,
    });
  }

  // Build capabilities
  const capabilities: IndexCapabilities = {
    crossFileResolution: doCrossFileResolution,
    callGraph: 'heuristic',
    supportedLanguages: Array.from(supportedLanguages),
  };

  // Create and return ProjectIndex
  const index = projectIndexCreate(store, capabilities);

  return { index, stats };
}

/**
 * Build a project index from a list of files (async version).
 *
 * @param options - Build options
 * @returns IndexBuildResult with the ProjectIndex and statistics
 */
export async function projectIndexBuild(options: IndexBuildOptions): Promise<IndexBuildResult> {
  return projectIndexBuildImpl(options);
}

/**
 * Build a project index from a list of files (sync version).
 *
 * Use this when you need synchronous index building, such as in ESLint rules
 * where async operations are not supported.
 *
 * @param options - Build options
 * @returns IndexBuildResult with the ProjectIndex and statistics
 */
export function projectIndexBuildSync(options: IndexBuildOptions): IndexBuildResult {
  return projectIndexBuildImpl(options);
}

/**
 * Detect language ID from file path.
 */
function languageIdFromFile(filePath: string): string | undefined {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  
  switch (ext) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'typescript'; // Use TS parser for JS too
    case '.jsx':
      return 'tsx'; // Use TSX parser for JSX
    case '.py':
    case '.pyw':
      return 'python';
    default:
      return undefined;
  }
}

// ============================================================================
// Incremental Update
// ============================================================================

/**
 * Update the index for specific files.
 * Only re-indexes files that have changed (different revision).
 *
 * @param index - Existing ProjectIndex (must be backed by IndexStore)
 * @param files - Files to update
 * @param store - The IndexStore backing the index
 */
export async function projectIndexUpdate(
  store: IndexStore,
  files: string[]
): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const result = { updated: 0, skipped: 0, errors: [] as string[] };

  for (const file of files) {
    try {
      // Get language for file
      const language = langGetForFile(file);
      if (!language) {
        result.skipped++;
        continue;
      }

      const languageId = languageIdFromFile(file);
      if (!languageId) {
        result.skipped++;
        continue;
      }

      const adapter = adapterGet(languageId, language);
      if (!adapter) {
        result.skipped++;
        continue;
      }

      // Read and check revision
      const content = fs.readFileSync(file);
      const bytes = new Uint8Array(content);
      const revision = revisionCompute(bytes);

      if (store.fileHasRevision(file, revision)) {
        result.skipped++;
        continue;
      }

      // Re-index
      const delta = adapter.indexFile(file, bytes, revision);
      store.filePut(delta);
      result.updated++;
    } catch (error) {
      result.errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

/**
 * Remove files from the index.
 */
export function projectIndexRemoveFiles(store: IndexStore, files: string[]): void {
  for (const file of files) {
    store.fileRemove(file);
  }
}

/**
 * Update a single file in the index (synchronous).
 * Returns true if the file was updated (content changed), false if unchanged.
 *
 * @param store - The IndexStore to update
 * @param file - Absolute path to the file
 * @returns true if file was re-indexed, false if unchanged
 */
export function projectIndexUpdateFileSync(
  store: IndexStore,
  file: string
): boolean {
  try {
    // Get language for file
    const language = langGetForFile(file);
    if (!language) {
      return false;
    }

    const languageId = languageIdFromFile(file);
    if (!languageId) {
      return false;
    }

    const adapter = adapterGet(languageId, language);
    if (!adapter) {
      return false;
    }

    // Read and check revision
    const content = fs.readFileSync(file);
    const bytes = new Uint8Array(content);
    const revision = revisionCompute(bytes);

    if (store.fileHasRevision(file, revision)) {
      return false; // Unchanged
    }

    // Re-index the file
    const delta = adapter.indexFile(file, bytes, revision);
    store.filePut(delta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update a single file in the index using provided source content.
 * This avoids reading from disk, which is important when the in-memory
 * source (e.g., from ESLint) may differ from what's on disk.
 *
 * @param store - The IndexStore to update
 * @param file - Absolute path to the file
 * @param source - The source content to index
 * @returns true if file was re-indexed, false if unchanged
 */
export function projectIndexUpdateFileFromSource(
  store: IndexStore,
  file: string,
  source: string
): boolean {
  try {
    // Get language for file
    const language = langGetForFile(file);
    if (!language) {
      return false;
    }

    const languageId = languageIdFromFile(file);
    if (!languageId) {
      return false;
    }

    const adapter = adapterGet(languageId, language);
    if (!adapter) {
      return false;
    }

    // Convert source to bytes and compute revision
    const bytes = new TextEncoder().encode(source);
    const revision = revisionCompute(bytes);

    if (store.fileHasRevision(file, revision)) {
      return false; // Unchanged
    }

    // Re-index the file using provided source
    const delta = adapter.indexFile(file, bytes, revision);
    store.filePut(delta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-resolve cross-file imports/exports for a single file.
 * Call this after updating a file to update its import bindings.
 *
 * @param store - The IndexStore
 * @param file - The file that was updated
 * @param resolveOptions - Module resolution options
 */
export function crossFileResolveForFile(
  store: IndexStore,
  file: string,
  resolveOptions: ModuleResolveOptions
): void {
  // Build export map for resolution
  const exportMap = store.exportMapBuild();
  const indexedFiles = new Set(store.filesGet());

  // Re-resolve import bindings FROM this file
  const bindings = store.importBindingsInFileGet(file);
  
  for (const binding of bindings) {
    const localSymbol = store.symbolGet(binding.localSymbolId);
    if (!localSymbol) continue;

    const fromFile = localSymbol.file;

    // Resolve the module specifier to a file path
    const resolvedPath = moduleResolve(binding.moduleSpec, fromFile, {
      ...resolveOptions,
      indexedFiles,
    });

    if (!resolvedPath || !indexedFiles.has(resolvedPath)) {
      continue;
    }

    // Look up the export in the resolved file
    const fileExports = exportMap.get(resolvedPath);
    if (!fileExports) continue;

    let resolvedExportId: string | undefined;

    if (binding.isDefault) {
      resolvedExportId = fileExports.get('default');
    } else if (binding.isNamespace) {
      continue;
    } else {
      resolvedExportId = fileExports.get(binding.importedName);
    }

    if (resolvedExportId) {
      const updatedBinding: ImportBindingRelation = {
        ...binding,
        resolvedModulePath: resolvedPath,
        resolvedExportId,
      };
      store.relationUpdate(binding, updatedBinding);
    }
  }

  // Re-resolve import bindings TO this file (from other files)
  // This handles the case where this file's exports changed
  for (const otherFile of indexedFiles) {
    if (otherFile === file) continue;

    const otherBindings = store.importBindingsInFileGet(otherFile);
    for (const binding of otherBindings) {
      // Check if this binding points to our file
      const localSymbol = store.symbolGet(binding.localSymbolId);
      if (!localSymbol) continue;

      const resolvedPath = moduleResolve(binding.moduleSpec, localSymbol.file, {
        ...resolveOptions,
        indexedFiles,
      });

      if (resolvedPath !== file) continue;

      // Re-resolve this binding
      const fileExports = exportMap.get(file);
      if (!fileExports) {
        // File no longer exports anything - clear resolution
        if (binding.resolvedExportId) {
          const updatedBinding: ImportBindingRelation = {
            ...binding,
            resolvedModulePath: undefined,
            resolvedExportId: undefined,
          };
          store.relationUpdate(binding, updatedBinding);
        }
        continue;
      }

      let resolvedExportId: string | undefined;

      if (binding.isDefault) {
        resolvedExportId = fileExports.get('default');
      } else if (binding.isNamespace) {
        continue;
      } else {
        resolvedExportId = fileExports.get(binding.importedName);
      }

      // Update binding (even if resolvedExportId is undefined - export may have been removed)
      const updatedBinding: ImportBindingRelation = {
        ...binding,
        resolvedModulePath: resolvedExportId ? file : undefined,
        resolvedExportId,
      };
      store.relationUpdate(binding, updatedBinding);
    }
  }
}

// ============================================================================
// Cross-File Resolution
// ============================================================================

/**
 * Resolve cross-file symbols after all files are indexed.
 * This function:
 * 1. Builds an export map from all indexed files
 * 2. Resolves ImportBinding relations to their source exports
 * 3. Updates References relations that refer to imported symbols
 */
function crossFileResolve(
  store: IndexStore,
  resolveOptions: ModuleResolveOptions
): void {
  // Step 1: Build export map - Map<filePath, Map<exportedName, SymbolId>>
  const exportMap = store.exportMapBuild();
  
  // Build a set of indexed files for validation
  const indexedFiles = new Set(store.filesGet());

  // Step 2: Resolve each ImportBinding relation
  const importBindings = store.importBindingsGet();
  
  for (const binding of importBindings) {
    // Get the file that contains this import
    const localSymbol = store.symbolGet(binding.localSymbolId);
    if (!localSymbol) continue;

    const fromFile = localSymbol.file;

    // Resolve the module specifier to a file path
    const resolvedPath = moduleResolve(binding.moduleSpec, fromFile, {
      ...resolveOptions,
      indexedFiles,
    });

    if (!resolvedPath || !indexedFiles.has(resolvedPath)) {
      // External module or unresolved - skip
      continue;
    }

    // Look up the export in the resolved file
    const fileExports = exportMap.get(resolvedPath);
    if (!fileExports) continue;

    let resolvedExportId: string | undefined;

    if (binding.isDefault) {
      // Default import: look for 'default' export
      resolvedExportId = fileExports.get('default');
    } else if (binding.isNamespace) {
      // Namespace import: we could create a synthetic symbol, but for now skip
      // The namespace itself doesn't resolve to a single symbol
      continue;
    } else {
      // Named import: look for the specific exported name
      resolvedExportId = fileExports.get(binding.importedName);
    }

    if (resolvedExportId) {
      // Update the ImportBinding with the resolved information
      const updatedBinding: ImportBindingRelation = {
        ...binding,
        resolvedModulePath: resolvedPath,
        resolvedExportId,
      };
      store.relationUpdate(binding, updatedBinding);
    }
  }

  // Step 3: Update References that use imported symbols
  // Build a map of local import symbol IDs to their resolved export IDs
  const importResolutionMap = new Map<string, string>();
  for (const binding of store.importBindingsGet()) {
    if (binding.resolvedExportId) {
      importResolutionMap.set(binding.localSymbolId, binding.resolvedExportId);
    }
  }

  // For each file, check references that resolved to import bindings
  for (const file of indexedFiles) {
    const refs = store.referencesInFileGet(file);
    
    for (const ref of refs) {
      // If this reference resolved to an import binding, update it
      if (ref.resolvedSymbolId && importResolutionMap.has(ref.resolvedSymbolId)) {
        const actualSymbolId = importResolutionMap.get(ref.resolvedSymbolId);
        if (actualSymbolId && actualSymbolId !== ref.resolvedSymbolId) {
          // Update the reference to point to the actual exported symbol
          const updatedRef: ReferencesRelation = {
            ...ref,
            resolvedSymbolId: actualSymbolId,
          };
          store.relationUpdate(ref, updatedRef);
        }
      }
    }
  }
}
