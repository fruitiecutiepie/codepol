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

## User-Visible Capabilities Per Phase

A phase-by-phase reference of what each expansion enables for end users (engineers, architects, plugin authors, CI). Use this when prioritizing or writing release notes.

### Phase 1 — Enriched node / edge metadata enables

- per-file weight at a glance: importer / importee / symbol / LOC counts on every node turn the panel from a topology view into a "where is the gravity?" view
- visual distinction between edge kinds: static / dynamic / side-effect / CJS / type-only no longer collapse into a single edge style
- immediate spotting of cross-package and cross-layer imports because edges carry `crossesPackageBoundary` / `crossesLayerBoundary`
- aggregate cyclomatic complexity per file, so hotspot detection can mean "lots of branching that everyone depends on", not just "lots of importers"
- meaningful edge tooltips: counts of bindings crossing each edge answer "is this a real dependency or a single import?"

### Phase 2 — Narrow graph queries enable

Each bullet lists the user-facing surfaces that ship the query end-to-end (CLI subcommand → Phase 4; editor command / panel → Phase 5).

- "what breaks if I touch this file?" via `queryImpactRadius({ direction: 'upstream' })` — only the dependents, no full-graph dump. *Surfaces: `codepol graph impact <file> --direction upstream` (CLI) · `codepol.architecture.peek` (editor command, opens the Architecture Links panel focused on the radius around the active file) · `CodepolArchitectureCodeLensProvider` head-of-file CodeLens · `CodepolImportSpecifierHoverProvider` import-specifier hover.*
- "why does A depend on B?" via `queryDependencyPath` — actual chain of imports plus parallel paths up to a configurable max. *Surfaces: `codepol graph path <from> <to> --max-paths <n>` (CLI) · `codepol.extension.showDependencyPath` (editor command + dedicated panel `codepol.dependencyPathPanel` with `5 / 10 / 20` `maxPaths` chips and clickable arrowed chains) · sidebar synthetic action `Show Dependency Path From This File…` on the active-target card.*
- "what code is unreachable?" via `queryDeadModules` — concrete cleanup target list rather than guesswork. *Surfaces: `codepol graph dead --entry "bin/**"` (CLI; non-zero exit when results non-empty for CI gating) · `codepol.extension.showDeadModules` (editor command + dedicated panel `codepol.deadModulesPanel` with `Configure entry points...` multi-select and `Use natural entry points` controls; collapsible directory groups; clickable file rows) · architecture diagnostics under the `codepol/architecture` source via the Phase 3 `dead-module` rule and the Phase 6 diagnostic adapter.*
- "what changed?" via `queryDependencyDiff` — added / removed nodes, edges, and cycles between two generations; foundation for PR-level architecture review. *Phase 6 vintage (requires baseline-snapshot persistence); listed here because it completes the "narrow query" family. Surfaces: `codepol graph snapshot --label <name>` and `codepol graph diff [<label>] [--baseline-file <path>] [--fail-on-new-cycle]` (CLI; sidecar store under `<rootPath>/.codepol/graph-snapshots/`) · `protocolClient.queryDependencyDiff` (extension protocol, no editor surface yet — see Phase 6 deferred).*
- bounded responses on huge codebases: every query takes a `depth` (impact radius) or `maxPaths` (dependency path) cap, so monorepos return useful subgraphs in milliseconds. The CLI passes the cap straight through (`--depth`, `--max-paths`); the editor panels expose chips that re-fire the rebuilder so the cost of "show me more" stays one round-trip.

### Phase 3 — `ArchitectureCheckProvider` policy capability enables

- `no-cycles` / `max-cycle-size`: block new cyclic dependencies in CI, cap legacy cycle damage
- `no-layer-violation`: declare `domain → ui` is forbidden in `codepol.toml`, get a violation when someone imports a UI helper from a domain module
- `no-cross-package-internal-import`: enforce that monorepo packages only consume each other's public entrypoints
- `max-fan-in` / `max-fan-out`: coupling budgets per directory or per layer; flag "god module" growth before it lands
- `dead-module`: warn on files unreachable from declared entry points; dead code shows up in the editor instead of waiting for an audit
- `entry-point-allowlist`: only declared roots are allowed to be roots; surprises (a forgotten experiment file with no importers) get caught
- a real capability for plugin authors: custom architecture rules become a one-liner instead of bolting onto `treeCheckProvider`; user-land patterns from `docs/cross-file-analysis.md` collapse to a few lines

### Phase 4 — CLI `graph` subcommands enable

- `codepol graph export --format dot|mermaid|graphml|json`: drop the workspace graph into Graphviz / Mermaid / Gephi / docs sites without writing custom export code
- `codepol graph cycles`: fast cycle audit from any shell, scriptable, scrubable to a file for tracking debt
- `codepol graph path A B`: answer "why does A depend on B" from the terminal during code review or refactors
- `codepol graph fan-in / fan-out --top N`: hotspot tables for status meetings or quarterly architecture reviews
- `codepol graph dead --entry "bin/**"`: automated unused-module reports
- `codepol graph diff <baseRef>`: PR-level diff of the architecture, suitable for CI gates and PR-comment bots
- CI gating without a custom job: non-zero exit codes on `cycles` / `dead` / `diff --fail-on-new-cycle` plug into existing pipelines

### Phase 5 — Editor / LSP surfaces enable

- CodeLens above exports: "3 importers" right above the declaration; click to peek the impact radius without leaving the file
- hover enrichment on import specifiers: see importer / importee count, edge kind, and "this crosses a layer boundary" inline
- `codepol.architecture.peek` command: right-click a symbol → see its callers / dependents in the panel focused on that symbol, not just the file
- cycle gutter markers: subtle indicator on every file in a cycle, hover lists the cycle members; continuous awareness instead of waiting for a CI run
- rename preview enrichment (when prereqs land): rename dialog shows "this changes 4 cross-package edges" so risky renames are obvious before applying

### Phase 6 — Diff and diagnostics enable

- `codepol/architecture` diagnostic source in the Problems panel: cycles and dead modules behave like compiler warnings, actionable from the editor's existing UI
- "show full cycle" code action: click the lightbulb on a cycle warning → panel opens with all members highlighted
- PR-aware diagnostics: with baseline persistence, the editor can show "this cycle is new since main" vs "pre-existing"
- CI gate on architectural regressions: `--fail-on-new-cycle` blocks merges that introduce cycles even when individual files all type-check fine

### Phase 7 — Symbol-level graphs enable

- call graph view: "who calls this exported function?" rendered in the same panel as the module graph, with the same filters and layout
- type hierarchy view: an interface's implementers / a class's ancestors as a graph, navigable to source
- symbol-focused impact radius: "if I change the signature of `userAuthenticate`, what's downstream?" with structural confidence (clearly labeled — see Q5 trade-offs)
- one panel, multiple lenses: users learn the architecture panel once and reuse it for module, call, and type questions

### Phase 8 — Metrics / health enable

- instability metric per file (`Ce / (Ca + Ce)`): identifies files that depend on a lot but aren't depended on (typical entry-point shape) and the inverse
- longest dependency chain: "your deepest import path is 14 hops" — a single number that captures architectural debt over time
- SCC size distribution: "you have 3 cycles of size 2 and one cycle of size 17" — the size-17 SCC is the real problem
- complexity hotspots = importers × cyclomatic complexity: files that are both heavily depended on and internally complex — the most dangerous things to change
- dashboard-ready summary: all numbers come back in `WorkspaceArchitectureSummaryResult`, so a status panel or doc-site widget can render project health without recomputing

User-facing surfaces landed for Phase 8:

- **Architecture Summary panel.** `WorkspaceSummaryCardViewModel` (`extension-vscode/src/viewModels.ts`) gains four optional fields (`instabilityRows`, `longestChainPath`, `sccDistributionRows`, plus `complexityHotspots` rows now carrying the explicit `score` in their detail string). `workspaceSummaryCardHtml` (`extension-vscode/src/panels/render.ts`) renders four new `<div class="section ... mode-micro-hide">` blocks beneath the existing Hotspots list: `Instability (top N)` (clickable, sorted by value desc), `Longest Chain (N hops)` (clickable, one row per file with `hop N of M` detail), `Cycle Size Distribution` (largest size first, exposed as `data-scc-size` / `data-scc-count`), and `Complexity Hotspots`. Every section is omitted when the source field is empty so the legacy `toEqual` view-model snapshot tests stay valid.
- **CLI.** New `codepol graph metrics` subcommand. Runner in `apps/cli/src/graph/graphMetrics.ts` is registered through `graphMetricsCommand` in `apps/cli/src/graph/graphCommand.ts`. `--format json` (default) emits the workspace-service `WorkspaceArchitectureSummaryResult` shape verbatim so doc-site widgets and CI bots parse one payload. `--format text` emits four labeled sections (`Instability (top N)`, `Longest chain (N hops)`, `SCC size distribution`, `Complexity hotspots (top N)`) and prints `(none)` for absent / empty sections so the rendered shape stays grep-stable. `--top <n>` caps the top-N rows in text output (defaults: 10 instability, 5 complexity hotspots, both matching the workspace-service caps); the JSON payload is unaffected. `--fail-on-cycle` exits non-zero whenever the workspace has any cycle so CI can gate on the metric without re-shelling `codepol graph cycles`.
- **CodeLens.** `architectureCodeLensViewModelCreate` (`extension-vscode/src/codeLensViewModels.ts`) accepts an optional `summary: WorkspaceArchitectureSummaryResult | null`. When the focus URI appears in `summary.instability` or `summary.complexityHotspots`, the lens title appends `I=0.86 • complexity 14` to the existing importer / importee body and the view model echoes the underlying numbers (`instabilityValue`, `aggregateCyclomaticComplexity`). `CodepolArchitectureCodeLensProvider` (`extension-vscode/src/codeLensProvider.ts`) now fans `queryImpactRadius` and `queryArchitectureSummary` in `Promise.all`; a missing / superseded summary falls back to the legacy importer-only title.
- **Hover.** New `CodepolArchitectureHoverProvider` (`extension-vscode/src/architectureHoverProvider.ts`) registered through `vscode.languages.registerHoverProvider({ scheme: 'file' }, ...)` in `extension-vscode/src/extension.ts`. Identity rule (`TODO_CODEPOL_LSP_HOVER_MODEL.md`): the provider returns `null` for any cursor position outside line 0, so it inherits the same per-file Codepol identity that the architecture CodeLens already establishes — no new marker layer needed. The pure helper `architectureHoverViewModelCreate` (`extension-vscode/src/architectureHoverViewModel.ts`) renders Markdown with role label (`entry point` / `leaf` / `cycle member` / `module`), instability (`I=0.86 (Ce=12, Ca=2)`), aggregate cyclomatic complexity, hotspot rank (`#2 of 5`), cycle SCC size, and a trusted `command:codepol.architecture.peek?...` link to the panel.
- **Tests landed (28 new cases across 7 spec files):**
  - `tests/extension-vscode.view-models.spec.ts` (+2 cases) — Phase 8 view-model fields populate end to end and stay omitted when the underlying summary lacks them.
  - `tests/extension-vscode.panels-render.spec.ts` (+2 cases) — Phase 8 sections render in HTML when the view model carries them; omission of every Phase 8 section when the view model is the legacy shape.
  - `tests/extension-vscode.architecture-graph-controls.spec.ts` (+2 cases) — CodeLens title appends Phase 8 segments when the summary contains the focus file; falls back to the legacy title when the summary is null or omits the focus file.
  - `tests/extension-vscode.architecture-hover.spec.ts` (new file, 6 cases) — hover view model renders role / instability / complexity / hotspot rank, reports cycle SCC size for cycle members, returns `null` when no metric applies, and emits a deterministic command-link payload.
  - `tests/extension-vscode.architecture-code-lens-provider.spec.ts` (new file, 8 cases) — class-boundary tests for `CodepolArchitectureCodeLensProvider`: scheme rejection, `null` graph result, `request_superseded` swallow on either fan-out arm, rethrow on unexpected failure, `Promise.all` fan-out actually fires both calls, summary-present enriched lens title, summary-null legacy title fallback.
  - `tests/extension-vscode.architecture-hover-provider.spec.ts` (new file, 7 cases) — class-boundary tests for `CodepolArchitectureHoverProvider`: scheme rejection, line-0 marker rule (off-line returns `null` without consulting the protocol), trusted `MarkdownString` anchored at line 0 with the `command:` link wired, `(none)` fallback when no metric applies, role-only hover when the summary is gone, and rethrow on non-superseded failure.
  - `tests/cli.graph-metrics-text-render.spec.ts` (new file, 5 cases) — pure-function unit tests for `graphMetricsTextRender`: rich summary covers every section row format, empty summary collapses to `(none)` placeholders for all four sections, `--top` cap is honored only in text output, longest-chain header omits hop count when the chain is missing, byte-stable across runs.
  - `tests/e2e.cli.graph.spec.ts` (+3 cases) — `codepol graph metrics` JSON shape parity with `WorkspaceArchitectureSummaryResult`; `--fail-on-cycle` exits non-zero on a 2-cycle fixture; `--format text` end-to-end emits every section header (with `(none)` for empty SCC distribution) and the tab-separated header row.

### Phase 9 — Type-aware upgrade enables

Phase 9 closes the four "fidelity gaps" the symbol-level surfaces previously documented as known limitations: higher-order flow (9.1), type-aware call-graph confidence (9.2), structural typing in the type hierarchy (9.4), and type-aware type-hierarchy confidence (9.5). Every addition is opt-in and additive: default behavior of the existing surfaces is byte-identical until a caller passes the new flags or registers a binding.

- "where is this function passed as a callback?" via `querySymbolFlow`: a separate edge stream from the call graph so the structural call graph stays honest about what the source code actually expresses (no fabricated higher-order edges)
- "is this call dynamic dispatch or higher-order?" via `TypeAwareCallGraphSource`: when a host registers a per-language binding, edges carry a confidence tier (`structural` / `type-aware`) and a kind axis (`direct` / `dynamic-dispatch` / `higher-order`); type-aware never demotes structural so a transient language-server hiccup never silently drops an edge users used to see
- "what classes satisfy this interface, even if they didn't write `implements`?" via the cross-file member-shape comparison: opt in with `subTypesGet({ confidence: 'all' })` / `queryTypeHierarchy({ includeStructural: true })`; default queries stay declared-only so existing fixtures keep passing byte-for-byte
- "is this an interface match the language server agrees with, or just a name+arity coincidence?" via `TypeAwareTypeHierarchySource`: registration overlays language-server edges onto the structural answer, tagged `'type-aware'` so consumers can filter
- "did anyone accidentally implement this interface?" via the new `no-undeclared-implementer` architecture rule: turns the previously *observable-only* structural-shape signal into an *enforceable* CI gate
- truncation honesty: owners that exceed `MEMBER_SHAPE_CAP_PER_TYPE` (64 public members) skip the shape comparison on either side, so the tool never emits structural-shape edges from an incomplete picture
- "fail closed" CI semantics: `requireTypeAware: true` on `queryCallGraph` raises `{ code: 'type-aware-source-missing', languageId }` when no binding is registered, useful to verify that PR-time analysis actually consulted the language server

User-facing surfaces landed for Phase 9:

- **Type Hierarchy Panel.** New `codepol.extension.showTypeHierarchy` command + dedicated panel kind (`CODEPOL_EXTENSION_PANEL_TYPE_HIERARCHY`) renders the supertype / subtype graph with three confidence-tier edge styles (declared solid, structural-shape dashed, type-aware emphasized in `--vscode-textLink-activeForeground`), a three-row legend, and a counts header (`N declared · M shape-matched · K from language server`). The panel defaults `includeStructural: true` so users see the full picture; the legend makes the additional edges visually distinct. Click on any node translates the synthetic `codepol-symbol://<id>` URI to the symbol's declaration via `typeHierarchyNodeOpenLocationResolve`. Direction (`supertypes` / `subtypes` / `both`) and depth chips re-fire `queryTypeHierarchy` through the panel manager's rebuilder, identical to the call-graph panel.
- **Implementers CodeLens.** New `CodepolTypeHierarchyCodeLensProvider` (`extension-vscode/src/typeHierarchyCodeLensProvider.ts`) emits `Codepol: N implementers (M shape-matched, K from language server)` above every interface and type-alias-of-object declaration in TypeScript / TSX files. Counts come from `queryTypeHierarchy({ direction: 'subtypes', includeStructural: true })`; the suffix is omitted when the corresponding tier has zero edges. Click invokes `codepol.extension.showTypeHierarchy` scoped to the symbol, so the same lens flow works for the panel and for the rule.
- **Sidebar action.** Synthetic "Show Type Hierarchy" action appended to the Active Target card on every editor-backed file. Gated by the dependency-graph readiness feature (mirrors the existing `Show Graph` action's gate). The controller's cursor resolution validates the symbol kind on click and surfaces a clear error when the cursor is not on a class / interface / type alias.
- **CLI.** New `codepol graph hierarchy <symbolId> --direction --depth --include-structural --min-confidence --require-type-aware` (Phase 9.4) plus `codepol graph flow <symbolId>` (Phase 9.1). JSON output is the workspace-service `WorkspaceDependencyGraphResult` / `WorkspaceSymbolFlowResult` verbatim so doc-site widgets and CI bots parse one payload. Defaults match the workspace contract: `--include-structural` is off by default (CI stability); `--require-type-aware` exits non-zero with the `type-aware-source-missing` code when no binding is registered.
- **Architecture rule.** `no-undeclared-implementer` ships in the default `@codepol/plugin` bundle ([`packages/plugin/src/noUndeclaredImplementerCheck.ts`](packages/plugin/src/noUndeclaredImplementerCheck.ts)). Walks every interface, asks `subTypesGet({ confidence: 'all' })`, and emits one violation per implementer whose relationship is structural-shape only (no declared `implements`). `interfaces` / `ignore` / `ignoreImplementers` glob filters narrow scope; the diagnostic message names both the class and the interface and proposes a one-line fix.
- **Type-aware bridges.** `@codepol/typescript-language-bridge` and `@codepol/python-language-bridge` each publish two factories: `typeScriptCallGraphSourceCreate` / `pythonCallGraphSourceCreate` (Phase 9.2) implement `TypeAwareCallGraphSource` against `prepareCallHierarchy` + `incoming/outgoingCalls`; `typeScriptTypeHierarchySourceCreate` / `pythonTypeHierarchySourceCreate` (Phase 9.5) implement `TypeAwareTypeHierarchySource` against `textDocument/implementation` + `textDocument/typeDefinition`. Neither bridge spawns a language server — the host owns the `LspTransport` lifecycle.
- **Workspace contract.** `WorkspaceDependencyGraphEdge` gains four optional fields (`callGraphConfidence`, `callGraphKind`, `typeRelationConfidence`) so existing consumers see no change while new consumers can render confidence tiers. `queryTypeHierarchy` accepts `includeStructural` / `minConfidence` / `requireTypeAware` additively; `queryCallGraph` accepts `requireTypeAware` additively. Daemon round-trip carries every new field through.
- **Cookbook.** [`docs/cross-file-analysis.md`](docs/cross-file-analysis.md) adds Example 4 (`Catch Accidental Structural Implementers`) plus a new "Type-hierarchy fidelity tiers" section explaining the three confidence tiers and the `minConfidence` filter — sibling to the existing "Call-graph fidelity tiers" block.
- **Tests landed:**
  - core unit tests: `packages/core/src/index/typeAwareCallGraphSourceRegistry.spec.ts` (4 cases), `packages/core/src/index/typeAwareTypeHierarchySourceRegistry.spec.ts` (4 cases), `packages/core/src/index/indexStore.spec.ts` round-trip cases for `MemberShapeRelation` and `SymbolFlowRelation`.
  - integration tests against real tree-sitter extraction: `tests/index.member-shape-extraction.spec.ts` (TS extractor matrix), `tests/index.structural-shape-resolution.spec.ts` (cross-file shape comparison), `tests/index.symbol-flow-extraction.spec.ts` + `tests/index.symbol-flow-extraction.python.spec.ts` (TS / Python flow matrices), `tests/index.symbol-canonical-id.spec.ts` (re-export collapse).
  - workspace-service integration: `tests/workspace-service.symbol-flow.spec.ts`, `tests/workspace-service.call-graph-type-aware.spec.ts` (every row of the conflict-resolution table + `requireTypeAware`), `tests/workspace-service.type-hierarchy-structural.spec.ts`, `tests/workspace-service.type-hierarchy-type-aware.spec.ts`.
  - bridge contract tests against fake transports: `packages/typescript-language-bridge/src/typeScriptCallGraphSource.spec.ts`, `packages/typescript-language-bridge/src/typeScriptTypeHierarchySource.spec.ts`, `packages/python-language-bridge/src/pythonCallGraphSource.spec.ts`.
  - extension surfaces: `tests/extension-vscode.type-hierarchy-panel.spec.ts` (10 cases — layout, direction filter, confidence propagation, count tally, click translator, render html, legend), `tests/extension-vscode.type-hierarchy-codelens.spec.ts` (6 cases — view-model title formatting), `tests/extension-vscode.type-hierarchy-codelens-provider.spec.ts` (21 cases — regex scanner table-driven, kind filter, RPC chain, cancellation, error rethrow / `request_superseded` swallow), `tests/extension-vscode.sidebar.spec.ts` (extended with the synthetic `show_type_hierarchy` action).
  - architecture rule end-to-end: `packages/plugin/src/noUndeclaredImplementerCheck.spec.ts` (5 cases over real `projectIndexBuildSync` fixtures) + `tests/architecture-policy.spec.ts` (extended with a `Duck` shape-only violation that runs through the full `policyCheck` pipeline).
  - daemon round-trip: `packages/workspace-service/src/daemon.spec.ts` extended with `requireTypeAware` and `includeStructural` round-trips.
  - CLI e2e: `tests/e2e.cli.graph.spec.ts` cases for `graph flow` and `graph hierarchy --include-structural`.

Residual gaps (Phase 9):

These are known limitations that fit Phase 9's scope but were left for follow-up slices because each is independent and additive. Listed here so the trade-offs are documented at the same level of honesty as the four "fidelity gaps" Phase 9 closed.

- **Symmetric cursor-path kind guard for `showCallGraph` and `findCallbacks`.** `showTypeHierarchy` validates that the cursor symbol is a `class | interface | type` before opening the panel ([extension-vscode/src/commands.ts](extension-vscode/src/commands.ts) `HIERARCHY_KINDS` set). The same validation pattern would apply to `showCallGraph` (`function | method`) and `findCallbacks` (`function | method`); without it, those commands open an empty panel / peek for non-matching cursors instead of a friendly error. ~5 LOC each + 2 test cases each. The CodeLens / sidebar paths stay trusted in all three commands so producers don't need to change.
- **Python `memberShape` query (Phase 9.4 / Gap 3 follow-up).** Structural-shape implementer matching is TypeScript-only. Python `queryTypeHierarchy({ includeStructural: true })` returns declared `extends` only, the type-hierarchy panel's "M shape-matched" count is always `0` for Python symbols, and the `no-undeclared-implementer` rule never fires on `.py` files. Adding it requires a separate design decision about Python's structural-shape semantics — duck typing has no static `implements` declaration to verify against, and `typing.Protocol` needs `runtime_checkable` semantics that the parser can't see. See [packages/core/src/index/TODO_ADAPTER_PY.md](packages/core/src/index/TODO_ADAPTER_PY.md) for the design discussion.
- **Python `TypeAwareTypeHierarchySource` binding (Phase 9.5 follow-up).** `@codepol/python-language-bridge` ships only the call-graph factory today — `pythonCallGraphSourceCreate`. The TypeScript bridge ships both call-graph and type-hierarchy factories. Adding `pythonTypeHierarchySourceCreate` against pyright's `textDocument/implementation` + `textDocument/typeDefinition` is mechanically the same shape as the existing TS bridge (~150 LOC + ~100 LOC of contract tests against a fake transport). Until it lands, type-aware overlays for Python type hierarchy are unavailable even when a host wires pyright as the LSP transport — only Python call-graph queries get the type-aware upgrade.
- **`IndexCapabilities.typeHierarchy` flag.** `IndexCapabilities.symbolFlow` exists so consumers can detect whether the workspace has any flow data. There's no parity flag for type hierarchy; consumers wanting to know "does my workspace have any type-relation data?" have to call `queryTypeHierarchy` on a known seed and inspect emptiness. One-line addition to [packages/core/src/index/indexBuilder.ts](packages/core/src/index/indexBuilder.ts) when a real consumer materializes; not strictly needed today.
- **Editor menu hiding via context keys.** `showTypeHierarchy` is currently always shown in the `editor/context` menu regardless of cursor position; the in-handler guard catches non-eligible kinds with an error. Hiding the menu item would require a debounced cursor-tracker that probes `querySymbolAtPosition` and publishes a `codepol.cursorOnHierarchyEligibleSymbol` context key on every cursor settle (~150 LOC + per-cursor RPC). Same infrastructure would unblock the deferred Phase 5 hover provider (see lines 595-596 below). Filed under "wait until something else needs it" rather than landing it speculatively.

### Cross-cutting wins (not phase-specific)

- one mental model across editor, CLI, and CI: same query shapes, same JSON, same rules — knowledge transfers between contexts
- architecture becomes enforceable, not just observable: the current panel is read-only; the additions above turn the same data into rules, diagnostics, and gates
- scales with the codebase: bounded queries plus granularity roll-ups mean the feature works on a 50-file project and a 50,000-file monorepo with the same UX
- plugin authors get leverage: `ArchitectureCheckProvider` plus the enriched node / edge model lets third parties express domain-specific architecture rules ("no React component imports a controller") without rebuilding the graph
- honesty about confidence (Phase 9): every symbol-graph edge carries a confidence tier, and the editor / CLI / docs surface the tier visibly — the tool never blends "the source code says this", "we matched names heuristically", and "the language server confirmed this" into one indistinguishable pile

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
  - editor surfaces for `queryDependencyPath` / `queryDeadModules` ship as a Phase 5 follow-up (`Dependency-path and dead-modules panels` below); the impact-radius surface had already landed under the original Phase 5 entry as `codepol.architecture.peek`

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
  - additional user-facing rules from the same capability: `maxCycleSizeRule`, `noCrossPackageInternalImportRule`, `maxFanInRule`, `maxFanOutRule`, `entryPointAllowlistRule` (with typed `args` schemas `MaxCycleSizeArgs`, `NoCrossPackageInternalImportArgs`, `MaxFanInArgs`/`MaxFanOutArgs` sharing the `MaxFanArgs` shape, and `EntryPointAllowlistArgs`); all registered in `@codepol/plugin` default export
    - `max-cycle-size` measures cycle length after applying optional `args.ignore`, emits one violation per offending cycle anchored on the alphabetically-first member with siblings as `relatedLocations`
    - `no-cross-package-internal-import` discovers workspace packages via `workspacePackageRecordsDiscover`, classifies each indexed file by longest-matching package directory, and reports cross-package edges that don't hit the importee's `entryPointPath` or any `args.allow` glob; supports `args.ignorePackages` for full-package exemptions
    - `max-fan-in` / `max-fan-out` share `lib/maxFanShared.ts`; iterate every indexed file (or only those matched by `args.files`), count importers / importees, and report each over-budget file with up to `topRelated` (default 5) counterparts in `relatedLocations`
    - `entry-point-allowlist` walks the indexed file set, treats files with zero importers as entry points, and reports any not matching `args.entries`; passes `entries = []` for "no orphan files at all"
  - tests: `noCyclesCheck.spec.ts` (5), `deadModuleCheck.spec.ts` (5), `noLayerViolationCheck.spec.ts` (6), `maxCycleSizeCheck.spec.ts` (4), `noCrossPackageInternalImportCheck.spec.ts` (5), `maxFanInCheck.spec.ts` (4), `maxFanOutCheck.spec.ts` (3), `entryPointAllowlistCheck.spec.ts` (4); `tests/architecture-policy.spec.ts` end-to-end policy spec carries two `describe` blocks — the original three-rule fixture plus a workspace fixture exercising the five user-facing additions through `policyCheck`

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

### Phase 5: Editor surfaces — _done; cycle-decoration deferral tracked under Phase 6 / 8_

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
  - **Hover provider on import specifiers (Phase 5 follow-up).** Identity rule (`TODO_CODEPOL_LSP_HOVER_MODEL.md`) is satisfied by a new extension-owned marker layer instead of leaning on the Phase 8 file-level lens. New workspace contract `queryImportSpecifiersInFile({ uri })` returns one descriptor per import statement whose target resolves to a file inside the indexed workspace (external / unresolved specifiers are dropped because the per-file metric is meaningful only for in-workspace targets). Each descriptor carries `range` (the import statement byte range), `resolvedModuleUri`, `resolvedModuleWorkspaceRelativePath`, `edgeKind` (`'static' | 'dynamic' | 'cjs' | 'side_effect' | 'type_only'`, mirroring `WorkspaceDependencyGraphEdgeKind`), `bindingCount`, and the optional `crossesPackageBoundary` / `crossesLayerBoundary` flags. The workspace-service helper `workspaceImportSpecifiersInFileResultCreate` walks `ImportBindingRelation` and `ImportsRelation` for the file, collapses multi-binding statements (e.g. `import { a, b, c } from './util'`) to one descriptor with `bindingCount: 3`, suppresses redundant auxiliary `ImportsRelation` captures (`@import.source`) via byte-range containment, and sorts the result by `(range.start.line, range.start.character)` for byte-stable output. New LSP method `codepol/importSpecifiersInFile`, daemon request/ack pair on the same `high` queue lane as `query_symbol_at_position` (editor-driven, hot-path), and `extension-vscode/src/protocolClient.ts → queryImportSpecifiersInFile` complete the round-trip. Editor surfaces:
    - `ImportSpecifierMarkerController` (`extension-vscode/src/importSpecifierMarkerController.ts`) is the identity layer. It debounces document changes 200 ms, applies a subtle dotted-underline `TextEditorDecorationType` (theme-aware via `var(--vscode-textLink-foreground)`) to every workspace-resolved import range in the active editor, drops stale fetches via document-version tagging, and exposes `markerAt(uri, position)` for the hover provider's identity gate.
    - `CodepolImportSpecifierHoverProvider` (`extension-vscode/src/importSpecifierHoverProvider.ts`) returns `null` for any cursor position the marker controller does not recognize — so the language server's default hover wins everywhere outside the decorated import specifiers. On a marker hit it fans `queryImpactRadius({ uri: marker.resolvedModuleUri, direction: 'both', depth: 1 })`, hands the result to the pure `importSpecifierHoverViewModelCreate`, and anchors the hover range to `marker.range` so the editor highlights exactly the import specifier the card describes. The card lists `Importers`, `Importees`, `Edge kind`, and the optional `Crosses layer boundary` field, plus a trusted `command:codepol.architecture.peek?...` link targeting the resolved module URI. Renders `null` (no Codepol hover) when the impact-radius result is empty AND no boundary signal applies — matches the "no Codepol hover when identity exists but rich data is unavailable" case from `TODO_CODEPOL_LSP_HOVER_MODEL.md`.
    - registered in `extension-vscode/src/extension.ts` alongside the existing line-0 architecture hover (`vscode.languages.registerHoverProvider({ scheme: 'file' }, importSpecifierHoverProvider)`); the marker controller is pushed onto `context.subscriptions`, eagerly attached to any active editor at activation, and refreshed on every active-editor / document-change / document-close event.
  - **Tests landed for the hover follow-up (24 new cases across 4 files).**
    - `tests/workspace-service.import-specifiers-in-file.spec.ts` (new, 7 cases) — fixture workspace with static / external / multi-binding import statements; assertions on sort order, dropping of external / unresolved specifiers, edge-kind classification, multi-binding collapse, empty-array handling for files without imports / unindexed URIs / malformed URIs, and JSON byte-stability across two back-to-back queries.
    - `tests/extension-vscode.import-specifier-hover-view-model.spec.ts` (new, 6 cases) — pure unit tests for the renderer: full-card rendering with the action link, `Crosses layer boundary` omitted when false / present when true, action link omitted when no `peekCommandId`, `null` return when neither graph nor boundary signal carries metric, card with boundary-only signal when graph is empty.
    - `tests/extension-vscode.import-specifier-hover-provider.spec.ts` (new, 6 cases) — class-boundary tests: scheme rejection, identity gate (no marker → `null` without consulting protocol), fan-out call shape, hover range anchored to marker range, `null` on empty impact-radius result, `request_superseded` swallow, rethrow on other failures.
    - `tests/extension-vscode.import-specifier-marker-controller.spec.ts` (new, 5 cases) — `importSpecifierMarkerLocate` containment lookup (hit + miss); controller `markerAt` returns `undefined` for unknown documents (identity gate stays closed); `attachToEditor` no-op for non-`file:` schemes; `dispose` is idempotent.
    - `packages/workspace-service/src/daemon.spec.ts` extended with a Phase 5 follow-up assertion that `queryImportSpecifiersInFile` round-trips through the daemon transport and returns the expected `src/shared.ts` descriptor for the test workspace's importer file.
  - **Dependency-path and dead-modules panels (Phase 5 follow-up; user-facing surface for the Phase 2 narrow queries `queryDependencyPath` / `queryDeadModules`).** Two dedicated webview panels mirror the call-graph / type-hierarchy pattern, shipped Command-Palette-first with no daemon / LSP / workspace-service changes (every transport layer was already wired in Phase 2).
    - **Dependency-path panel.** New command `codepol.extension.showDependencyPath` (`Codepol: Show Dependency Path...`) opens the dedicated panel kind `CODEPOL_EXTENSION_PANEL_DEPENDENCY_PATH`. Source URI defaults to the active editor (or `args.fromUri`); destination URI is resolved via a quick-pick whose item set is `queryDependencyGraph().nodes` (the indexed file set, not `vscode.workspace.findFiles`, so the picker only offers files Codepol actually knows about). Pure view-model `dependencyPathPanelViewModelCreate` (`extension-vscode/src/dependencyPathViewModels.ts`) renders a header (`Shortest path: N hops · M paths shown`, with `M of N+ paths shown · more available` on truncation, and `Same file — no traversal` when `from === to`), a `5 / 10 / 20` `maxPaths` chip row, and an ordered list of paths whose nodes are clickable buttons. `dependencyPathPanelBodyHtml` (`extension-vscode/src/panels/dependencyPathRender.ts`) emits `data-open-uri` on every node so the existing `openLocation` postMessage routes clicks through to the editor. Chip clicks emit `dependencyPathMaxPathsSet`; the panel manager parses the value, calls the rebuilder closure handed in by `CodepolCommandController.showDependencyPath`, and re-renders in place.
    - **Dead-modules panel.** New command `codepol.extension.showDeadModules` (`Codepol: Show Dead Modules`) opens panel kind `CODEPOL_EXTENSION_PANEL_DEAD_MODULES`. Pure view-model `deadModulesPanelViewModelCreate` (`extension-vscode/src/deadModulesViewModels.ts`) groups `WorkspaceDeadModulesResult.unreachable` URIs by their immediate parent directory (workspace-relative, with the synthetic empty-string directory rendered as `/` for workspace-root files), emits a header (`N unreachable files in K directories` / `0 unreachable files`) and a summary (`Entry points: natural` / `Entry points: src/index.ts, scripts/main.ts`). `deadModulesPanelBodyHtml` (`extension-vscode/src/panels/deadModulesRender.ts`) renders one collapsible `<details>` per group with `data-open-uri` on each file row plus two header buttons: `Configure entry points...` (emits `deadModulesEntryPointsConfigureRequest`) and `Use natural entry points` (emits `deadModulesEntryPointsSet` with `entryPointUris: undefined`). The configure flow goes through a new `CodepolPanelActions.deadModulesEntryPointsPick` host hook that drives a multi-select quick-pick over the indexed file set; the result is threaded back into the rebuilder.
    - **Sidebar discoverability.** `SidebarSyntheticActionKind` gains `'show_dependency_path_from'` (`extension-vscode/src/sidebarModels.ts`); the active-target card always appends a synthetic `Show Dependency Path From This File…` action that dispatches to `codepol.extension.showDependencyPath` with the active URI as the source. The registered command handler normalizes a bare URI argument into `{ fromUri }` so the sidebar's `executeCommand(command, uri)` shape stays unchanged. Dead-modules is workspace-scoped (no per-file context), so it stays Command-Palette-only — no sidebar action.
    - **Readiness gating.** Both commands gate on `featureBlockedMessageResolve('architectureLinks')` (the same key already used by `peekArchitecture` / `showArchitectureLinks`); cold / warming workspaces produce the existing user-facing message family. The sidebar's `activeTargetDisabledActionMessagesResolve` reuses the same gate so the synthetic action visibly disables in lockstep with the existing graph-derived actions.
    - **Panel manager wiring.** `CodepolPanelManager` (`extension-vscode/src/panels/manager.ts`) adds `showDependencyPath(model, rebuilder)` / `showDeadModules(model, rebuilder)`, the `DependencyPathPanelControlMessage` / `DeadModulesPanelControlMessage` / `DeadModulesPanelEntryPointsConfigureRequest` types + matching `*Is` guards + parser (`dependencyPathMaxPathsParse`), the `DependencyPathPanelControls` / `DeadModulesPanelControls` cache slots on `ManagedPanel`, and three new private handlers (`dependencyPathControlMessageHandle`, `deadModulesControlMessageHandle`, `deadModulesEntryPointsConfigureHandle`). `CodepolPanelViewModel` (`extension-vscode/src/panels/render.ts`) gains `'dependencyPath'` and `'deadModules'` arms; `BASE_SCRIPT` gets two new branches that translate `data-dp-chip-value` and `data-dm-control` clicks into the matching postMessages; CSS lives under scoped `dp-` / `dm-` prefixes so existing panel layouts stay byte-identical.
    - **Manifest.** `extension-vscode/package.json` registers both commands (mirroring `codepol.architecture.peek`'s `enablement: codepol.indexBackedCommandsEnabled`) plus matching `onCommand:` activation events.
  - **Tests landed for the dependency-path and dead-modules follow-up (31 new cases across 6 files; final tally 1910 passing across the whole suite).**
    - `tests/extension-vscode.dependency-path-view-models.spec.ts` (new, 5 cases) — pure view-model: empty result, single 3-hop path, truncation summary at the cap, `from === to` zero-hop, chip activation invariant.
    - `tests/extension-vscode.dead-modules-view-models.spec.ts` (new, 5 cases) — pure view-model: empty result, deterministic directory grouping + intra-group sort, natural entry-points label, custom entry-points label (deduped, in input order), workspace-root files surfaced under the synthetic `''` directory.
    - `tests/extension-vscode.panels-render.spec.ts` (extended with 2 cases) — dependency-path render: chip values + active-chip class + `data-open-uri` on every node + `dp-summary` text matches view-model. Dead-modules render: one `<details>` per group + root group renders the literal `/` + `dm-file-rel` text + `data-open-uri` on every file row + both `data-dm-control` buttons present.
    - `tests/extension-vscode.commands.spec.ts` (extended with 4 cases) — `showDependencyPath` happy path threads `{ fromUri, toUri, maxPaths: 5 }` through the protocol and opens the panel; chip replay via the captured rebuilder re-fires `queryDependencyPath` with `maxPaths: 20`. `showDeadModules` happy path runs with `entryPointUris: undefined`; chip replay re-fires with caller-supplied entry points and renders the new summary.
    - `tests/extension-vscode.sidebar.spec.ts` (extended) — synthetic `show_dependency_path_from` action appears on every active-target card and respects the readiness gate.
    - `tests/extension-vscode.dependency-path-and-dead-modules-panel-manager.spec.ts` (new, 10 cases) — manager-level dispatch with a fake `WebviewPanel` (mocks `vscode` at the module boundary, mirroring `tests/extension-vscode.call-graph-panel-manager.spec.ts`). Dependency-path: chip postMessage parses `'20'` and replays the rebuilder + re-renders HTML; no-op chip toggle skips the rebuilder; unrecognized chip value (`'7'`) silently dropped; file-row click flows through `actions.openLocation` verbatim. Dead-modules: `deadModulesEntryPointsSet` with `undefined` switches to natural and rerenders; `deadModulesEntryPointsConfigureRequest` calls the host picker hook then replays the rebuilder; picker returning `undefined` (cancel) or `[]` (deselect-all → natural) is handled; missing host hook silently drops the request; file-row click routes through `actions.openLocation`.
    - `tests/extension-vscode.dependency-path-and-dead-modules.fixture.spec.ts` (new, 5 cases) — end-to-end fixture against a real `WorkspaceServiceEngine`. Temp workspace shaped `app.ts → b.ts → c.ts → d.ts` plus an unreachable `orphan.ts`; a thin `fixtureProtocolCreate` adapter wraps the live workspace service in a `CodepolProtocolClient` shape that pre-binds `clientSessionId` / `workspaceId` (every method outside the Phase 2 surface throws on call so accidental coupling fails loudly). Asserts: `showDependencyPath` resolves `['src/app.ts','src/b.ts','src/c.ts','src/d.ts']` from the live module graph; chip replay (`maxPaths: 20`) re-fires the workspace query and yields the same path; `showDeadModules` with natural entry points reports zero unreachable (because both `app.ts` and `orphan.ts` are natural roots); `showDeadModules` with `entryPointUris: [appUri]` correctly identifies `src/orphan.ts` as the only unreachable file with its real workspace-relative path; `showDependencyPath` against an unindexed URI surfaces `'Codepol has not indexed the active file yet.'`.
    - **Known coverage gap (carried).** `BASE_SCRIPT` execution itself is still untested — the inline webview JS that maps DOM clicks → postMessages lives in a template string. A typo'd message type would silently fail at runtime. The two new branches (`data-dp-chip-value` → `dependencyPathMaxPathsSet` and `data-dm-control` → `deadModulesEntryPointsSet` / `deadModulesEntryPointsConfigureRequest`) inherit the same gap as the existing call-graph and type-hierarchy chip dispatchers; addressing it requires extracting the script into a unit-testable module and is intentionally out of scope here.
- deferred:
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
    - LSP methods `codepol/symbolLookup` and `codepol/symbolAtPosition`, daemon round-trip on the same queue / priority lane as the other editor-driven reads (`high`), extension `protocolClient` methods `querySymbolLookup` / `querySymbolAtPosition` — same wiring shape as `querySemanticDefinition`. Editor surfaces (CodeLens / hover / peek) can stop walking file-level structures and call these directly. (Follow-up note: the deferred Phase 5 hover ultimately landed without depending on `querySymbolAtPosition` because the import-specifier marker layer is per-statement, not per-symbol; see the Phase 5 "Hover provider on import specifiers" entry above.)
    - Tests landed: `tests/workspace-service.symbol-lookup.spec.ts` (11 cases — name lookup determinism, kind filter, file scope, limit truncation, empty / malformed inputs, three at-position cases for the inner-most-symbol rule, the unknown-file fallback, and a round-trip case that confirms a descriptor's `symbolId` feeds straight into `queryCallGraph` and yields a node with the matching `symbolName` / `symbolKind`). The daemon spec round-trip case (`packages/workspace-service/src/daemon.spec.ts → "serves workspace symbol, graph, semantic search, semantic navigation, and architecture summary RPCs through the daemon service client"`) was extended with a Phase-7-follow-up block that exercises both new RPCs through the daemon transport.

### Phase 8: Metrics additions — _done_

- extend `WorkspaceArchitectureSummaryResult` with `instability`, `longestChain`, `sccSizeDistribution`, `complexityHotspots`
- extend hotspot card in the panel
- tests: determinism + stability under incremental updates
- landed:
  - core helpers in `packages/core/src/index/moduleGraphMetrics.ts`. All three are pure traversals over the public `ModuleGraph` surface (no `IndexStore` reach-in) and emit deterministic, byte-stable output:
    - `moduleInstabilityCompute` — Robert Martin's `I = Ce / (Ca + Ce)` per file, with files that have no incoming and no outgoing edges (`Ca + Ce === 0`) omitted to avoid conflating "stable" with "uncoupled". Values are rounded to 6 fractional digits so the JSON output is consistent across runtimes that format floats differently. Sort: `(value desc, file asc)`.
    - `moduleLongestChainCompute` — longest acyclic chain in the SCC condensation. Each cycle from `moduleGraphCyclesGet()` collapses to its lex-min representative file so cycles do not inflate the chain. Algorithm: condensation DAG → Kahn's topological sort with sorted ready set → DP with `(length desc, lex-asc)` tie-break. Returns `length` (hops) and `path` (files); empty graph returns `{ length: 0, path: [] }`.
    - `moduleSccSizeDistributionCompute` — histogram of cycle sizes from `moduleGraphCyclesGet()` only (size ≥ 2). Keys are inserted in ascending size order so `Object.keys()` iteration is stable.
  - workspace contract: `WorkspaceArchitectureSummaryResult` gains four optional fields (`instability`, `longestChain`, `sccSizeDistribution`, `complexityHotspots`) plus the supporting types `WorkspaceArchitectureSummaryInstability`, `WorkspaceArchitectureSummaryComplexityHotspot`, and `WorkspaceArchitectureSummaryLongestChain`. Each field is omitted (key absent) rather than set to an empty payload, so older clients that key off `field !== undefined` keep working.
  - workspace-service: `workspaceArchitectureSummaryResultCreate` reuses `moduleGraphFromIndexAdapt` and the existing `workspaceFileAggregateCyclomaticComplexityGet` helper to compute every Phase 8 field. `instability` is capped at `WORKSPACE_ARCHITECTURE_INSTABILITY_TOP_N = 10` and `complexityHotspots` at `WORKSPACE_ARCHITECTURE_COMPLEXITY_HOTSPOT_TOP_N = 5` so the summary payload stays bounded on monorepos. `complexityHotspots` is ranked by `score = aggregateCyclomaticComplexity * importerCount` with deterministic tie-breaks. Files with `score === 0` (no fan-in or no measurable complexity) are skipped because the metric is "files that are both heavily depended on and internally complex".
  - extension panel: `WorkspaceSummaryCardViewModel` gains an optional `complexityHotspots` field (omitted when not present so the existing `toEqual` view-model snapshot test stays valid). `workspaceSummaryCardViewModelCreate` appends three Phase 8 metric pills to the metrics row when the underlying summary supplies them: `Longest Chain` (hops), `Largest Cycle` (size + count), `Most Unstable` (file + value to 2 decimals). `workspaceSummaryCardHtml` renders a new `Complexity Hotspots` section beneath the existing `Hotspots` section when complexity hotspots exist.
  - tests:
    - `tests/index.module-graph-metrics.spec.ts` — 13 unit cases over an in-memory `ModuleGraph` fake covering instability semantics (omitting isolated files, canonical Ce/(Ca+Ce) values, sort order, run-to-run determinism), longest-chain semantics (empty graph, single-node fallback, linear DAG, SCC collapse, lex-asc tie-break, JSON-stable output), and SCC size distribution (empty, mixed sizes, ascending key insertion).
    - `tests/workspace-service.architecture-summary-metrics.spec.ts` — 4 integration cases through `WorkspaceServiceEngine`: every field populated end-to-end on a fixture workspace with a 2-cycle and an entry/leaf pair; back-to-back determinism (`JSON.stringify` byte-equality across two queries); incremental stability through an overlay that breaks the cycle (assert `sccSizeDistribution` becomes `undefined`, `longestChain` recomputes, `entry.ts` instability is invariant); empty-edges fallback (every Phase 8 field omitted except the trivial single-node `longestChain`).

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
