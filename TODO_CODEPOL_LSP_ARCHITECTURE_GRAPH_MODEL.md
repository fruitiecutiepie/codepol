# Codepol Architecture Graph Model

This companion note expands the architecture / dependency-graph surface referenced in `TODO_CODEPOL_LSP.md` and `TODO_CODEPOL_LSP_CAPABILITY_MATRIX.md`. It captures the current state of the "architecture links / dependency graph" features, decisions for expansion, and drafted interfaces at each layer (core, workspace service, LSP, policy, CLI, UI) so the work can be sequenced and picked up without re-discovering context.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for the architecture-graph-specific model, contracts, policy-rule hooks, and UX expansions.

## When To Read This

Read this note when you are:

- expanding `WorkspaceDependencyGraphResult`, `WorkspaceArchitectureSummaryResult`, or the `ArchitectureLinksPanel` view model
- adding graph-based queries (impact radius, path, diff, dead modules) to the workspace service
- turning the module graph into a first-class policy surface (layer violations, cycle rules, coupling budgets)
- exposing call graph, type hierarchy, or package-level roll-ups through LSP or the extension
- adding CLI `graph` subcommands or CI integration that emits graph diffs per PR
- deciding between file / directory / package / symbol granularity for a new feature

## Guiding Rules

- design interfaces before implementation; each addition below lists its contract first
- hide implementation details behind the existing `ModuleGraph` interface — consumers should not reach into `IndexStore`
- one module per job: queries, checks, renderers, CLI commands, and diagnostics each live in their own file
- do not refactor `moduleGraph.ts`, `index.ts`, or the panel rendering pipeline unless a listed task explicitly requires it
- additive-only: new fields on `WorkspaceDependencyGraphNode` / `Edge` must be optional so older clients keep working
- no global mutable state; any graph caches live on `ProjectIndex` the same way `ModuleGraph` already does

## Current State Snapshot

### Core: `ModuleGraph`

File: `packages/core/src/index/moduleGraph.ts`

```25:60:packages/core/src/index/moduleGraph.ts
export type ModuleGraph = {
  moduleGraphImportersGet(file: string): string[];
  moduleGraphImporteesGet(file: string): string[];
  moduleGraphDependencyOrderGet(): string[];
  moduleGraphCyclesGet(): string[][];
  moduleGraphEntryPointsGet(): string[];
};
```

Exposed on `ProjectIndex` as `moduleImportersGet`, `moduleImporteesGet`, `moduleDependencyOrderGet`, `moduleCyclesGet`, `moduleEntryPointsGet`. Built from `ImportBindingRelation.resolvedModulePath` and `ImportsRelation.resolvedModulePath`. External / unresolved specifiers are dropped.

Related index capabilities that are available today but **not** exposed in the workspace contract:

- `callersGet(symbolId)` / `calleesGet(symbolId)` — call graph edges
- `typeRelationsGet(symbolId)` / `subTypesGet(symbolId)` — type hierarchy edges
- `cyclomaticComplexityGet(symbolId)` — per-function complexity

### Workspace service contract

File: `packages/workspace-service/src/contracts.ts`

- `queryDependencyGraph` returns `WorkspaceDependencyGraphResult`
- `queryArchitectureSummary` returns `WorkspaceArchitectureSummaryResult`

```428:461:packages/core/src/workspace/workspaceTypes.ts
export type WorkspaceDependencyGraphResult = {
  nodes: WorkspaceDependencyGraphNode[];
  edges: WorkspaceDependencyGraphEdge[];
  entryPoints: string[];
  cycles: string[][];
};

export type WorkspaceArchitectureSummaryResult = {
  summary: string;
  indexedFileCount: number;
  symbolCount: number;
  scopeCount: number;
  relationCount: number;
  entryPointCount: number;
  cycleCount: number;
  hotspots: WorkspaceArchitectureSummaryHotspot[];
};
```

Nodes carry only `{ uri, workspaceRelativePath }`. Edges carry only `{ fromUri, toUri }`. There is no import-kind, no cross-package flag, no per-file metrics, and no granularity other than "file".

### Extension UI

- `ArchitectureLinksPanel` and `DependencyGraphPanel` in `extension-vscode/src/panels/render.ts`
- View models in `extension-vscode/src/viewModels.ts` (`architectureLinksPanelViewModelCreate`, `dependencyGraphPanelViewModelCreate`)
- SVG render + micro fallback with no filters, no layout modes, no zoom/pan, no interactive focus swap

### Policy surface

- No built-in architecture rule today
- `docs/cross-file-analysis.md` shows the user-land pattern for a `circularDepsCheck` plugin rule using `moduleCyclesGet()`
- Policy providers receive `projectIndex` via `treeCheckProvider`; there is no dedicated architecture capability

## Decisions

- **File-level graph stays the primitive.** All other granularities are roll-ups on top of `ModuleGraph`, not new indexes.
- **Enrich, don't replace.** Add optional fields to `WorkspaceDependencyGraphNode` / `Edge` instead of introducing parallel types.
- **Narrow queries are first-class.** Engineers ask "what breaks if I change X?", not "give me the whole graph". The panel becomes one client among many.
- **Architecture becomes a plugin capability.** Policy authors write architecture checks through `ArchitectureCheckProvider`, not by abusing `treeCheckProvider`.
- **Cycles and dead modules surface as diagnostics.** The information already exists; it should participate in the normal diagnostic pipeline, clickable to the panel.
- **CLI and CI are equal citizens to the panel.** A `codepol graph` subcommand family produces the same data the panel renders.
- **Call graph and type hierarchy share the graph panel family.** They do not get bespoke panels in MVP.
- **No layout library in core.** Layout stays in the renderer; the workspace service returns topology only.

## Non-goals

- replacing `tsserver` / `Pylance` / `Pyright` as the source of language-level structure
- building a general-purpose graph database on top of the index
- shipping a force-directed WebGL renderer in MVP; SVG + optional layered layout is enough
- modeling runtime dependencies, DI graphs, or data-flow graphs — this work is strictly about import / call / type structure already derivable from the tree-sitter index

## Drafted Interfaces

### 1. Enriched node / edge metadata

File-level result type (additive):

```ts
export type WorkspaceDependencyGraphNodeMetrics = {
  importerCount: number;
  importeeCount: number;
  symbolCount: number;
  loc?: number;
  aggregateCyclomaticComplexity?: number;
  isEntryPoint: boolean;
  isInCycle: boolean;
};

export type WorkspaceDependencyGraphNode = {
  uri: string;
  workspaceRelativePath: string;
  metrics?: WorkspaceDependencyGraphNodeMetrics;
  layer?: string;
  packageName?: string;
};

export type WorkspaceDependencyGraphEdgeKind =
  | 'static'
  | 'dynamic'
  | 'side_effect'
  | 'cjs'
  | 'type_only';

export type WorkspaceDependencyGraphEdge = {
  fromUri: string;
  toUri: string;
  kind?: WorkspaceDependencyGraphEdgeKind;
  bindingCount?: number;
  crossesPackageBoundary?: boolean;
  crossesLayerBoundary?: boolean;
};
```

Core-side hook (additive, on `ModuleGraph` or a sibling helper):

```ts
export type ModuleEdgeInfo = {
  kind: WorkspaceDependencyGraphEdgeKind;
  bindingCount: number;
};

export type ModuleGraphEdgeInfo = {
  moduleEdgeInfoGet(from: string, to: string): ModuleEdgeInfo | undefined;
};
```

`layer` and `packageName` are computed at the workspace layer, not the core, from `codepol.toml` layer config plus `pnpm-workspace.yaml` / `package.json` boundaries.

### 2. Granularity and graph queries

Single contract, parameterized by granularity, bounded by default:

```ts
export type GraphGranularity = 'file' | 'directory' | 'package' | 'layer';

export type QueryDependencyGraphInput = {
  clientSessionId: ClientSessionId;
  workspaceId: string;
  granularity?: GraphGranularity;    // default 'file'
  focusUri?: string;                 // neighborhood around this node
  depth?: number;                    // default: unbounded when focusUri absent, 2 when present
  includeExternal?: boolean;         // default false
  edgeKinds?: WorkspaceDependencyGraphEdgeKind[];
  requestId?: string;
  analysisGeneration?: number;
  signal?: AbortSignal;
};
```

Narrow queries (each has one job):

```ts
queryImpactRadius(input: {
  uri: string;
  direction: 'upstream' | 'downstream' | 'both';
  depth?: number;
}): Promise<WorkspaceDependencyGraphResult>;

queryDependencyPath(input: {
  fromUri: string;
  toUri: string;
  maxPaths?: number;      // default 5
}): Promise<{
  paths: string[][];
  shortestLength: number;
  truncated: boolean;
}>;

queryDependencyDiff(input: {
  baselineGeneration: number;
  currentGeneration: number;
}): Promise<{
  addedEdges: WorkspaceDependencyGraphEdge[];
  removedEdges: WorkspaceDependencyGraphEdge[];
  addedNodes: WorkspaceDependencyGraphNode[];
  removedNodes: WorkspaceDependencyGraphNode[];
  newCycles: string[][];
  removedCycles: string[][];
}>;

queryDeadModules(input: {
  entryPoints?: string[];   // default: policy-declared entries, else empty
}): Promise<{ unreachable: string[] }>;
```

Symbol-level (shares the same result shape so the panel can render it uniformly):

```ts
queryCallGraph(input: {
  symbolId: string;
  direction: 'callers' | 'callees' | 'both';
  depth?: number;
}): Promise<WorkspaceDependencyGraphResult>;

queryTypeHierarchy(input: {
  symbolId: string;
  direction: 'supertypes' | 'subtypes' | 'both';
  depth?: number;
}): Promise<WorkspaceDependencyGraphResult>;
```

All implementations sit on top of existing index capabilities (BFS/DFS on `moduleGraphImportersGet` / `calleesGet` / `typeRelationsGet`). No new index structure.

### 3. `ArchitectureCheckProvider` plugin capability

New capability sibling of `treeCheckProvider` in `packages/core/src/policy/policyTypes.ts`:

```ts
export type ArchitectureCheckContext = {
  cwd: string;
  policy: PolicyFile;
  projectIndex: ProjectIndex;
  moduleGraph: ModuleGraph;
  ruleArgs?: unknown;
};

export type ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
) => PolicyViolation[];

export type ArchitectureCheckProvider = {
  /** Optional language gate, same semantics as TreeCheckProvider */
  languages?: string[];
  check: ArchitectureCheckFn;
};

export type PolicyPluginCapabilities = {
  lintProviders?: LintProvider[];
  treeCheckProvider?: TreeCheckProvider;
  architectureCheckProvider?: ArchitectureCheckProvider;   // NEW
  fixProvider?: FixProvider;
  requiresProjectIndex?: boolean;
};
```

Wiring: when any matched rule declares `architectureCheckProvider`, the core must build `ProjectIndex` + `ModuleGraph` (it already does the former when `requiresProjectIndex` is true). `requiresProjectIndex` should be inferred implicitly from `architectureCheckProvider` being set so plugin authors do not have to set both.

Built-in rules to ship alongside the capability:

- `no-cycles` — emit one violation per cycle (deterministic file: first cycle member alphabetically)
- `max-cycle-size` — `args.max: number`
- `no-layer-violation` — `args.layers: Record<string, { allows?: string[]; denies?: string[] }>`; layer membership resolved by glob config per layer
- `no-cross-package-internal-import` — require cross-package imports to hit the declared public entry
- `max-fan-in` / `max-fan-out` — coupling budgets per file glob
- `dead-module` — files unreachable from declared entry points
- `entry-point-allowlist` — `args.entries: string[]` globs; violation when a file with zero importers is not in the list

All reuse `moduleGraph` / `projectIndex` data only. None requires new index work.

### 4. LSP / editor surfaces

No new LSP methods in MVP; all editor features route through workspace-service queries above.

- **CodeLens on imports/exports** — above an `export` declaration, show `N importers`; click routes to `queryImpactRadius({ direction: 'upstream', depth: 1 })` rendered in the graph panel.
- **Hover enrichment** — on an `import` specifier, attach a Codepol hover card with `{ importerCount, importeeCount, edgeKind, crossesLayerBoundary }`. Must respect `TODO_CODEPOL_LSP_HOVER_MODEL.md` rules — editor-text hover requires explicit Codepol identity.
- **Peek architecture command** — `codepol.architecture.peek` opens `ArchitectureLinksPanel` focused on the symbol under cursor (not only the file). Backed by `queryCallGraph` / `queryTypeHierarchy` when the cursor resolves to a symbol, else `queryImpactRadius`.
- **Editor decorations on cycle members** — gutter marker on the first line of every file in `moduleCyclesGet()`; hover of the marker lists the cycle. Must live under a user-togglable setting (`codepol.diagnostics.showCycleDecorations`) because it is always-on signal.
- **Rename / move preview enrichment** — the existing rename pipeline adds a line of the form `This change crosses N new cross-package edges` by calling `queryDependencyDiff` against a simulated generation. Blocked until rename preview has a speculative-index hook; tracked as a dependency, not part of MVP.

### 5. CLI `graph` subcommand family

Exposed by `apps/cli`, all delegating to the workspace service:

```
codepol graph export [--format dot|mermaid|graphml|json] [--granularity file|dir|package|layer]
codepol graph cycles [--max <n>] [--format json|text]
codepol graph path <fromGlob> <toGlob> [--max-paths <n>]
codepol graph fan-in <fileGlob> [--top <n>]
codepol graph fan-out <fileGlob> [--top <n>]
codepol graph dead [--entry <glob> ...]
codepol graph diff <baseRef> [--format json|text]
```

Output conventions:

- default output is human-readable text sorted deterministically
- `--format json` emits the same shape as the matching workspace query result
- non-zero exit on `graph cycles`, `graph dead`, `graph diff --fail-on-new-cycle` so CI can gate PRs

CI flow: `codepol graph diff $GITHUB_BASE_REF --format json` produces the payload that a PR-comment bot renders. The bot lives outside this repo; the CLI just emits the artifact.

### 6. Panel UX expansions

All additive on the existing `ArchitectureLinksPanel` / `DependencyGraphPanel`:

- filter chips: edge kind, cross-package only, cross-layer only, include/exclude test files
- layout modes: `force` (current SVG behavior), `layered` (Sugiyama), `radial` (around `focusUri`)
- interaction: click a node → rebroadcast `codepol.architecture.peek` focused on that node
- blast-radius mode: select a node, dim all non-reachable nodes, compute client-side from the already-fetched subgraph
- diff mode: renders the output of `queryDependencyDiff` with `added` in one color and `removed` in another
- drill-down: clicking a package node in `granularity: package` opens a new panel at `granularity: file` scoped to that package

Viewmodel additions (additive):

```ts
export type DependencyGraphPanelViewModel = {
  // existing fields...
  granularity?: GraphGranularity;
  activeFilters?: {
    edgeKinds?: WorkspaceDependencyGraphEdgeKind[];
    crossPackageOnly?: boolean;
    crossLayerOnly?: boolean;
    hideTests?: boolean;
  };
  layoutMode?: 'force' | 'layered' | 'radial';
  diff?: {
    addedEdgeIds: string[];
    removedEdgeIds: string[];
  };
};
```

### 7. Metrics / health on `ArchitectureSummary`

Additive fields on `WorkspaceArchitectureSummaryResult`:

```ts
export type WorkspaceArchitectureSummaryResult = {
  // existing fields...
  instability?: { uri: string; value: number }[];       // Ce / (Ca + Ce)
  longestChain?: { length: number; path: string[] };
  sccSizeDistribution?: Record<number, number>;          // size -> count
  complexityHotspots?: {
    uri: string;
    aggregateCyclomaticComplexity: number;
    importerCount: number;
  }[];
};
```

All computable from `ProjectIndex` + `ModuleGraph`. Clients that don't consume the new fields must keep working.

### 8. Diagnostics integration

A narrow adapter in `packages/workspace-service` converts `moduleGraph.moduleGraphCyclesGet()` and `queryDeadModules` into `WorkspaceDiagnostic[]` under a new diagnostic source (e.g. `codepol/architecture`). Rules:

- one diagnostic per cycle, emitted on the alphabetically-first file of the cycle, range line 1
- one diagnostic per dead module, emitted on line 1
- severity configurable per policy rule (defaults to `info`)
- diagnostics include a `data` payload with `{ kind: 'architecture-cycle' | 'architecture-dead', members: string[] }` so code actions can open the panel

Respects existing diagnostic subscription machinery; no new subscription scope.

## Phased Sequencing

Each phase is independently shippable, additive, and testable.

### Phase 1: Enrich node / edge data (unblocks everything else)

- add optional `metrics`, `layer`, `packageName` on `WorkspaceDependencyGraphNode`
- add optional `kind`, `bindingCount`, `crossesPackageBoundary`, `crossesLayerBoundary` on `WorkspaceDependencyGraphEdge`
- add `ModuleGraphEdgeInfo` helper in core, driven by `ImportBindingRelation` + `ImportsRelation`
- workspace-service populates layer / package fields from config; core only fills structural fields
- update `workspaceDependencyGraphResultCreate` in `packages/workspace-service/src/index.ts`
- tests: unit coverage for each new field, including dynamic and side-effect import edges

### Phase 2: Narrow graph queries

- `queryImpactRadius`, `queryDependencyPath`, `queryDeadModules`
- BFS / DFS helpers live in a new module `packages/core/src/index/moduleGraphQueries.ts`; `moduleGraph.ts` remains focused on construction
- contracts added to `packages/workspace-service/src/contracts.ts`, wired through daemon + LSP adapters
- tests: shortest-path correctness, cycle-tolerant reachability, bounded-depth behavior

### Phase 3: Policy capability

- new `ArchitectureCheckProvider` capability in `policyTypes.ts`
- runner module `packages/core/src/policy/policyArchitectureCheck.ts` (mirrors `policyTreeCheck.ts`)
- ship `no-cycles`, `no-layer-violation`, `dead-module` under `@codepol/plugin`
- `codepol.toml` schema update + docs example in `docs/cross-file-analysis.md`
- tests: per-rule spec + one end-to-end policy spec exercising the capability

### Phase 4: CLI graph subcommands

- `apps/cli/src/graph/*.ts`, one file per subcommand
- JSON output shape equals the workspace query result exactly
- integration test per subcommand using the existing CLI test harness

### Phase 5: Editor surfaces

- CodeLens provider + hover provider consuming `queryImpactRadius`
- panel filter chips, layout modes, blast-radius interaction
- "peek architecture" command on symbols
- tests: view-model spec + panel render spec per new feature

### Phase 6: Diff and diagnostics

- `queryDependencyDiff` (requires baseline index persistence — coordinate with `packages/core/src/index/TODO.md`)
- `codepol/architecture` diagnostic source for cycles and dead modules
- CLI `graph diff` subcommand, gated by `--fail-on-new-cycle`

### Phase 7: Symbol-level graphs

- `queryCallGraph`, `queryTypeHierarchy`
- panel reuse: same render, different underlying query
- tests: call-graph correctness across re-exports and dynamic dispatch is not expected from MVP — document the known gap

### Phase 8: Metrics additions

- extend `WorkspaceArchitectureSummaryResult` with `instability`, `longestChain`, `sccSizeDistribution`, `complexityHotspots`
- extend hotspot card in the panel
- tests: determinism + stability under incremental updates

## Open Questions

- **Baseline persistence for diff.** `queryDependencyDiff` requires storing or recomputing a prior generation. Options: piggyback on index persistence in `packages/core/src/index/TODO.md`, or add a lightweight graph-only snapshot. Decision deferred to Phase 6 kickoff.
- **Layer config schema.** Where do layer definitions live in `codepol.toml`? Candidates: `[layers.<name>]` with `files` + `allows` + `denies`, or a dedicated `[[layerRules]]` block. Must be reviewed against the existing rule-target schema to avoid shape drift.
- **Test-file semantics.** Do test files count toward fan-in / fan-out and dead-module detection? Default: excluded via the existing target exclude globs; panel filter toggle is additive.
- **External package representation.** MVP excludes externals. A future mode could collapse all external imports into a single `external:<name>` node for visualizing third-party coupling. Not in MVP.
- **Call graph fidelity.** `callersGet` / `calleesGet` from `ProjectIndex` does not model dynamic dispatch or higher-order functions. Document the gap when Phase 7 ships; do not attempt to close it in MVP.
- **Cycle diagnostic volume.** Large legacy codebases can have thousands of cycles. Add a `maxCycles` policy arg with deterministic truncation before surfacing as diagnostics.

## Related Documents

- `TODO_CODEPOL_LSP.md` — top-level architecture and rollout
- `TODO_CODEPOL_LSP_CAPABILITY_MATRIX.md` — per-language ownership boundary
- `TODO_CODEPOL_LSP_HOVER_MODEL.md` — hover invocation rules that constrain hover enrichment in Phase 5
- `TODO_CODEPOL_LSP_DEFINITION_REFERENCES_MODEL.md` — definition / references boundary
- `packages/core/src/index/TODO.md` — index persistence, incremental updates, baseline storage (prerequisite for Phase 6 diff)
- `docs/cross-file-analysis.md` — existing user-land pattern superseded by `ArchitectureCheckProvider` in Phase 3
- `docs/semantic-index.md` — underlying index architecture
