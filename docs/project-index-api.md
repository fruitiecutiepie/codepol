# ProjectIndex API Reference

`ProjectIndex` is the read-only query interface for the semantic index. Plugin rules use it to query project-wide information about symbols, references, imports, exports, type relations, module dependencies, and control flow.

## Design Principles

- **Total queries** -- all methods return empty arrays or `undefined`, never `null`, never throw
- **Read-only** -- no mutation methods are exposed; the index is immutable after construction
- **Language-agnostic** -- no AST nodes or compiler internals are exposed

## Creating a ProjectIndex

### `projectIndexBuild`

Build an index from a list of files (async).

```typescript
import { projectIndexBuild } from '@codepol/core';

const result = await projectIndexBuild({
  files: ['/abs/path/to/src/foo.ts', '/abs/path/to/src/bar.ts'],
  dir: '/abs/path/to',
});

const index = result.index;
console.log(result.stats); // { filesIndexed: 2, filesSkipped: 0, errors: [] }
```

### `projectIndexBuildSync`

Synchronous variant. Use when async is not available (e.g., inside ESLint rules).

```typescript
import { projectIndexBuildSync } from '@codepol/core';

const result = projectIndexBuildSync({
  files: ['/abs/path/to/src/foo.ts'],
  dir: '/abs/path/to',
});
```

### `IndexBuildOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `files` | `string[]` | required | Absolute paths to files to index |
| `dir` | `string` | required | Working directory for module resolution |
| `languages` | `string[]` | all | Filter to specific language IDs |
| `store` | `IndexStore` | new | Existing store to update incrementally |
| `crossFileResolution` | `boolean` | `true` | Enable cross-file symbol resolution |
| `pathAliases` | `Record<string, string[]>` | none | Path aliases for module resolution (e.g., from tsconfig) |

### `IndexBuildResult`

| Property | Type | Description |
|----------|------|-------------|
| `index` | `ProjectIndex` | The query interface |
| `stats.filesIndexed` | `number` | Number of files successfully indexed |
| `stats.filesSkipped` | `number` | Files skipped (unsupported language, unchanged revision) |
| `stats.errors` | `string[]` | Per-file error messages |

---

## Symbol Queries

### `symbolsGet`

Get all symbols matching an optional filter.

```typescript
symbolsGet(filter?: SymbolFilter): SymbolRecord[]
```

```typescript
// All symbols in the project
const all = index.symbolsGet();

// All functions in a specific file
const fns = index.symbolsGet({ file: '/src/utils.ts', kind: 'function' });

// All symbols named 'UserService'
const named = index.symbolsGet({ name: 'UserService' });
```

### `symbolGet`

Get a symbol by its stable ID.

```typescript
symbolGet(id: SymbolId): SymbolRecord | undefined
```

```typescript
const symbol = index.symbolGet('sym::/src/utils.ts::fetchData');
if (symbol) {
  console.log(symbol.name, symbol.kind, symbol.file);
}
```

### `symbolsInFileGet`

Get all symbols declared in a file.

```typescript
symbolsInFileGet(file: string): SymbolRecord[]
```

```typescript
const symbols = index.symbolsInFileGet('/src/models/user.ts');
```

### `symbolsGetByName`

Get all symbols with a given name across all files.

```typescript
symbolsGetByName(name: string): SymbolRecord[]
```

```typescript
// Find all declarations named 'Config' across the project
const configs = index.symbolsGetByName('Config');
```

---

## Reference Queries

### `referencesGet`

Get all references to a symbol.

```typescript
referencesGet(symbolId: SymbolId): ReferencesRelation[]
```

```typescript
const refs = index.referencesGet(symbol.id);
console.log(`${symbol.name} is referenced ${refs.length} times`);
```

### `referencesInFileGet`

Get all references in a file.

```typescript
referencesInFileGet(file: string): ReferencesRelation[]
```

```typescript
const refs = index.referencesInFileGet('/src/app.ts');
for (const ref of refs) {
  console.log(`Reference to '${ref.name}' at byte ${ref.byteRange.start}`);
}
```

---

## Call Graph Queries

Based on heuristic call detection. May have false positives and negatives.

### `callersGet`

Get symbols that call a given symbol. Returns the enclosing function/method symbols that contain call sites targeting this symbol.

```typescript
callersGet(symbolId: SymbolId): SymbolId[]
```

```typescript
const callers = index.callersGet(targetFn.id);
for (const callerId of callers) {
  const caller = index.symbolGet(callerId);
  console.log(`Called by ${caller?.qualName}`);
}
```

### `calleesGet`

Get symbols called by a given function/method. Returns empty for non-function symbols.

```typescript
calleesGet(symbolId: SymbolId): SymbolId[]
```

```typescript
const callees = index.calleesGet(myFunction.id);
console.log(`${myFunction.name} calls ${callees.length} functions`);
```

---

## Scope Queries

### `scopeGet`

Get a scope by its stable ID.

```typescript
scopeGet(id: ScopeId): ScopeRecord | undefined
```

### `scopesInFileGet`

Get all scopes in a file.

```typescript
scopesInFileGet(file: string): ScopeRecord[]
```

### `symbolsInScopeGet`

Get all symbols defined in a scope.

```typescript
symbolsInScopeGet(scopeId: ScopeId): SymbolRecord[]
```

```typescript
const fileScopes = index.scopesInFileGet('/src/utils.ts');
for (const scope of fileScopes) {
  const symbols = index.symbolsInScopeGet(scope.id);
  console.log(`Scope ${scope.kind} contains ${symbols.length} symbols`);
}
```

---

## Import / Export Queries

### `importsGet`

Get all import statements in a file.

```typescript
importsGet(file: string): ImportsRelation[]
```

```typescript
const imports = index.importsGet('/src/app.ts');
for (const imp of imports) {
  console.log(`Imports from '${imp.spec}' -> ${imp.resolvedModulePath ?? 'unresolved'}`);
}
```

### `importBindingsGet`

Get all import bindings in a file. Each binding represents a single imported name with detailed resolution information.

```typescript
importBindingsGet(file: string): ImportBindingRelation[]
```

```typescript
const bindings = index.importBindingsGet('/src/app.ts');
for (const b of bindings) {
  console.log(`Import '${b.importedName}' from '${b.moduleSpec}'`);
  console.log(`  resolved to: ${b.resolvedExportId ?? 'unresolved'}`);
  console.log(`  default: ${b.isDefault}, namespace: ${b.isNamespace}`);
}
```

### `importBindingGetForSymbol`

Get the import binding for a symbol, if it was imported.

```typescript
importBindingGetForSymbol(symbolId: SymbolId): ImportBindingRelation | undefined
```

```typescript
const binding = index.importBindingGetForSymbol(symbol.id);
if (binding) {
  console.log(`${symbol.name} was imported from ${binding.moduleSpec}`);
}
```

### `exportedSymbolsGet`

Get all symbols that have the `Exported` flag set.

```typescript
exportedSymbolsGet(filter?: { file?: string; name?: string }): SymbolRecord[]
```

```typescript
// All exported symbols
const allExported = index.exportedSymbolsGet();

// Exported symbols in a specific file
const fileExported = index.exportedSymbolsGet({ file: '/src/api.ts' });
```

### `exportersGet`

Get symbols that export a given name. Useful for resolving "who exports this name?".

```typescript
exportersGet(symbolName: string): SymbolRecord[]
```

```typescript
const exporters = index.exportersGet('UserService');
// Returns all exported symbols named 'UserService' across the project
```

### `fileExportsGet`

Get all export relations from a file.

```typescript
fileExportsGet(file: string): ExportsRelation[]
```

```typescript
const exports = index.fileExportsGet('/src/utils.ts');
for (const exp of exports) {
  console.log(`Exports '${exp.exportedName}' (default: ${exp.isDefault})`);
}
```

### `exportLocationsGet`

Find where a symbol is exported from. Returns the files and exported names.

```typescript
exportLocationsGet(symbolId: SymbolId): { file: string; exportedName: string }[]
```

```typescript
const locations = index.exportLocationsGet(symbol.id);
for (const loc of locations) {
  console.log(`Exported as '${loc.exportedName}' from ${loc.file}`);
}
```

### `importResolve`

Resolve an import to its target symbol using cross-file resolution data.

```typescript
importResolve(fromFile: string, specifier: string, name: string): SymbolId | undefined
```

| Parameter | Description |
|-----------|-------------|
| `fromFile` | Absolute path of the file containing the import |
| `specifier` | Module specifier (e.g., `'./utils'`) |
| `name` | Imported name, or `'default'` for default imports |

```typescript
const symbolId = index.importResolve('/src/app.ts', './utils', 'fetchData');
if (symbolId) {
  const symbol = index.symbolGet(symbolId);
  console.log(`Resolved to ${symbol?.qualName} in ${symbol?.file}`);
}
```

---

## Type Relation Queries

### `typeRelationsGet`

Get type relations for a symbol (what it extends/implements).

```typescript
typeRelationsGet(symbolId: SymbolId): TypeRelation[]
```

```typescript
const rels = index.typeRelationsGet(myClass.id);
for (const rel of rels) {
  console.log(`${rel.relationKind} ${rel.targetName}`);
  // e.g., "extends BaseService" or "implements Serializable"
}
```

### `subTypesGet`

Get symbols that extend or implement a given symbol (reverse lookup).

```typescript
subTypesGet(symbolId: SymbolId): TypeRelation[]
```

```typescript
const children = index.subTypesGet(baseClass.id);
console.log(`${baseClass.name} has ${children.length} subtypes`);
```

### `typeRelationsInFileGet`

Get all type relations in a file.

```typescript
typeRelationsInFileGet(file: string): TypeRelation[]
```

---

## Module Graph Queries

The module graph is built lazily from resolved import relations and cached after first access.

### `moduleImportersGet`

Get files that import the given file (reverse dependency edges). Only includes indexed files.

```typescript
moduleImportersGet(file: string): string[]
```

```typescript
const importers = index.moduleImportersGet('/src/utils.ts');
console.log(`${importers.length} files depend on utils.ts`);
```

### `moduleImporteesGet`

Get files that the given file imports (forward dependency edges). Only includes indexed files.

```typescript
moduleImporteesGet(file: string): string[]
```

```typescript
const deps = index.moduleImporteesGet('/src/app.ts');
console.log(`app.ts depends on ${deps.length} internal files`);
```

### `moduleDependencyOrderGet`

Get all indexed files in topological dependency order. Files with no dependencies come first.

```typescript
moduleDependencyOrderGet(): string[]
```

```typescript
const order = index.moduleDependencyOrderGet();
// order[0] has no dependencies; order[last] depends on earlier files
```

### `moduleCyclesGet`

Get all circular dependency cycles. Each cycle is an array of file paths.

```typescript
moduleCyclesGet(): string[][]
```

```typescript
const cycles = index.moduleCyclesGet();
if (cycles.length > 0) {
  for (const cycle of cycles) {
    console.log(`Circular: ${cycle.join(' -> ')}`);
  }
}
```

### `moduleEntryPointsGet`

Get entry point files (files with no importers within the indexed set). Sorted alphabetically.

```typescript
moduleEntryPointsGet(): string[]
```

```typescript
const entries = index.moduleEntryPointsGet();
console.log('Entry points:', entries);
```

---

## Control Flow Graph Queries

### `cfgGet`

Get the control flow graph for a scope. Returns `undefined` if the scope is not a function or CFGs were not extracted.

```typescript
cfgGet(scopeId: ScopeId): FlowGraph | undefined
```

```typescript
const scopes = index.scopesInFileGet('/src/utils.ts');
for (const scope of scopes) {
  const cfg = index.cfgGet(scope.id);
  if (cfg) {
    console.log(`CFG: ${cfg.nodes.length} nodes, ${cfg.edges.length} edges`);
  }
}
```

### `cyclomaticComplexityGet`

Get the cyclomatic complexity of a function/method symbol. Computed as V(G) = E - N + 2.

```typescript
cyclomaticComplexityGet(symbolId: SymbolId): number | undefined
```

```typescript
const functions = index.symbolsGet({ kind: 'function' });
for (const fn of functions) {
  const complexity = index.cyclomaticComplexityGet(fn.id);
  if (complexity !== undefined && complexity > 10) {
    console.log(`${fn.qualName} has high complexity: ${complexity}`);
  }
}
```

---

## Metadata

### `capabilities`

Get the capabilities of this index. Plugins should check this before attempting advanced queries.

```typescript
readonly capabilities: IndexCapabilities
```

```typescript
if (index.capabilities.crossFileResolution) {
  // Safe to use import/export queries
}
if (index.capabilities.controlFlowGraph) {
  // Safe to use cfgGet / cyclomaticComplexityGet
}
console.log('Languages:', index.capabilities.supportedLanguages);
console.log('Call graph:', index.capabilities.callGraph); // 'none' | 'heuristic' | 'precise'
```

### `statsGet`

Get statistics about the index.

```typescript
statsGet(): { files: number; symbols: number; scopes: number; relations: number }
```

```typescript
const stats = index.statsGet();
console.log(`Indexed ${stats.files} files, ${stats.symbols} symbols`);
```

---

## Types

### `SymbolRecord`

```typescript
type SymbolRecord = {
  id: SymbolId;           // Stable unique identifier
  kind: SymbolKind;       // 'function' | 'class' | 'variable' | ...
  name: string;           // Declared name (local, not qualified)
  file: string;           // Absolute file path
  byteRange: ByteRange;   // { start: number; end: number }
  scopeId: ScopeId;       // Containing scope
  qualName: string;       // Qualified name for disambiguation
  flags: number;          // Bitset of SymbolFlags
};
```

### `ScopeRecord`

```typescript
type ScopeRecord = {
  id: ScopeId;            // Stable unique identifier
  kind: ScopeKind;        // 'file' | 'function' | 'class' | 'block' | ...
  file: string;           // Absolute file path
  byteRange: ByteRange;   // { start: number; end: number }
  parent?: ScopeId;       // Parent scope (undefined for file scope)
};
```

### `SymbolFilter`

```typescript
type SymbolFilter = {
  file?: string;          // Filter by file path
  kind?: SymbolKind;      // Filter by symbol kind
  name?: string;          // Filter by name (exact match)
  scopeId?: ScopeId;      // Filter by scope
};
```

### `ReferencesRelation`

```typescript
type ReferencesRelation = {
  kind: 'References';
  scopeId: ScopeId;
  name: string;
  byteRange: ByteRange;
  resolvedSymbolId?: SymbolId;  // Undefined if unresolved
};
```

### `ImportsRelation`

```typescript
type ImportsRelation = {
  kind: 'Imports';
  scopeId: ScopeId;
  spec: string;                 // Module specifier (e.g., './foo', 'lodash')
  byteRange: ByteRange;
  resolvedModulePath?: string;  // Set during cross-file resolution
};
```

### `ImportBindingRelation`

```typescript
type ImportBindingRelation = {
  kind: 'ImportBinding';
  localSymbolId: SymbolId;      // The local binding symbol
  importedName: string;         // Original exported name
  moduleSpec: string;           // Module specifier
  resolvedModulePath?: string;  // Resolved absolute path
  resolvedExportId?: SymbolId;  // Resolved source symbol ID
  isDefault: boolean;           // Default import
  isNamespace: boolean;         // Namespace import (import * as X)
  byteRange: ByteRange;
};
```

### `ExportsRelation`

```typescript
type ExportsRelation = {
  kind: 'Exports';
  symbolId: SymbolId;           // Exported symbol
  exportedName: string;         // Exported name (may differ if aliased)
  isDefault: boolean;           // Default export
  sourceModule?: string;        // For re-exports: source module specifier
  sourceName?: string;          // For re-exports: original name
  byteRange: ByteRange;
};
```

### `TypeRelation`

```typescript
type TypeRelation = {
  kind: 'TypeRelation';
  symbolId: SymbolId;           // Child symbol
  targetName: string;           // Parent/interface name
  relationKind: 'extends' | 'implements';
  byteRange: ByteRange;
  resolvedTargetId?: SymbolId;  // Resolved target symbol
};
```

### `FlowGraph`

```typescript
type FlowGraph = {
  scopeId: ScopeId;       // Function/method scope
  nodes: FlowNode[];      // All nodes
  edges: FlowEdge[];      // All edges
};

type FlowNode = {
  id: FlowNodeId;
  kind: FlowNodeKind;     // 'entry' | 'exit' | 'statement' | 'branch' | ...
  byteRange?: ByteRange;  // Undefined for synthetic entry/exit
  label?: string;
};

type FlowEdge = {
  from: FlowNodeId;
  to: FlowNodeId;
  label?: 'true' | 'false' | 'loop-back' | 'unconditional' | 'break' | ...
};
```

### `IndexCapabilities`

```typescript
type IndexCapabilities = {
  crossFileResolution: boolean;
  callGraph: 'none' | 'heuristic' | 'precise';
  controlFlowGraph: boolean;
  supportedLanguages: string[];
};
```

### `SymbolFlags`

```typescript
const SymbolFlags = {
  None:      0,
  Exported:  1 << 0,
  Async:     1 << 1,
  Generator: 1 << 2,
  Static:    1 << 3,
  Abstract:  1 << 4,
  Readonly:  1 << 5,
  Optional:  1 << 6,
  Private:   1 << 7,
  Protected: 1 << 8,
  Public:    1 << 9,
};

// Check flags with bitwise AND
if (symbol.flags & SymbolFlags.Exported) { /* ... */ }
if (symbol.flags & SymbolFlags.Async) { /* ... */ }
```

---

## Related Documentation

- [Semantic Index Architecture](./semantic-index) -- architecture overview with diagrams
- [Creating Language Adapters](./creating-language-adapters) -- adding new language support
- [Cross-File Analysis Rules](./cross-file-analysis) -- examples of rules using ProjectIndex
