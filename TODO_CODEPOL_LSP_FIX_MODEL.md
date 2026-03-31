# Codepol LSP Fix and Code-Action Model

This companion note expands the `Fix and code-action model` section in `TODO_CODEPOL_LSP.md`.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for the detailed fix-planning model, type shapes, provider mappings, and planner rules.

## When To Read This

Read this note when you are:

- implementing the shared `CodeActionService`
- defining `EditPlan`, `FixCandidate`, `CodeAction`, or conflict types
- wiring plugin `FixProvider`, tree-check fixes, ESLint autofix, or Ruff `--fix` into one service contract
- deciding overlap detection, merge rules, stale-revision handling, or `fix all` orchestration

## Decision

- define a first-class service-level fix/code-action contract
- normalize all executable fix sources into one internal edit model before LSP or editor adapters see them

This is the cleanest boundary.

If normalization happens too late, the implementation will accumulate:

- editor-specific fix semantics leaking inward
- engine-specific ordering bugs
- inconsistent `fix all` behavior
- no single place to reason about overlap, conflicts, or safety

## Recommendation

Use a layered model:

- diagnostics / violations identify problems
- fix candidates describe possible remediations
- code actions package one or more fix candidates into user-visible operations
- a workspace edit planner validates, orders, merges, or rejects edits
- adapters only translate the final service model into LSP or editor-native commands

Put differently:

> All fix-producing subsystems may use provider-local logic internally, but all executable results must resolve into a normalized `EditPlan` before adapter exposure or application.

## Why This Is The Right Boundary

Codepol already has heterogeneous fix producers:

- plugin `FixProvider`
- tree-check violation-local fixes
- ESLint autofix
- Ruff `--fix`

These differ in:

- granularity
- safety guarantees
- locality
- determinism
- whether they return edits or mutate files externally
- whether they operate per violation, per rule, or per file

If those sources are surfaced directly to adapters, Codepol loses:

- consistent UX semantics
- conflict handling
- explainability
- composability
- safe batching

A single internal contract provides:

- one model for quick fix and `fix all` flows
- one planner for overlap detection and ordering
- one place to enforce invariants
- one provenance trail for debugging and skipped-fix explanations

## Core Distinctions To Preserve

Separate fix intent, fix edits, and fix execution mode.

### A. Fix intent

What problem is being addressed and at what scope?

Examples:

- fix this violation
- fix all violations of rule `X` in this file
- fix all auto-fixable issues in this file
- run Ruff safe fixes in this file
- run ESLint fixes for a specific rule family

### B. Fix edits

Concrete text or file changes.

Examples:

- replace byte range `120..133`
- insert import at top of file
- remove unused binding
- rename file
- create or delete file

### C. Fix execution mode

How the edits are obtained.

Examples:

- directly returned as edits by a provider
- computed lazily on request
- delegated to an external engine and then diffed
- full-file rewrite from engine output

This matters because ESLint and Ruff may not naturally behave like "here are three local edits". Sometimes the safer abstraction is "engine proposes a new file snapshot" which Codepol then diffs and normalizes.

## Proposed Service-Level Types

Prefer composable `type` aliases over wide `interface` declarations for this model.

The design goal is algebraic:

- products via intersections
- variants via discriminated unions
- reusable traits as small named types

Use four main semantic layers, backed by shared helper types.

### ID and primitive helpers

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };

type ViolationId = Brand<string, 'ViolationId'>;
type FixCandidateId = Brand<string, 'FixCandidateId'>;
type CodeActionId = Brand<string, 'CodeActionId'>;
type EditPlanId = Brand<string, 'EditPlanId'>;
type WorkspaceId = Brand<string, 'WorkspaceId'>;
type ClientId = Brand<string, 'ClientId'>;
type DocumentId = Brand<string, 'DocumentId'>;
type FileId = Brand<string, 'FileId'>;
type RevisionId = Brand<string, 'RevisionId'>;
type RuleId = Brand<string, 'RuleId'>;
type SourceId = Brand<string, 'SourceId'>;
```

### Common literals

```ts
type Severity = 'error' | 'warning' | 'info' | 'hint';
type DiagnosticTag = 'unnecessary' | 'deprecated';

type Applicability = 'safe' | 'unsafe' | 'manual_review';

type FixKind =
  | 'quickfix'
  | 'source.fixAll'
  | 'source.fixAll.rule'
  | 'source.organizeImports'
  | 'refactor';

type FixScope =
  | 'single_diagnostic'
  | 'rule_in_file'
  | 'file'
  | 'workspace';

type ResolveMode = 'already_resolved' | 'resolve_on_request';

type ComputeMode = 'eager_edits' | 'lazy_edits' | 'external_engine';
```

### Text and location primitives

```ts
type TextPosition = {
  line: number;
  columnUtf16: number;
};

type TextRange = {
  start: TextPosition;
  end: TextPosition;
};

type SourceRange = {
  documentId: DocumentId;
  start: TextPosition;
  end: TextPosition;
};
```

### Shared metadata building blocks

```ts
type WithId<TId> = {
  id: TId;
};

type WithTitle = {
  title: string;
};

type WithSource = {
  source: SourceId | string;
};

type WithRule = {
  ruleId: RuleId | string;
};

type WithFile = {
  fileId: FileId | string;
};

type WithApplicability = {
  applicability: Applicability;
};

type WithDiagnostics = {
  targetDiagnostics: ViolationId[];
};

type WithScope = {
  scope: FixScope;
};
```

### Layer 1: diagnostic / violation

Diagnostics identify problems. They should not be the primary execution container for fixes.

```ts
type DiagnosticRecord = WithId<ViolationId> &
  WithSource &
  WithFile &
  WithRule & {
    severity: Severity;
    message: string;
    range: TextRange;
    tags?: DiagnosticTag[];
    data?: Record<string, unknown>;
  };

type DiagnosticFixAvailability = {
  availableFixCount?: number;
  preferredFixCandidateId?: FixCandidateId;
  availableActionKinds?: FixKind[];
};

type DiagnosticRecordWithFixAvailability = DiagnosticRecord &
  DiagnosticFixAvailability;
```

Diagnostics may reference fix availability, but they should not be the final fix protocol.

### Edit provenance and normalized edit operations

```ts
type EditProvenance = {
  source: SourceId | string;
  ruleId?: RuleId | string;
  diagnosticIds?: ViolationId[];
  fixCandidateId?: FixCandidateId;
};

type TextEditOp = {
  startByte: number;
  endByte: number;
  newText: string;
  provenance: EditProvenance;
};

type FileEdit = WithFile & {
  baseRevision: RevisionId | string;
  operations: TextEditOp[];
};

type EditPlanOrigin = {
  source: SourceId | string;
  ruleId?: RuleId | string;
  diagnosticIds?: ViolationId[];
  fixCandidateIds?: FixCandidateId[];
  description?: string;
};
```

### Layer 2: fix candidate

A fix candidate is semantic and provider-neutral. Model it as a discriminated union over compute mode.

```ts
type FixComputeRequest = {
  workspaceId: WorkspaceId | string;
  clientId?: ClientId | string;
  documentId?: DocumentId | string;
  fileId?: FileId | string;
  revisionId?: RevisionId | string;
};

type FixCandidateBase = WithId<FixCandidateId> &
  WithTitle &
  WithSource &
  WithApplicability &
  WithScope &
  WithDiagnostics & {
    kind: FixKind;
    fileId?: FileId | string;
    ruleId?: RuleId | string;
    computeMode: ComputeMode;
    isPreferred?: boolean;
    groupKey?: string;
  };

type EagerEditsFixCandidate = FixCandidateBase & {
  computeMode: 'eager_edits';
  precomputedPlan: EditPlan;
};

type LazyEditsFixCandidate = FixCandidateBase & {
  computeMode: 'lazy_edits';
  computeEdits: (request: FixComputeRequest) => Promise<EditPlan>;
};

type ExternalEngineFixCandidate = FixCandidateBase & {
  computeMode: 'external_engine';
  computeEdits: (request: FixComputeRequest) => Promise<EditPlan>;
  engineHint?: 'eslint' | 'ruff' | string;
};

type FixCandidate =
  | EagerEditsFixCandidate
  | LazyEditsFixCandidate
  | ExternalEngineFixCandidate;
```

This is the key abstraction. All sources map into this layer.

### Layer 3: code action

Code action is the user-visible operation.

```ts
type CodeActionBase = WithId<CodeActionId> &
  WithTitle &
  WithApplicability &
  WithDiagnostics & {
    kind: FixKind;
    fixCandidateIds: FixCandidateId[];
  };

type ResolvedCodeAction = CodeActionBase & {
  resolveMode: 'already_resolved';
  plan: EditPlan;
};

type UnresolvedCodeAction = CodeActionBase & {
  resolveMode: 'resolve_on_request';
};

type CodeAction = ResolvedCodeAction | UnresolvedCodeAction;
```

A code action may wrap:

- one fix candidate
- many fix candidates
- one engine-wide file pass

### Layer 4: normalized edit plan

This is the canonical executable model and the most important layer.

```ts
type EditRef = {
  fileId: FileId | string;
  startByte: number;
  endByte: number;
  provenance?: EditProvenance;
};

type OverlappingTextEditsConflict = {
  type: 'overlapping_text_edits';
  fileId: FileId | string;
  editA: EditRef;
  editB: EditRef;
};

type StaleBaseRevisionConflict = {
  type: 'stale_base_revision';
  fileId: FileId | string;
  expectedRevision: RevisionId | string;
  actualRevision: RevisionId | string;
};

type DuplicateRuleDomainConflict = {
  type: 'duplicate_rule_domain';
  fileId: FileId | string;
  sources: Array<SourceId | string>;
  ruleId?: RuleId | string;
};

type NonCommutativeEnginePassesConflict = {
  type: 'non_commutative_engine_passes';
  fileId: FileId | string;
  sources: Array<SourceId | string>;
};

type PlannedConflict =
  | OverlappingTextEditsConflict
  | StaleBaseRevisionConflict
  | DuplicateRuleDomainConflict
  | NonCommutativeEnginePassesConflict;

type EditPlan = WithId<EditPlanId> &
  WithTitle &
  WithApplicability & {
    scope: FixScope;
    changes: FileEdit[];
    origin: EditPlanOrigin[];
    conflicts?: PlannedConflict[];
    requiresConfirmation?: boolean;
  };
```

All providers must eventually resolve into this model.

### Apply result and request types

```ts
type CodeActionQuery = {
  fileId: FileId | string;
  range?: TextRange;
  diagnosticIds?: ViolationId[];
  requestedKinds?: FixKind[];
};

type FileFixAllRequest = {
  workspaceId: WorkspaceId | string;
  fileId: FileId | string;
  applicability?: Applicability | 'any';
  includeSources?: Array<SourceId | string>;
  excludeSources?: Array<SourceId | string>;
};

type RuleFixAllRequest = {
  workspaceId: WorkspaceId | string;
  fileId: FileId | string;
  ruleId: RuleId | string;
  applicability?: Applicability | 'any';
  includeSources?: Array<SourceId | string>;
  excludeSources?: Array<SourceId | string>;
};

type AppliedEditSummary = {
  fileId: FileId | string;
  operationCount: number;
};

type SkippedEditSummary = {
  fileId: FileId | string;
  reason:
    | 'conflict'
    | 'stale_revision'
    | 'not_applicable'
    | 'planner_rejected';
};

type ApplyResult = {
  planId: EditPlanId | string;
  applied: AppliedEditSummary[];
  skipped?: SkippedEditSummary[];
  conflicts?: PlannedConflict[];
};
```

## Normalization Rule

Yes, normalize everything into one planner-level edit model.

Important nuance:

- providers may author fixes in provider-local structures
- ESLint and Ruff adapters may initially consume engine-native outputs
- but before execution or adapter exposure, everything must compile into one `EditPlan`

That gives implementation flexibility without compromising system semantics.

The invariant should be:

> All fix-capable subsystems may author fixes in provider-local format, but executable results must resolve into a normalized `EditPlan` with explicit file revisions, sorted non-overlapping text operations, provenance, and applicability metadata before any adapter exposes or executes them.

## How Each Existing Source Maps In

### A. Plugin `FixProvider`

Preferred mapping:

- provider-local fix -> `FixCandidate`
- fix resolution -> `EditPlan`

Strong requirements:

- target a specific snapshot or revision
- declare applicability or safety
- do not mutate files directly in the main service flow

### B. Tree-check fixes carried on violations

These are likely the simplest to normalize.

A violation may expose:

- zero or more available fix templates
- one preferred fix

But those fixes should still become `FixCandidate` and then `EditPlan`, rather than being treated as execution-ready directly on the violation object.

### C. ESLint autofix

Support two paths:

- per-message fixes from ESLint results
- engine-level autofix pass

Recommended mapping:

- per diagnostic quick fix -> `FixCandidate`
- fix all for rule or file -> dedicated ESLint-backed `FixCandidate` that resolves into an `EditPlan`

Important rule:

- do not let ESLint write files directly in the core service path
- use an API mode that returns fixes, or run against in-memory content and normalize the diff into `EditPlan`

### D. Ruff `--fix`

Ruff is more likely to want file-wide or engine-run semantics.

Model it as:

- one or more file- or rule-scoped `FixCandidate`s
- resolution runs Ruff against a specific base snapshot
- resulting content diff is converted into normalized `TextEditOp[]`

Again:

- no direct file mutation in the main service path
- diff into the internal edit model first

## UX Operations To Support Explicitly

These should be first-class service actions.

### A. Single quick fix

Semantics:

- one code action
- usually one `FixCandidate`
- resolves to one `EditPlan`

### B. Fix all for a rule

Semantics:

- at least file-scoped in MVP
- aggregates matching diagnostics or runs one engine-backed rule fix pass
- resolves to one `EditPlan`

### C. Fix all in file

Semantics:

- broader orchestration action
- may combine multiple fix candidates and multiple engines
- must go through the shared planner

## Planner Rules: Ordering And Conflict Policy

The planner should be the only place that handles ordering, batching, conflicts, and stale-base checks.

### Rule 1: never blindly apply overlapping edits

If two operations overlap in byte range on the same base revision:

- treat them as conflicting unless an explicit merge rule exists

Safe default:

- mark conflict
- do not auto-merge

### Rule 2: every file edit must declare a base revision

Each `FileEdit` must declare the snapshot, revision, or content hash it was computed against.

If the current buffer differs:

- re-resolve the plan, or
- reject it as stale

Do not apply old byte offsets to new text.

### Rule 3: batch actions should be planned, not streamed

For `fix all in file`:

1. resolve all selected candidates into proposed edits
2. group by file
3. sort by range
4. detect overlap and other conflicts
5. merge compatible edits
6. emit one final `EditPlan`

Do not apply candidate A, mutate the buffer, then compute candidate B against already-mutated content unless that sequencing is explicitly modeled as part of the action.

### Rule 4: engine-level passes should run as phases

For ESLint or Ruff rule-wide or file-wide passes, treat the engine run as producing one coherent proposal for the file, then compare or merge at planner level.

That is safer than interleaving arbitrary local edits with whole-file rewrites.

### Rule 5: prefer deterministic phase ordering

A practical default ordering is:

1. local semantic or tree-check fixes with precise ranges
2. import or symbol cleanup and other structural source actions
3. linter autofix engine passes
4. formatter pass, if one exists in the future, last

The exact order matters less than:

- deterministic policy
- documented precedence
- per-source conflict rules

## Conflict Model

Define explicit conflict types.

```ts
type EditRef = {
  fileId: FileId | string;
  startByte: number;
  endByte: number;
  provenance?: EditProvenance;
};

type OverlappingTextEditsConflict = {
  type: 'overlapping_text_edits';
  fileId: FileId | string;
  editA: EditRef;
  editB: EditRef;
};

type StaleBaseRevisionConflict = {
  type: 'stale_base_revision';
  fileId: FileId | string;
  expectedRevision: RevisionId | string;
  actualRevision: RevisionId | string;
};

type DuplicateRuleDomainConflict = {
  type: 'duplicate_rule_domain';
  fileId: FileId | string;
  sources: Array<SourceId | string>;
  ruleId?: RuleId | string;
};

type NonCommutativeEnginePassesConflict = {
  type: 'non_commutative_engine_passes';
  fileId: FileId | string;
  sources: Array<SourceId | string>;
};

type PlannedConflict =
  | OverlappingTextEditsConflict
  | StaleBaseRevisionConflict
  | DuplicateRuleDomainConflict
  | NonCommutativeEnginePassesConflict;
```

This improves explainability and enables clearer UI behavior, such as:

- `12 fixes applied, 3 skipped due to overlap`
- `fix all rejected because the file changed since planning`

## Merge Rules

Not all multiple edits are conflicts.

Safe merge cases:

- disjoint edits on the same base revision
- duplicate identical replacements on the same range
- final full-file diff chosen as authoritative when the planner explicitly prefers it

Unsafe by default:

- partially overlapping ranges
- same range with different replacement text
- edits computed from different base revisions
- full-file rewrite plus local edits unless explicitly re-diffed and re-planned

Core invariant:

> The final `EditPlan` given to adapters must contain per-file operations that are sorted and non-overlapping.

## Internal Model vs LSP `WorkspaceEdit`

Yes, normalize all fix sources into one internal edit model, but do not use raw LSP `WorkspaceEdit` as the canonical service type.

`WorkspaceEdit` is too weak internally because it lacks:

- provenance
- applicability or safety metadata
- conflict information
- execution source
- base revision invariants
- planning diagnostics

Use:

- `EditPlan` as the canonical internal model
- `WorkspaceEdit` as one serialization target for adapters

## Suggested Contract Wording

Use a strong boundary:

> All fix-producing subsystems must surface fixes through a unified service-level code-action contract. Providers may compute fixes using subsystem-local logic, but executable results must resolve into a normalized `EditPlan` containing file-scoped, revision-anchored, provenance-carrying, non-overlapping text edits before adapter exposure or application.

And:

> Adapters must not perform fix merging, ordering, or conflict resolution. Those responsibilities belong to the service-layer planner.

## Recommended Service Interfaces

Something like:

```ts
type ResolvedCodeActionResult = {
  action: CodeAction;
  plan: EditPlan;
};

type CodeActionService = {
  listCodeActions: (query: CodeActionQuery) => Promise<CodeAction[]>;
  resolveCodeAction: (
    actionId: CodeActionId | string
  ) => Promise<ResolvedCodeActionResult>;
  planFileFixAll: (request: FileFixAllRequest) => Promise<EditPlan>;
  planRuleFixAll: (request: RuleFixAllRequest) => Promise<EditPlan>;
  applyEditPlan: (planId: EditPlanId | string) => Promise<ApplyResult>;
};
```

This is enough for:

- quick fix
- fix all for a rule
- fix all in file

## Optional Provider-Facing Types

These help plugin, tree-check, and engine adapters fit the same contract.

```ts
type FixProviderContext = {
  workspaceId: WorkspaceId | string;
  fileId: FileId | string;
  revisionId: RevisionId | string;
  diagnostics: DiagnosticRecord[];
};

type FixProvider = {
  listFixCandidates: (
    context: FixProviderContext
  ) => Promise<FixCandidate[]>;
};

type ExternalFixEngine = {
  source: SourceId | string;
  listFixCandidates?: (
    context: FixProviderContext
  ) => Promise<FixCandidate[]>;
  computePlanForFile?: (
    request: FileFixAllRequest
  ) => Promise<EditPlan>;
  computePlanForRule?: (
    request: RuleFixAllRequest
  ) => Promise<EditPlan>;
};
```

This `type`-alias version is preferable to the earlier `interface` sketches because it composes better and models variants more clearly:

- small reusable traits via intersections like `WithId & WithTitle & WithSource`
- cleaner discriminated unions for `FixCandidate` and `CodeAction`
- clearer sum-type modeling for conflicts and resolution states

## Practical Policy Choices

Use these defaults unless there is a strong reason to deviate:

- define a first-class service-level fix/code-action contract
- normalize all executable fixes into canonical internal `EditPlan`s before adapters
- keep a richer internal model than raw `WorkspaceEdit`
- do not allow providers or engines to mutate files directly in the main service flow
- centralize batching, ordering, overlap detection, stale-revision checks, and merge policy
- use deterministic orchestration phases for `fix all in file`
- track provenance on every edit

## Important Subtlety

Tree-check fixes carried on violations should participate in the same model as plugin fixes and external-engine fixes, but violations should reference fix availability rather than acting as the canonical fix container.

Why:

- one diagnostic may have multiple possible fixes
- fixes may be lazy to compute
- fixes may be grouped into broader actions
- broader actions may include diagnostics from many sources

Diagnostics should therefore expose things like:

- fix count
- preferred fix id
- available action kinds

Actual fix execution should route through the shared `CodeActionService`.
