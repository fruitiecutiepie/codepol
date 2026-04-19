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

### Phase 2: Narrow graph queries — _done_

- `queryImpactRadius`, `queryDependencyPath`, `queryDeadModules`
- BFS / DFS helpers live in a new module `packages/core/src/index/moduleGraphQueries.ts`; `moduleGraph.ts` remains focused on construction
- contracts added to `packages/workspace-service/src/contracts.ts`, wired through daemon + LSP adapters
- tests: shortest-path correctness, cycle-tolerant reachability, bounded-depth behavior
- landed:
  - core helpers: `moduleImpactRadiusCompute` (BFS, upstream/downstream/both, bounded depth), `moduleDependencyPathCompute` (BFS shortest length + DFS simple-path enumeration capped at `maxPaths`, cycle-tolerant), `moduleDeadModulesCompute` (forward reachability from natural or caller-supplied entry points)
  - workspace contract: `queryImpactRadius` reuses `WorkspaceDependencyGraphResult`; `queryDependencyPath` / `queryDeadModules` introduce `WorkspaceDependencyPathResult` / `WorkspaceDeadModulesResult` with URI paths; daemon round-trip + LSP adapters (`codepol/impactRadius`, `codepol/dependencyPath`, `codepol/deadModules`) are in place
  - tests: `tests/index.module-graph-queries.spec.ts` (17 unit cases on in-memory graphs) plus workspace-service integration cases and a daemon round-trip case under the existing read-RPC spec

### Phase 3: Policy capability — _done_

- new `ArchitectureCheckProvider` capability in `policyTypes.ts`
- runner module `packages/core/src/policy/policyArchitectureCheck.ts` (mirrors `policyTreeCheck.ts`)
- ship `no-cycles`, `no-layer-violation`, `dead-module` under `@codepol/plugin`
- `codepol.toml` schema update + docs example in `docs/cross-file-analysis.md`
- tests: per-rule spec + one end-to-end policy spec exercising the capability
- landed:
  - core types: `ArchitectureCheckProvider`, `ArchitectureCheckContext`, `ArchitectureCheckFn`, `architectureCheckProviderSupportsLanguage`, `pluginCapabilitiesRequireProjectIndex`; `architectureCheckProvider` field on `PolicyPluginCapabilities` (additive — implicitly forces `requiresProjectIndex`)
  - runner: `policyArchitectureViolationsGetFromDir` is wired into `policyCheck`; result type carries new optional `architectureViolations` field while keeping `treeViolations` populated for back-compat
  - `ProjectIndex → ModuleGraph` adapter (`moduleGraphFromProjectIndex`) so checks stay on the public index surface
  - built-ins: `noCyclesRule`, `deadModuleRule`, `noLayerViolationRule` (with typed `args` schemas: `NoCyclesArgs`, `DeadModuleArgs`, `NoLayerViolationArgs`); registered in `@codepol/plugin` default export
  - `no-cycles` deterministically ranks cycles `(-size, alphabetical first member)`, anchors on first member, lists the rest in `relatedLocations`, and emits a summary violation when truncated by `maxCycles`
  - `no-layer-violation` resolves layer membership by most-specific glob, ignores edges to/from unclassified files, reports ambiguous layer assignments as their own violation
  - `dead-module` runs `moduleDeadModulesCompute` against natural or `args.entries` glob roots, supports `args.ignore`, returns zero violations when an explicit entry glob matches nothing (typo-safety)
  - tests: `noCyclesCheck.spec.ts` (5), `deadModuleCheck.spec.ts` (5), `noLayerViolationCheck.spec.ts` (6), `tests/architecture-policy.spec.ts` end-to-end policy spec exercising all three rules through `policyCheck`

### Phase 4: CLI graph subcommands — _done_

- `apps/cli/src/graph/*.ts`, one file per subcommand
- JSON output shape equals the workspace query result exactly
- integration test per subcommand using the existing CLI test harness
- landed:
  - one file per subcommand under `apps/cli/src/graph/`: `graphExport.ts`, `graphCycles.ts`, `graphPath.ts`, `graphDead.ts`, `graphFanIn.ts`, `graphFanOut.ts`, `graphImpact.ts`; shared helpers in `graphOutputFormat.ts`, `graphPathResolve.ts`, `graphWorkspaceResolve.ts`
  - wired under `codepol graph <subcommand>` via `graphCommand.ts`; each subcommand calls one workspace-service query and emits JSON identical to the corresponding `WorkspaceDependency*Result` type by default (`--format text` for humans)
  - graph subcommands run against an in-process `WorkspaceService` per invocation; daemon-backed graph queries (shared warm graph) are deferred — tracked in Phase 6 alongside diff/baseline work
  - `codepol graph cycles` / `graph dead` exit non-zero when results are non-empty so CI can gate PRs directly; `graph path` exits non-zero when no path exists
  - `graph cycles --max <n>` truncates using a deterministic `(-size, first member)` ranking with a `truncated: boolean` payload flag
  - `graph dead --entry <path>` (repeatable) overrides the natural entry point set; each value is resolved to a `file://` URI via the workspace cwd before the workspace-service call
  - `graph fan-in [file]` / `graph fan-out [file]` rank nodes by `importerCount` / `importeeCount` with `--top <n>` (default 20); supplying a file restricts output to that file
  - `graph impact <file>` exposes `queryImpactRadius` with `--direction upstream|downstream|both` and `--depth <n>` so panels and CLI share one payload shape
  - tests: `tests/e2e.cli.graph.spec.ts` runs the built CLI as a subprocess for each subcommand (10 cases) — happy path + non-zero exit paths + entry override — asserting JSON shape parity with the workspace contract
  - existing `codepol` (policy check) flow is unchanged; graph dispatch short-circuits `main()` when `argv._[0] === 'graph'`

### Phase 5: Editor surfaces — _partial; hover deferred_

- CodeLens provider + hover provider consuming `queryImpactRadius`
- panel filter chips, layout modes, blast-radius interaction
- "peek architecture" command on symbols
- tests: view-model spec + panel render spec per new feature
- landed:
  - extension protocol client now exposes `queryImpactRadius`, `queryDependencyPath`, `queryDeadModules` so editor surfaces can call the narrow Phase 2 queries directly (`extension-vscode/src/protocolClient.ts`)
  - `CodepolArchitectureCodeLensProvider` (`extension-vscode/src/codeLensProvider.ts`) registers a single CodeLens at the head of each `file://` document; it hits `queryImpactRadius({ direction: 'both', depth: 1 })` and renders `Codepol: N importers • M importees` whose click invokes `codepol.architecture.peek` on the focus URI. The lens body is a pure helper (`extension-vscode/src/codeLensViewModels.ts → architectureCodeLensViewModelCreate`) so the formula is unit-testable without a vscode runtime
  - new `codepol.architecture.peek` command (`extension-vscode/src/extension.ts`, manifest entry + activation event) routes to `CodepolCommandController.peekArchitecture`, which fetches `queryImpactRadius` for the focus URI and feeds the impact-radius subgraph into `ArchitectureLinksPanel` (defaulting to the `radial` layout so the focus stays centered)
  - `DependencyGraphPanelViewModel` / `ArchitectureLinksPanelViewModel` now carry `controls`, `filters`, `layoutMode`, `blastRadiusUri`. `dependencyGraphPanelViewModelCreate` / `architectureLinksPanelViewModelCreate` apply filters (boolean chips: `crossPackageOnly`, `crossLayerOnly`, `hideTests`; multi-select edge-kind chips), switch between `layered` / `radial` / `force` layouts, and BFS the filtered graph from `blastRadiusUri` to mark unreachable nodes / edges as `isDimmed`
  - panel render gained a controls strip (`graphControlsHtml`) that emits `data-control-filter`, `data-control-edge-kind`, `data-control-layout`, `data-control-blast-radius` buttons + a blast-radius row; SVG nodes carry `data-blast-radius-uri` so an Alt-click selects the blast-radius origin; node / edge `dimmed` styling lives in the panel CSS
  - panel manager (`extension-vscode/src/panels/manager.ts`) tracks per-panel control state plus a rebuilder closure handed in by `CodepolCommandController`; control-message updates run through `dependencyGraphControlStateUpdate` (`extension-vscode/src/panels/controls.ts`), call the rebuilder, and re-render in place — no extra LSP round-trips per filter toggle
  - tests: `tests/extension-vscode.architecture-graph-controls.spec.ts` (10 cases) covers control-state reducer behavior, filter / layout / blast-radius effects on view models, and the `architectureCodeLensViewModelCreate` formula; `tests/extension-vscode.panels-render.spec.ts` adds a control-strip render assertion; `tests/extension-vscode.commands.spec.ts` adds two `peekArchitecture` cases (happy path through `queryImpactRadius`; missing-active-file rejection); existing view-model and render fixtures updated to match the additive panel shape
- deferred:
  - hover provider gated by Codepol-owned identity markers — the `TODO_CODEPOL_LSP_HOVER_MODEL.md` rules require an extension-owned decoration on the hovered range before Codepol can return a hover, and that marker pipeline does not exist yet. The CodeLens already counts as explicit Codepol identity, but it does not anchor a text range on the import specifier, so adding a hover provider here would either inherit the wrong identity context or duplicate the editor's existing hover. Shipping the hover provider is folded into a later task that introduces the import-specifier marker layer
  - cycle-member gutter decorations and the `codepol.diagnostics.showCycleDecorations` setting — these belong with the `codepol/architecture` diagnostic source and are tracked under Phase 6 / Phase 8

### Phase 6: Diff and diagnostics — _done_

- `queryDependencyDiff` (requires baseline index persistence — coordinate with `packages/core/src/index/TODO.md`)
- `codepol/architecture` diagnostic source for cycles and dead modules
- CLI `graph diff` subcommand, gated by `--fail-on-new-cycle`
- landed:
  - core diff helper `moduleDependencyDiffCompute` plus shared `GraphSnapshot` / `ModuleDependencyDiffResult` types in `packages/core/src/index/moduleGraphDiff.ts`. Cycles are diffed via canonical-form sets so member rotation does not produce false positives; nodes/edges/cycles are sorted deterministically so identical inputs produce byte-identical JSON
  - `GraphSnapshotStore` interface in `packages/workspace-service/src/graphSnapshotStore.ts` with the file-system sidecar implementation `fileSystemGraphSnapshotStoreCreate` (Q1 option B). Snapshots live under `<rootPath>/.codepol/graph-snapshots/<label>.json` and are written via `rename`-after-tmp atomicity. `graphSnapshotLabelSanitize` rejects empty / traversal labels so a CI value like `feature/foo` cannot escape the snapshot directory. The Q1 option D in-memory ring buffer slot is reserved behind the same interface for a follow-up
  - workspace contract `queryDependencyDiff` accepts exactly one of `baselineLabel` (sidecar lookup, validates `workspaceRootId` matches) or `baselineGraph` (inline payload from `codepol graph export`). Result type `WorkspaceDependencyDiffResult` echoes the baseline label, the current/baseline `analysisGeneration`, and the deterministic add/remove/cycle lists
  - daemon round-trip wired (`query_dependency_diff` request/ack, queue-key + priority + supersession parity with the other graph queries) plus the `codepol/dependencyDiff` LSP adapter and `extension-vscode/src/protocolClient.ts → queryDependencyDiff`
  - architecture diagnostics analyzer `workspaceArchitectureDiagnosticsRun` runs the `architectureCheckProvider` pipeline against the live `ProjectIndex` and emits `WorkspaceDiagnostic[]` under the new published source `WORKSPACE_ARCHITECTURE_DIAGNOSTIC_SOURCE = 'codepol/architecture'`. Severity defaults to `info` when the policy rule omits one (matches the Q6 default) and follows the rule's `severity` field otherwise. The analyzer is gated by `workspaceArchitectureDiagnosticsShouldRun(matches, pluginRulesMap, projectIndex)` so workspaces without any matched architecture rule skip the async hop entirely — preserves the diagnostic-publish ordering the manual-timer LSP tests assume. `matchedRulesRequireProjectIndex` now also forces the index when an arch provider is matched (closing a Phase 3 wiring gap noted in `policyTypes.ts → pluginCapabilitiesRequireProjectIndex`)
  - CLI: `codepol graph snapshot [--label <name>]` writes the live graph through the sidecar store (default label `base`); `codepol graph diff [<label>] [--baseline-label <name> | --baseline-file <path>] [--fail-on-new-cycle]` round-trips the diff and exits non-zero when `--fail-on-new-cycle` is set and the diff added a cycle. `--baseline-file` accepts either a `GraphSnapshot` or a raw `WorkspaceDependencyGraphResult` so CI scripts can feed `codepol graph export` output directly without touching the snapshot directory
  - tests:
    - `tests/index.module-graph-diff.spec.ts` (7 unit cases on snapshot fakes — equality, additions/removals, cycle canonicalization, sort determinism, surviving `workspaceRelativePath` fallback)
    - `tests/workspace-service.graph-snapshot-store.spec.ts` (8 cases: write/read round-trip, missing-label `undefined`, list/delete semantics, label sanitization, deterministic snapshot field ordering)
    - `tests/workspace-service.architecture-graph-diff.spec.ts` (8 integration cases through `WorkspaceServiceEngine`: empty/added-edge/cycle diffs against inline + sidecar baselines, both-baselines rejected, cross-workspace `workspaceRootId` rejected, cycle and dead-module diagnostics emitted under `codepol/architecture`, no diagnostics emitted when no arch rule is matched)
    - `tests/e2e.cli.graph.spec.ts` adds 4 e2e cases for `graph snapshot` + `graph diff` (sidecar write, empty diff against label, `--fail-on-new-cycle` exit code, `--baseline-file` accepts `graph export` output)

### Phase 7: Symbol-level graphs — _done_

- `queryCallGraph`, `queryTypeHierarchy`
- panel reuse: same render, different underlying query
- tests: call-graph correctness across re-exports and dynamic dispatch is not expected from MVP — document the known gap
- landed:
  - core helpers `symbolCallGraphCompute` / `symbolTypeHierarchyCompute` in `packages/core/src/index/symbolGraphQueries.ts`. Both are pure BFS traversals against minimal `SymbolCallGraphView` / `SymbolTypeHierarchyView` interfaces (single-method-per-direction views), bounded by `depth`, cycle-tolerant via a visited set, and deterministic (sorted symbols + edges sorted by `(from, to)`). Edges are oriented by data flow regardless of traversal direction: call-graph edges always emit `from = caller`, `to = callee`; type-hierarchy edges always emit `from = subtype/child`, `to = supertype/parent`. The helpers never reach into `IndexStore` — the workspace layer is the only place that adapts a `ProjectIndex` to these views
  - workspace contract `queryCallGraph` / `queryTypeHierarchy` reuse `WorkspaceDependencyGraphResult` so the panel can render symbol graphs with the same code path used for the file-level dependency graph. Nodes carry the synthetic URI `codepol-symbol://<encodedSymbolId>` (so panel `uri`-as-key invariants stay intact even when several symbols live in the same file) plus optional additive fields on `WorkspaceDependencyGraphNode`: `symbolId`, `symbolName`, `symbolKind`, `declarationUri`, `declarationRange`. Older clients that read only `uri` / `workspaceRelativePath` keep working unchanged. `workspaceRelativePath` is `<file-relative-path>::<symbolName>` for symbol nodes so the panel renders a human-readable label. `entryPoints` and `cycles` are always empty for symbol-level graphs — those concepts are file-graph-only
  - workspace types `WorkspaceCallGraphDirection` (`callers | callees | both`) and `WorkspaceTypeHierarchyDirection` (`supertypes | subtypes | both`) mirror the core direction strings one-for-one so callers can pass them straight through
  - workspace-service engine wires `queryCallGraph` and `queryTypeHierarchy` through `workspaceCallGraphResultCreate` / `workspaceTypeHierarchyResultCreate`. The call-graph adapter delegates straight to `ProjectIndex.callersGet` / `calleesGet`. The type-hierarchy adapter resolves `superTypesGet` from `ProjectIndex.typeRelationsGet` (taking only relations whose `resolvedTargetId` is set) and `subTypesGet` from `ProjectIndex.subTypesGet` filtered to relations whose `resolvedTargetId === symbolId` — so name-only matches that did not resolve are dropped to keep edges precise
  - daemon round-trip wired (`query_call_graph` / `query_type_hierarchy` request/ack pairs, queue-key + `medium` priority parity with the other graph queries; both ack types added to `WorkspaceDaemonServiceResponse`) plus the LSP adapters `codepol/callGraph` / `codepol/typeHierarchy` and the corresponding `extension-vscode/src/protocolClient.ts → queryCallGraph` / `queryTypeHierarchy`
  - tests:
    - `tests/index.symbol-graph-queries.spec.ts` — 13 unit cases over in-memory views: callee/caller/both directions, depth-bounded traversal, cycle tolerance (mutual recursion + pathological self-extends), edge orientation invariant (callers walk still emits caller→callee edges)
    - `tests/workspace-service.symbol-graph.spec.ts` — 3 integration cases through `WorkspaceServiceEngine`: unknown-id seed-only stub for both queries, plus a round-trip case that confirms feeding the returned `symbolId` back into the same query yields the identical node URI. Symbol-id discovery from the public surface is intentionally not tested: the workspace service does not expose a "lookup symbol id by name" entry point, and that gap is documented in the test header
    - daemon round-trip test (`packages/workspace-service/src/daemon.spec.ts → "serves workspace symbol, graph, semantic search, semantic navigation, and architecture summary RPCs through the daemon service client"`) extended with a Phase 7 block that exercises both new RPCs through the daemon transport
- known gaps (carried as Q5 in this note's open questions):
  - ~~dynamic dispatch and higher-order calls are not tracked.~~ **Closed (Phase 9.1 / 9.2).** By default the call graph is still structural (direct, name-resolved invocations only). Higher-order flow (`function passed as argument`) is exposed *separately* via `querySymbolFlow` so the structural call graph never silently invents call edges for argument flow. When a `TypeAwareCallGraphSource` is registered for the language, the workspace merges its edges into the call graph: overlapping edges are tagged `callGraphConfidence: 'type-aware'`, type-aware-only edges are added, and structural edges the source did not return are preserved (`type-aware never demotes structural`). Anonymous callable values stored in data structures and inline-lambda flow remain known limitations of the structural extractor — a `TypeAwareCallGraphSource` binding is the path forward when those matter.
  - ~~calls that flow through re-exports are not resolved.~~ **Closed.** Two coordinated changes land cross-file call resolution:
    - `crossFileResolve` (and the per-file companion `crossFileResolveForFile`) gain a Step 5b that walks each file's import bindings and rewrites unresolved `Calls.resolvedSymbolId` to the binding's `resolvedExportId`. `exportMapAddReexportedSymbols` already collapses re-export hops into `binding.resolvedExportId`, so a single rewrite per call site is enough — no chain following inside the resolver. File-local function/method resolution from the adapter still wins (the rewrite skips already-resolved calls), preserving ECMAScript shadowing semantics when a same-file declaration shares a name with an import.
    - `ProjectIndex` gains `symbolCanonicalIdGet(symbolId)`. It walks the import-binding chain (one hop in the common case after `exportMapAddReexportedSymbols`, with visited-set protection for pathological inputs) and returns the canonical declaration id. Idempotent for declarations. Cached per `ProjectIndex` instance, which the workspace service already rebuilds on store mutations. `callersGet` / `calleesGet` normalize their input and the result through this helper, so callers that pass the local re-export proxy id (e.g., the import-binding symbol in the consuming file) get the same answer as callers that pass the canonical declaration id, and the call graph reports one node per logical declaration regardless of how many re-export hops the call traversed.
    - Side-effect: `IndexStore.relationUpdate` learned how to keep `callsByScope` in sync when a `Calls` relation is rewritten — without this the per-scope index returned the stale relation while `callsGet` returned the new one, masking the rewrite from `calleesGet`.
    - Tests landed: `tests/index.symbol-canonical-id.spec.ts` (9 cases) covers idempotence, single-hop and multi-hop chain collapse, cross-file `callersGet` / `calleesGet`, input-normalization parity (proxy id ≡ canonical id), shadowing precedence, and an end-to-end `symbolCallGraphCompute` traversal over a re-export chain that confirms the symbol-level call graph the workspace service feeds the panel collapses hops the whole way through.
  - ~~structural typing is not modeled in type hierarchy.~~ **Closed (Phase 9.4 / 9.5).** Declared `extends` / `implements` are always tracked. With `includeStructural: true`, name+kind+arity shape matches are added with `typeRelationConfidence: 'structural-shape'`. When a `TypeAwareTypeHierarchySource` is registered for the language, type-aware implementers are added with `'type-aware'` and override shape matches on overlap. Anonymous structural targets and type-system-derived structural relationships (Pick / Omit / mapped types / generics) are out of scope and remain the language server's responsibility.
  - ~~symbol-id discovery is out of scope for MVP.~~ **Closed.** Two new workspace queries cover the gap end-to-end without mutating any existing API:
    - `querySymbolLookup({ name, kind?, scopeUri?, limit? })` returns `WorkspaceSymbolDescriptor[]` sorted by `(declarationUri, byteRange.start)` so call sites get a deterministic best match. Backed by `IndexStore.symbolsGet({ name, kind, file? })` with a single in-memory sort + slice; no traversal, no persistence change. Default `limit` is 50 (`WORKSPACE_SYMBOL_LOOKUP_LIMIT_DEFAULT` in `packages/workspace-service/src/index.ts`). The query never crosses re-export hops on its own — callers that care about the canonical declaration id chain `symbolCanonicalIdGet` (Phase 7 helper) on the returned `symbolId`.
    - `querySymbolAtPosition({ uri, position })` returns the smallest indexed symbol whose declaration byte range contains the editor cursor. Position is converted from LSP UTF-16 line/character coordinates to a UTF-8 byte offset by the new `workspacePositionToByteOffset` helper in `packages/core/src/workspace/workspaceTypes.ts` (the inverse of the existing `workspaceRangeFromByteRange`); the inner-most match wins so a click on a method body resolves to the method, not the enclosing class. Returns `{ symbol: undefined }` for unindexed files, malformed URIs, and cursor positions outside any declaration — matches the editor-surface "no result, no error" expectation.
    - Result type `WorkspaceSymbolDescriptor = { symbolId, name, kind, declarationUri, declarationRange }` deliberately mirrors the optional symbol fields on `WorkspaceDependencyGraphNode`, so a discovered descriptor flows straight into `queryCallGraph` / `queryTypeHierarchy` without translation. `WorkspaceSymbolDescriptorKind` is a string-literal union mirroring core `SymbolKind` one-for-one (the workspace surface keeps its own copy so consumers don't pull the core enum into their type imports).
    - LSP methods `codepol/symbolLookup` and `codepol/symbolAtPosition`, daemon round-trip on the same queue / priority lane as the other editor-driven reads (`high`), extension `protocolClient` methods `querySymbolLookup` / `querySymbolAtPosition` — same wiring shape as `querySemanticDefinition`. Editor surfaces (CodeLens / hover / peek) can stop walking file-level structures and call these directly. The Phase 5 hover work that's currently deferred unblocks once `querySymbolAtPosition` exists, because the import-specifier marker layer can use it to anchor to a symbol id without re-implementing resolution.
    - Tests landed: `tests/workspace-service.symbol-lookup.spec.ts` (11 cases — name lookup determinism, kind filter, file scope, limit truncation, empty / malformed inputs, three at-position cases for the inner-most-symbol rule, the unknown-file fallback, and a round-trip case that confirms a descriptor's `symbolId` feeds straight into `queryCallGraph` and yields a node with the matching `symbolName` / `symbolKind`). The daemon spec round-trip case (`packages/workspace-service/src/daemon.spec.ts → "serves workspace symbol, graph, semantic search, semantic navigation, and architecture summary RPCs through the daemon service client"`) was extended with a Phase-7-follow-up block that exercises both new RPCs through the daemon transport.

### Phase 8: Metrics additions

- extend `WorkspaceArchitectureSummaryResult` with `instability`, `longestChain`, `sccSizeDistribution`, `complexityHotspots`
- extend hotspot card in the panel
- tests: determinism + stability under incremental updates

## Open Questions

Each question lists the candidate options, trade-offs, and a proposed default. Defaults are opinionated to unblock Phase 6 / Phase 7 without prematurely locking more general decisions.

### Q1. Baseline persistence for diff

**Context.** `queryDependencyDiff` needs to compare the current module graph against a prior version. The index is in-memory today (`packages/core/src/index/TODO.md` item 2), so there is nothing to compare against across restarts or across a PR boundary.

**Option A — Piggyback on full index persistence.**
Wait for `packages/core/src/index/TODO.md` item 2 to ship (SQLite / binary format). Diff reads two snapshots and reruns `moduleGraphBuild`.

- Pros: single source of truth; any future feature (go-to-def-from-cache, cross-session symbol lookup) reuses the same store; historical snapshots fall out for free.
- Cons: couples Phase 6 to a large piece of work that is currently labeled *Effort: Large*; forces schema decisions (columnar vs blob, versioning, migration) before we know what diff actually needs.
- Failure mode: Phase 6 blocks on Phase-X persistence and never ships.

**Option B — Graph-only snapshot sidecar.**
Emit a compact JSON/CBOR file per generation containing only `{ nodes[], edges[], cycles[], entryPoints[], generation, rootPathHash }`. Written next to `.codepol/` cache. Read back by `queryDependencyDiff`.

- Pros: small blast radius (one writer, one reader); independent ship vehicle; file is human-inspectable, which helps CI debugging; rotates trivially (`keep last N`).
- Cons: becomes dead code if full index persistence ships later; duplicates some data already derivable from the index; must pick a stable serialization version immediately.
- Failure mode: divergent on-disk formats between this and a later general index store.

**Option C — Recompute on demand from git.**
For `codepol graph diff <ref>`, check out `<ref>` in a scratch dir (or use `git worktree add`), build the index there, compare. No persisted snapshot.

- Pros: zero persistent state; always consistent with what is actually on a branch; natural fit for CI where the comparison is always "base vs head".
- Cons: slow (two full indexes per invocation); not usable interactively in the editor; depends on `git` and a writable filesystem; doesn't help in-editor "what changed since this morning" workflows.
- Failure mode: builds are too slow on large monorepos, pushing teams off the feature.

**Option D — In-process ring buffer (editor-only diff).**
Keep the last N generations of the graph in daemon memory (no disk). Diff works only within a live session.

- Pros: zero persistence decisions; cheap; fits the daemon lifecycle already in `packages/workspace-service/src/daemon.ts`.
- Cons: useless for CI and for the `codepol graph diff` CLI; lost on daemon restart.

**Proposed default.** Ship **B for CI and CLI** (smallest, independent) and **D for the editor** (cheap, immediate value). When Option A eventually lands, retire B behind the same public contract — both the sidecar and the full store implement one `GraphSnapshotStore` interface, so the swap is internal.

Contract sketch:

```ts
export type GraphSnapshotStore = {
  graphSnapshotWrite(generation: number, graph: WorkspaceDependencyGraphResult): Promise<void>;
  graphSnapshotRead(generation: number): Promise<WorkspaceDependencyGraphResult | undefined>;
  graphSnapshotGenerationsList(): Promise<number[]>;
};
```

### Q2. Layer config schema

**Context.** `no-layer-violation` and `no-cross-package-internal-import` need a way to classify files into layers (`ui`, `domain`, `infra`, …) and declare allowed / denied edges. Existing config already has `targets.<name>` with `files` globs, and `[[rules]]` blocks with `targets` arrays.

**Option A — Reuse `[targets.<name>]`.**
A layer *is* a target. Add an `allows` / `denies` field to target blocks; `no-layer-violation` scans all targets that declare `allows`/`denies`.

- Pros: no new top-level concept; existing glob-resolution pipeline works unchanged; a file naturally belongs to one or more layers because targets already compose.
- Cons: overloads targets with a second role (who runs this rule *and* who is this layer); a file can match multiple targets, which makes "what layer is this file?" ambiguous; mixing layer semantics into targets bleeds architectural intent into every rule's target list.

**Option B — Dedicated `[layers.<name>]` section.**
Parallel to `[targets.<name>]`. Each layer has `files`, `allows`, `denies`. `no-layer-violation` does not use `targets` at all.

- Pros: single-purpose concept; "what layer is this file?" is a direct lookup against `[layers]`; targets keep their one job (select files for rules); error messages can name layers without confusion.
- Cons: two overlapping selection mechanisms (`targets` vs `layers`); users have to declare the same glob twice if a layer is also used as a target.
- Mitigation: allow `targets.<name>.layer = "domain"` as syntactic sugar when a target wants to double as layer membership without duplicating the glob.

**Option C — `[[layerRules]]` block inline with `[[rules]]`.**
Each element declares `from`, `to`, `kind = 'allow' | 'deny'`. No named layers; relationships are expressed directly as glob pairs.

- Pros: extremely local — the rule and its data live in the same block; easy to read one rule in isolation; no cross-reference between sections.
- Cons: N² verbosity for anything beyond 3–4 layers; no reusable "this is the UI layer" identity, which blocks the panel's `layer` badge and the cross-layer edge color.
- Mitigation: could layer this on top of Option B as a shorthand for targeted exceptions.

**Option D — External layer file.**
A separate `codepol.layers.toml` or YAML referenced from `codepol.toml`. Keeps layers visually separate.

- Pros: decouples architectural documents from enforcement config; non-engineers (architects, reviewers) can own it.
- Cons: adds a file; cross-file validation complicates loader errors; breaks the "one config" simplicity.

**Proposed default.** Option **B**, with the `targets.<name>.layer = "domain"` sugar. It keeps `targets` single-purpose, supports the panel's layer badge, and avoids the N² verbosity of Option C. Schema:

```toml
[layers.domain]
files = ["src/domain/**/*.ts"]
allows = ["shared"]

[layers.infra]
files = ["src/infra/**/*.ts"]
allows = ["domain", "shared"]

[layers.ui]
files = ["src/ui/**/*.ts"]
allows = ["domain", "shared"]

[layers.shared]
files = ["src/shared/**/*.ts"]
```

A file that matches multiple `layers[*].files` patterns resolves to the most specific glob; ties produce a loader error with both layer names to force a decision.

### Q3. Test-file semantics

**Context.** Fan-in / fan-out budgets and dead-module detection behave very differently depending on whether tests are counted. A shared helper imported by 200 tests has importerCount 200, which is either meaningful (it's a widely-depended helper) or noise (it's just "everything has tests").

**Option A — Exclude tests by default, make the filter additive.**
Reuse each target's existing `exclude` globs. Panel adds an "include tests" toggle for ad-hoc investigation.

- Pros: matches the instinct that "architecture" is a production concern; avoids inflating metrics with symmetric test noise; no new config surface.
- Cons: a test-only import that creates a *new* cross-layer edge is invisible to enforcement — a common way that architectural intent erodes.

**Option B — Include tests by default.**
Tests count like any other file. Users opt out via config.

- Pros: catches the test-only layer violation; symmetric with how the rest of the index already behaves.
- Cons: noisy metrics on most codebases; "fan-in = 500" for a utility is almost always test-driven.

**Option C — Separate axis: `tests` is a visible role, not an exclude.**
Introduce a first-class `role = "test"` tag on files (derived from policy target exclude globs or a new `[testFiles]` block). Rules declare whether they count tests. Panel renders test nodes in a different color.

- Pros: most expressive — different rules can answer different questions ("dead prod code" vs "orphan tests"); makes the visual distinction explicit.
- Cons: extra concept to document; requires config surface beyond just globs; probably overbuilt for Phase 3.

**Proposed default.** **A now, C later.** Exclusion by the existing policy `exclude` machinery keeps Phase 3 small. When we hit real cases where test-only layer violations matter, promote to C and pipe it through `ArchitectureCheckContext.filesGetByRole('production' | 'test')`.

### Q4. External package representation

**Context.** Today any `ImportBindingRelation.resolvedModulePath` that doesn't point into the indexed set is dropped. That hides legitimate third-party coupling: "how many files import `lodash`?", "does `domain` depend on `axios`?".

**Option A — Stay excluded (status quo).**

- Pros: smallest graph, cleanest cycles (no false cycles through `node_modules`); aligns with the current `moduleGraphBuild` contract; no UX work.
- Cons: third-party coupling is invisible — a legitimate architectural question.

**Option B — Collapse externals into `external:<packageName>` nodes.**
Every unresolved import is bucketed by its package name (from `package.json` + bare-specifier parsing). One synthetic node per package.

- Pros: big wins at low cost; answers "who depends on `axios`?" directly; panel can render externals in a dim shade; supports `no-external-dep-in-layer` rule variants.
- Cons: parser must know about monorepo package aliases (`workspace:*`, tsconfig paths); cycle detection must skip externals (one-way edges only).

**Option C — Expand externals into per-file nodes.**
Index the *used* entry files of each external package that the project actually imports.

- Pros: maximal fidelity — shows "you import these 3 of 200 functions from `lodash`"; supports unused-dep detection.
- Cons: huge blast radius (parsing `node_modules`); breaks the "only index user code" invariant; cost scales with dependency count not user code size.

**Option D — Opt-in synthetic nodes per rule.**
No change to `ModuleGraph`. `ArchitectureCheckProvider` rules that care about externals iterate `importBindingsGet` directly.

- Pros: zero graph bloat; keeps the shared graph fast.
- Cons: every external-aware rule re-invents bucketing; panel can't render externals unless it also re-implements the logic.

**Proposed default.** **B, gated by a `includeExternal` flag.** `queryDependencyGraph({ includeExternal: true })` returns synthetic `external:<pkg>` nodes; default remains exclusion to preserve cycle/path semantics. This also matches the existing `QueryDependencyGraphInput` draft above — the flag already exists in the contract.

### Q5. Call graph fidelity — **Resolved (Phase 9.1 / 9.2).** Two coordinated surfaces close the gap without lying about the structural call graph: `querySymbolFlow` exposes "function-as-argument" flow as a separate edge stream (Phase 9.1), and `TypeAwareCallGraphSource` is a per-language seam the workspace consults to upgrade `queryCallGraph` results when a host registers a binding (Phase 9.2). Default behavior is unchanged — byte-identical to before — so adding the seam is a pure addition. See `packages/core/src/index/typeAwareCallGraphSource.ts` for the interface and the merge described in `workspaceCallGraphResultCreate` for the conflict-resolution table.

**Context.** `callersGet` / `calleesGet` are structural. They miss dynamic dispatch, higher-order functions, event emitters, and effectively most "interesting" indirection. Promoting them to a UI feature (Phase 7) will expose the gap.

**Option A — Ship as-is with an explicit "structural only" label.**
Panel and hover state plainly: `Structural call graph only — dynamic dispatch and higher-order calls are not tracked.`

- Pros: honest; fast; enough fidelity for many real questions ("who calls this exported helper directly?"); doesn't set a precedent of competing with language servers.
- Cons: users will hit cases where the graph is wrong by omission; surprising silences.

**Option B — Over-approximate via type relations.**
When a method is reached through an interface type, include every known `implements` target as a potential callee.

- Pros: closer to how engineers actually read code; reduces silent misses.
- Cons: over-approximation explodes graph size on interfaces with many implementers; false positives in the panel look like real dependencies.
- Mitigation: render "approximate" edges with a distinct style.

**Option C — Delegate to `tsserver` where available.**
For TS/JS, call `tsserver`'s `references` for each target symbol and fold results into the graph. For Python, defer to Pylance LSP.

- Pros: highest fidelity available; uses the authoritative language server.
- Cons: violates the Capability Ownership Matrix decision (we don't replace language servers — and we shouldn't proxy them either); slow; requires running a language server we otherwise don't need; fragile across editor environments.

**Option D — Narrow the feature: callers only, from exports.**
Restrict Phase 7 to `queryCallersOfExport(symbolId)`. That is the high-confidence subset: it's almost entirely structural because exports are named entry points.

- Pros: safe subset; matches the most common workflow ("who uses this exported function?"); cleanly composable with existing `queryImpactRadius`.
- Cons: "who does this function call?" stays undocumented; symmetric feature surface is postponed.

**Proposed default.** **A for the panel + D for LSP**: the panel renders the structural graph with an explicit label. The LSP hover/CodeLens surfaces only "callers of exports" because that's the one direction we can vouch for. Option B gets revisited only if we collect specific missed cases.

### Q6. Cycle diagnostic volume

**Context.** `moduleCyclesGet()` can return thousands of SCCs on legacy codebases. Surfacing all of them as diagnostics would flood the Problems panel and destroy signal.

**Option A — Hard cap with deterministic truncation.**
`args.maxCycles: number` (default 50). Cycles sorted by `(-size, first member)`; keep the first N. One additional summary diagnostic at the workspace root: `K more cycles omitted`.

- Pros: bounded noise; deterministic output for CI; summary provides the "there's more" signal.
- Cons: picks a ranking, which is a judgment call (size vs frequency vs depth); users with "important but small" cycles may have them hidden.

**Option B — Severity ladder.**
Cycle size N → severity: `N=2` is `warn`, `N=3-5` is `info`, `N>5` is `hint`. No cap.

- Pros: preserves full signal; users can filter by severity in the Problems panel.
- Cons: editors still render all of them, which is what we were trying to avoid.

**Option C — One diagnostic per cycle root, rest as clickable payload.**
Emit one diagnostic per cycle on the alphabetically-first member. Code action "show full cycle" opens the panel with every member highlighted.

- Pros: bounded by number of cycles, not number of cycle members; each diagnostic is actionable; panel reuse is natural.
- Cons: still unbounded if there are thousands of cycles.
- Complement: combine with Option A's hard cap for a good balance.

**Option D — No diagnostics; architecture lives in a dedicated view.**
Cycles appear only in the `ArchitectureLinksPanel` and in CLI output. Nothing in the Problems panel.

- Pros: zero diagnostic noise; clean separation between "fix this file" and "fix this architecture".
- Cons: loses the "I noticed this in my editor today" nudge; CI has to surface it some other way.

**Proposed default.** **C + A combined.** One diagnostic per cycle on the first member, with a code action to show the full cycle; capped at `args.maxCycles` (default 50) with a single summary diagnostic when truncated. If the `codepol/architecture` source turns out to be unwelcome in Problems, users can silence the source at the editor level — no code change needed.

## Related Documents

- `TODO_CODEPOL_LSP.md` — top-level architecture and rollout
- `TODO_CODEPOL_LSP_CAPABILITY_MATRIX.md` — per-language ownership boundary
- `TODO_CODEPOL_LSP_HOVER_MODEL.md` — hover invocation rules that constrain hover enrichment in Phase 5
- `TODO_CODEPOL_LSP_DEFINITION_REFERENCES_MODEL.md` — definition / references boundary
- `packages/core/src/index/TODO.md` — index persistence, incremental updates, baseline storage (prerequisite for Phase 6 diff)
- `docs/cross-file-analysis.md` — existing user-land pattern superseded by `ArchitectureCheckProvider` in Phase 3
- `docs/semantic-index.md` — underlying index architecture
