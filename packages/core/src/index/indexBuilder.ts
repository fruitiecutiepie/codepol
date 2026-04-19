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
import { createHash } from 'node:crypto';
import type { Language } from 'web-tree-sitter';
import type { CallsRelation, IndexCapabilities, ImportsRelation, ImportBindingRelation, ReferencesRelation, TypeRelation, SymbolId } from './indexTypes';
import { IndexStore, indexStoreNew } from './indexStore';
import { projectIndexCreate, type ProjectIndex } from './indexQuery';
import type { IndexAdapter } from '../adapters/treeSitter/adapterTypes';
import { indexAdapterCreate } from '../adapters/treeSitter/adapterCore';
import { typescriptConfigCreate } from '../adapters/treeSitter/languages/typescript/config';
import { pythonConfigCreate } from '../adapters/treeSitter/languages/python/config';
import { langGetForFile, langIdGetForFile } from '../parser/parserLangs';
import { moduleResolve, pythonSubmoduleResolve, DEFAULT_EXTENSIONS, type ModuleResolveOptions } from './moduleResolver';

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
  /** Workspace package name → source entry file (from package.json) */
  workspacePackages?: Map<string, string>;
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
      workspacePackages: options.workspacePackages,
    });
  }

  // Build capabilities
  const capabilities: IndexCapabilities = {
    crossFileResolution: doCrossFileResolution,
    callGraph: 'heuristic',
    controlFlowGraph: true,
    symbolFlow: indexCapabilitiesSymbolFlowCompute(supportedLanguages),
    supportedLanguages: Array.from(supportedLanguages),
  };

  // Create and return ProjectIndex
  const index = projectIndexCreate(store, capabilities);

  return { index, stats };
}

/**
 * Whether the index has at least one language adapter that emits
 * {@link SymbolFlowRelation}s. Today only the TypeScript pack does;
 * Python and other languages will opt in once they ship the query +
 * extractor wiring.
 *
 * Centralized here so adding a new language with symbol-flow support
 * is a one-line change.
 */
function indexCapabilitiesSymbolFlowCompute(
  supportedLanguages: Set<string>,
): boolean {
  return (
    supportedLanguages.has('typescript') ||
    supportedLanguages.has('tsx') ||
    supportedLanguages.has('python')
  );
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
 *
 * Consults the `langAdd` registry first so that custom languages registered
 * via `langAdd` + `adapterRegister` are routed correctly. Falls back to a
 * hardcoded switch for extensions that may not be registered (e.g., `.js`/`.jsx`
 * are served by the TS/TSX parsers but callers may not register them explicitly).
 */
function languageIdFromFile(filePath: string): string | undefined {
  // Check langAdd registry first (populated by langAdd calls)
  const registeredId = langIdGetForFile(filePath);
  if (registeredId) {
    return registeredId;
  }

  // Fallback for extensions not registered via langAdd
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

  // Add re-exported symbols to the export map (follows sourceModule chains)
  exportMapAddReexportedSymbols(store, exportMap, resolveOptions, indexedFiles);

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
      const updatedNsBinding: ImportBindingRelation = {
        ...binding,
        resolvedModulePath: resolvedPath,
      };
      store.relationUpdate(binding, updatedNsBinding);
      continue;
    } else {
      resolvedExportId = fileExports.get(binding.importedName);
    }

    if (resolvedExportId) {
      // Check for namespace re-export sentinel
      const NS_SENTINEL = '__ns_reexport:';
      if (resolvedExportId.startsWith(NS_SENTINEL)) {
        const nsSourcePath = resolvedExportId.slice(NS_SENTINEL.length);
        const updatedBinding: ImportBindingRelation = {
          ...binding,
          resolvedModulePath: nsSourcePath,
          isNamespace: true,
        };
        store.relationUpdate(binding, updatedBinding);
        continue;
      }

      const updatedBinding: ImportBindingRelation = {
        ...binding,
        resolvedModulePath: resolvedPath,
        resolvedExportId,
      };
      store.relationUpdate(binding, updatedBinding);
    }
  }

  // Re-resolve ImportsRelation specifiers FROM this file so side-effect and
  // dynamic import edges stay current for overlay-backed updates.
  const imports = store.importsInFileGet(file);
  for (const imp of imports) {
    const resolvedPath = moduleResolve(imp.spec, file, {
      ...resolveOptions,
      indexedFiles,
    });
    const nextResolvedModulePath =
      resolvedPath && indexedFiles.has(resolvedPath) ? resolvedPath : undefined;
    if (imp.resolvedModulePath === nextResolvedModulePath) {
      continue;
    }
    const updatedImport: ImportsRelation = {
      ...imp,
      resolvedModulePath: nextResolvedModulePath,
    };
    store.relationUpdate(imp, updatedImport);
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
        const updatedNsBinding: ImportBindingRelation = {
          ...binding,
          resolvedModulePath: file,
        };
        store.relationUpdate(binding, updatedNsBinding);
        continue;
      } else {
        resolvedExportId = fileExports.get(binding.importedName);
      }

      // Check for namespace re-export sentinel
      const NS_SENTINEL = '__ns_reexport:';
      if (resolvedExportId?.startsWith(NS_SENTINEL)) {
        const nsSourcePath = resolvedExportId.slice(NS_SENTINEL.length);
        const updatedBinding: ImportBindingRelation = {
          ...binding,
          resolvedModulePath: nsSourcePath,
          isNamespace: true,
        };
        store.relationUpdate(binding, updatedBinding);
        continue;
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

  // Bindings in this file may have changed `resolvedExportId` — re-run
  // the call rewrite so cross-file call edges stay current. Bindings in
  // *other* files that target this file have also been touched above;
  // their call sites are caught by re-running the per-file resolver on
  // those files. Tracking which other files were touched would over-fit
  // to the rewrite shape, so we keep the cheap path: callers that re-run
  // `crossFileResolveForFile` per dirty file (the workspace service does
  // this today) get the correct end state.
  callsCrossFileResolveForFile(store, file);
}

/**
 * Resolve cross-file `Calls.resolvedSymbolId` by name-matching unresolved
 * call sites against the file's import bindings. Members and dotted
 * callees are skipped (they need namespace-aware resolution that the
 * Step 5 reference pass already performs against `References`). Already
 * resolved calls are left untouched so file-local function/method
 * resolution from the adapter wins over import-binding fallback —
 * matching ECMAScript scoping rules where a same-file declaration
 * shadows an import of the same name.
 *
 * Idempotent and cycle-safe: the rewrite only sets `resolvedSymbolId` to
 * the binding's already-canonicalized `resolvedExportId`, so running this
 * pass twice produces no change.
 */
function callsCrossFileResolve(
  store: IndexStore,
  indexedFiles: Set<string>,
): void {
  for (const file of indexedFiles) {
    callsCrossFileResolveForFile(store, file);
  }
}

/**
 * Per-file companion to {@link callsCrossFileResolve}. Used by both the
 * full-build pass and the incremental {@link crossFileResolveForFile}
 * path so overlay re-resolves keep call edges in sync.
 */
function callsCrossFileResolveForFile(store: IndexStore, file: string): void {
  const bindings = store.importBindingsInFileGet(file);
  if (bindings.length === 0) return;

  const bindingsByName = new Map<string, ImportBindingRelation>();
  for (const binding of bindings) {
    if (!binding.resolvedExportId) continue;
    const localSymbol = store.symbolGet(binding.localSymbolId);
    if (!localSymbol) continue;
    if (bindingsByName.has(localSymbol.name)) continue;
    bindingsByName.set(localSymbol.name, binding);
  }
  if (bindingsByName.size === 0) return;

  const scopes = store.scopesInFileGet(file);
  for (const scope of scopes) {
    const calls = store.callsInScopeGet(scope.id);
    for (const call of calls) {
      if (call.resolvedSymbolId !== undefined) continue;
      if (call.calleeName.includes('.')) continue;
      const binding = bindingsByName.get(call.calleeName);
      if (!binding || !binding.resolvedExportId) continue;
      const updatedCall: CallsRelation = {
        ...call,
        resolvedSymbolId: binding.resolvedExportId,
      };
      store.relationUpdate(call, updatedCall);
    }
  }
}

// ============================================================================
// Re-exported Symbol Propagation
// ============================================================================

/**
 * Add re-exported symbols to the export map by following `sourceModule`
 * references in `ExportsRelation` entries.
 *
 * Named re-exports (`export { foo } from "module"`) and star exports
 * (`export * from "module"`) produce `ExportsRelation` with `symbolId: ''`
 * and a `sourceModule` specifier. This function looks up each source
 * module's export map, finds the origin symbol ID, and adds it under the
 * proxy file's exported name.
 *
 * Iterates until stable to handle chains (A re-exports from B which
 * re-exports from C). A max iteration limit prevents infinite loops from
 * circular re-exports.
 */
function exportMapAddReexportedSymbols(
  store: IndexStore,
  exportMap: Map<string, Map<string, SymbolId>>,
  resolveOptions: ModuleResolveOptions,
  indexedFiles: Set<string>
): void {
  const MAX_ITERATIONS = 10;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;

    for (const file of indexedFiles) {
      const fileExportRelations = store.exportsInFileGet(file);

      for (const exp of fileExportRelations) {
        if (!exp.sourceModule) continue;

        // Map the source module specifier to an absolute file path
        const resolvedSourcePath = moduleResolve(exp.sourceModule, file, {
          ...resolveOptions,
          indexedFiles,
        });
        if (!resolvedSourcePath || !indexedFiles.has(resolvedSourcePath)) continue;

        const sourceExports = exportMap.get(resolvedSourcePath);
        if (!sourceExports) continue;

        // Ensure this file has an export map entry
        if (!exportMap.has(file)) {
          exportMap.set(file, new Map());
        }
        const fileExportMap = exportMap.get(file)!;

        if (exp.exportedName === '*' && exp.sourceName === '*') {
          // Star export: copy all non-default exports from source
          for (const [name, symbolId] of sourceExports) {
            if (name !== 'default' && !fileExportMap.has(name)) {
              fileExportMap.set(name, symbolId);
              changed = true;
            }
          }
        } else if (exp.exportedName !== '*' && exp.sourceName === '*') {
          // Namespace re-export: export * as ns from "module"
          // Store a sentinel ID so crossFileResolve can treat the consumer's
          // named import as a namespace binding pointing to the source module.
          const sentinel = `__ns_reexport:${resolvedSourcePath}`;
          if (!fileExportMap.has(exp.exportedName)) {
            fileExportMap.set(exp.exportedName, sentinel);
            changed = true;
          }
        } else if (exp.symbolId === '' && exp.sourceName) {
          // Named re-export: look up the specific name in the source module
          const sourceSymbolId = sourceExports.get(exp.sourceName);
          if (sourceSymbolId && !fileExportMap.has(exp.exportedName)) {
            fileExportMap.set(exp.exportedName, sourceSymbolId);
            changed = true;
          }
        }
      }
    }

    if (!changed) break;
  }
}

// ============================================================================
// Cross-File Resolution
// ============================================================================

/**
 * Resolve cross-file symbols after all files are indexed.
 * This function:
 * 1. Builds an export map from all indexed files
 * 2. Adds re-exported symbols to the map by following sourceModule chains
 * 3. Resolves ImportBinding relations to their source exports
 * 4. Updates References relations that refer to imported symbols
 */
function crossFileResolve(
  store: IndexStore,
  resolveOptions: ModuleResolveOptions
): void {
  // Step 1: Build export map - Map<filePath, Map<exportedName, SymbolId>>
  const exportMap = store.exportMapBuild();
  
  // Build a set of indexed files for validation
  const indexedFiles = new Set(store.filesGet());

  // Step 2: Add re-exported symbols to the export map (follows sourceModule chains)
  exportMapAddReexportedSymbols(store, exportMap, resolveOptions, indexedFiles);

  // Step 3: Resolve each ImportBinding relation
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

    if (binding.isNamespace) {
      // Namespace import: doesn't resolve to a single symbol, but we still
      // set resolvedModulePath so namespace member accesses can be resolved later
      if (fileExports) {
        const updatedBinding: ImportBindingRelation = {
          ...binding,
          resolvedModulePath: resolvedPath,
        };
        store.relationUpdate(binding, updatedBinding);
      }
      continue;
    }

    // Try to find the exported name in the resolved file
    let resolvedExportId: string | undefined;
    if (fileExports) {
      if (binding.isDefault) {
        resolvedExportId = fileExports.get('default');
      } else {
        resolvedExportId = fileExports.get(binding.importedName);
      }
    }

    if (resolvedExportId) {
      // Check for namespace re-export sentinel (export * as ns from "module").
      // The consumer did a named import (import { ns } from './proxy'), but
      // the export map entry is a sentinel pointing to the source module.
      // Convert to a namespace-like binding so the member resolution pass
      // (Step 5) can resolve ns.foo accesses.
      const NS_SENTINEL = '__ns_reexport:';
      if (resolvedExportId.startsWith(NS_SENTINEL)) {
        const nsSourcePath = resolvedExportId.slice(NS_SENTINEL.length);
        const updatedBinding: ImportBindingRelation = {
          ...binding,
          resolvedModulePath: nsSourcePath,
          isNamespace: true,
        };
        store.relationUpdate(binding, updatedBinding);
        continue;
      }

      // Update the ImportBinding with the resolved information
      const updatedBinding: ImportBindingRelation = {
        ...binding,
        resolvedModulePath: resolvedPath,
        resolvedExportId,
      };
      store.relationUpdate(binding, updatedBinding);
    } else if (
      fromFile.endsWith('.py') &&
      resolvedPath.endsWith('__init__.py')
    ) {
      // Python submodule fallback: `from package import submodule` where
      // `submodule` is a file (package/submodule.py) rather than an exported
      // name from package/__init__.py.
      const submodulePath = pythonSubmoduleResolve(resolvedPath, binding.importedName);
      if (submodulePath && indexedFiles.has(submodulePath)) {
        const updatedBinding: ImportBindingRelation = {
          ...binding,
          resolvedModulePath: submodulePath,
          isNamespace: true,
        };
        store.relationUpdate(binding, updatedBinding);
      }
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

  // Step 5: Resolve namespace import member accesses (e.g., utils.alpha)
  // Build a map of namespace symbol IDs to their module's export map
  const namespaceExports = new Map<string, Map<string, string>>();
  for (const binding of store.importBindingsGet()) {
    if (binding.isNamespace && binding.resolvedModulePath) {
      const moduleExports = exportMap.get(binding.resolvedModulePath);
      if (moduleExports) {
        namespaceExports.set(binding.localSymbolId, moduleExports);
      }
    }
  }

  // For each file, check dotted references (e.g., "utils.alpha") and resolve
  // them against the namespace's module exports
  if (namespaceExports.size > 0) {
    for (const file of indexedFiles) {
      const refs = store.referencesInFileGet(file);

      for (const ref of refs) {
        // Dotted references were created by memberRefsExtract
        if (!ref.name.includes('.')) continue;

        const dotIdx = ref.name.indexOf('.');
        const memberName = ref.name.slice(dotIdx + 1);

        // The resolvedSymbolId should point to the namespace import symbol
        if (!ref.resolvedSymbolId) continue;
        const moduleExports = namespaceExports.get(ref.resolvedSymbolId);
        if (!moduleExports) continue;

        // Look up the member name in the namespace's module exports
        const exportedSymbolId = moduleExports.get(memberName);
        if (exportedSymbolId) {
          const updatedRef: ReferencesRelation = {
            ...ref,
            resolvedSymbolId: exportedSymbolId,
          };
          store.relationUpdate(ref, updatedRef);
        }
      }
    }
  }

  // Step 5b: Resolve cross-file Calls.
  // The adapter resolves a `Calls` site only when the callee name matches
  // a function/method declared in the same file. For cross-file calls
  // (`import { helper } from './a'; helper()`) `Calls.resolvedSymbolId`
  // is left undefined because the local binding is a variable (kind
  // 'variable', binding 'import'), not a function. Mirror the References
  // pass: walk every unresolved call and try to match the callee name
  // against an import binding in the same file. When found, point the
  // call directly at the canonical exported symbol so `callersGet` /
  // `calleesGet` see one node per logical declaration regardless of how
  // many re-export hops the call traversed (`exportMapAddReexportedSymbols`
  // already collapsed re-export chains into `binding.resolvedExportId`).
  callsCrossFileResolve(store, indexedFiles);

  // Step 6: Resolve cross-file TypeRelation targets
  // When a class extends/implements an imported symbol, resolvedTargetId currently
  // points to the local import binding symbol. Update it to point to the actual
  // exported symbol from the source module.
  for (const file of indexedFiles) {
    const typeRels = store.typeRelationsInFileGet(file);

    for (const rel of typeRels) {
      if (!rel.resolvedTargetId) continue;

      // Check if resolvedTargetId points to an import binding symbol
      const actualExportId = importResolutionMap.get(rel.resolvedTargetId);
      if (actualExportId && actualExportId !== rel.resolvedTargetId) {
        const updatedRel: TypeRelation = {
          ...rel,
          resolvedTargetId: actualExportId,
        };
        store.relationUpdate(rel, updatedRel);
      }
    }
  }

  // Step 7: Resolve ImportsRelation specifiers
  // Sets resolvedModulePath on side-effect and dynamic imports so the module
  // graph can include them as dependency edges.
  for (const file of indexedFiles) {
    const imports = store.importsInFileGet(file);

    for (const imp of imports) {
      if (imp.resolvedModulePath) continue; // Already resolved

      const resolvedPath = moduleResolve(imp.spec, file, {
        ...resolveOptions,
        indexedFiles,
      });

      if (resolvedPath && indexedFiles.has(resolvedPath)) {
        const updatedImport: ImportsRelation = {
          ...imp,
          resolvedModulePath: resolvedPath,
        };
        store.relationUpdate(imp, updatedImport);
      }
    }
  }
}
