# Cross-File Analysis: Remaining Work

This document tracks incomplete implementations and future work for the semantic index.

## Current State

The semantic index provides:
- Symbol extraction (functions, classes, variables)
- Scope tree construction
- File-local reference resolution
- Cross-file reference resolution (basic - see status below)
- Heuristic call detection
- Import statement extraction (named, default, namespace)
- Export statement extraction (basic patterns)
- Query API for plugins (`ProjectIndex`)

## Implementation Status

### 1. Cross-File Symbol Resolution
**Status**: Partially Implemented

Core infrastructure complete, some advanced features pending:

- [x] `ImportBindingRelation` type defined
- [x] `crossFileResolve()` function in `indexBuilder.ts`
- [x] Module path resolution (`moduleResolver.ts`)
- [x] Export map building from `IndexStore`
- [x] Basic import-to-export resolution
- [ ] Re-export chain resolution (A re-exports from B re-exports from C)
- [ ] Star export enumeration (`export *` should list all symbols)
- [ ] Circular re-export detection

The `crossFileResolve()` function:
1. Builds export map: `Map<filePath, Map<exportedName, SymbolId>>`
2. Resolves `ImportBinding` relations to their source exports
3. Updates `References.resolvedSymbolId` to point to actual exported symbols

### 2. Export Relation
**Status**: Partially Implemented

Core infrastructure complete, but TypeScript queries simplified for compatibility:

- [x] `ExportsRelation` type with all fields (`symbolId`, `exportedName`, `isDefault`, `sourceModule`, `sourceName`)
- [x] `IndexStore` indexes (`exportsByFile`, `exportsByName`, `exportMapBuild()`)
- [x] `exportsExtract()` function in `adapterCore.ts`
- [x] `ProjectIndex` API (`getFileExports()`, `getExportLocations()`)
- [x] Basic export declarations (`export const/function/class`)
- [x] Named exports (`export { foo }`)
- [x] Default exports (`export default foo`)
- [ ] Export aliases (`export { foo as bar }`) - query removed
- [ ] Re-exports (`export { foo } from "module"`) - query removed
- [ ] Star exports (`export * from "module"`) - query removed
- [ ] Namespace re-exports (`export * as ns`) - query removed
- [ ] Interface/type/enum exports - query removed
- [ ] Anonymous default exports - query removed

### 3. Import Binding Relations
**Status**: Partially Implemented

- [x] `ImportBindingRelation` type defined
- [x] Named imports (`import { foo }`)
- [x] Default imports (`import foo from`)
- [x] Namespace imports (`import * as foo`)
- [ ] Import aliases (`import { foo as bar }`) - query removed
- [ ] Dynamic imports (`import("module")`) - query removed
- [ ] CommonJS requires (`require()`) - query removed

## Not Yet Implemented

### High Priority

#### 1. Module Graph
**Status**: Not implemented (foundation exists)

Build a module-level graph from import relations:

- [x] Import relations stored in `IndexStore`
- [x] Module specifier extraction
- [ ] `ModuleGraph` type and API
- [ ] `getImporters(file)` / `getImportees(file)`
- [ ] Topological sort (`getDependencyOrder()`)
- [ ] Circular dependency detection (`getCycles()`)
- [ ] Entry point detection

```typescript
type ModuleGraph = {
  getImporters(file: string): string[];
  getImportees(file: string): string[];
  getDependencyOrder(): string[];  // Topological sort
  getCycles(): string[][];
};
```

### Medium Priority

#### 4. Control Flow Graph (CFG)
**Status**: Not implemented  
**What's missing**: The original spec's FlowNode/FlowEdge

The spec outlined abstract control flow nodes:
```typescript
type FlowNode = {
  id: FlowNodeId;
  kind: 'entry' | 'exit' | 'branch' | 'merge' | 'loop' | 'call';
};

type FlowEdge = {
  from: FlowNodeId;
  to: FlowNodeId;
  condition?: ConditionId;
};
```

Use cases:
- Cyclomatic complexity calculation
- Path counting
- Dead code detection
- Reachability analysis

#### 5. Type Relations
**Status**: Not implemented  
**What's missing**: Type system awareness

```typescript
type TypeRelation =
  | { kind: 'Extends'; childId: SymbolId; parentId: SymbolId }
  | { kind: 'Implements'; classId: SymbolId; interfaceId: SymbolId }
  | { kind: 'TypeOf'; valueId: SymbolId; typeId: SymbolId };
```

Requires deeper Tree-sitter queries or TypeScript compiler API integration.

#### 6. Persistence / Caching
**Status**: In-memory only  
**What's missing**: Disk persistence for large projects

Options:
- SQLite-based storage
- Binary serialization
- LSP-style caching

Benefits:
- Faster startup for unchanged files
- Reduced memory for large codebases
- Shareable between processes

#### 7. Watch Mode / Incremental Updates
**Status**: API exists, no integration  
**What's missing**: File watcher integration

`projectIndexUpdate()` exists but nothing calls it automatically. Need:
- File system watcher
- Debounced re-indexing
- Dirty file tracking

### Lower Priority

#### 8. Additional Language Adapters
**Status**: TypeScript/Python only  
**What's missing**: Other languages

Candidates:
- JavaScript (can reuse TS adapter mostly)
- Rust
- Go
- Java

Each needs:
- Tree-sitter grammar WASM
- Query packs (scopes.ts, symbols.ts, refs.ts, calls.ts, imports.ts)
- Kind mappings
- Language-specific ref filtering

#### 9. Query Optimization
**Status**: Naive implementation  
**What's missing**: Efficient queries for large codebases

Current implementation uses linear scans in some cases. Could add:
- Bloom filters for name existence checks
- Interval trees for range queries
- Lazy loading of relations

#### 10. LSP Integration
**Status**: Not implemented  
**What's missing**: Language Server Protocol bridge

The original spec mentioned "LSP++ sidecar":
- Expose index via LSP custom methods
- Editor-agnostic navigation
- Headless CI usage

### Known Limitations

These are intentional constraints, not bugs:

1. **No AST exposure** - Index contains semantic primitives, not syntax nodes
2. **Best-effort resolution** - Unresolved references are valid results
3. **No type inference** - Tree-sitter alone can't do type analysis
4. **Heuristic call detection** - May miss indirect calls, report false positives
5. **Single-threaded indexing** - Could parallelize per-file

## Testing Status

- [ ] Unit tests for IndexStore operations
- [ ] Unit tests for adapter query execution
- [x] Integration tests for cross-file scenarios (`tests/index.cross-file-resolution.spec.ts`)
- [ ] Performance benchmarks for large codebases
- [ ] Edge case coverage (circular imports, re-exports, etc.)

## Documentation Needed

- [ ] API reference for ProjectIndex
- [ ] Guide for creating language adapters
- [ ] Examples of cross-file analysis rules
- [ ] Architecture documentation with diagrams
