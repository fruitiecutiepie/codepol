# Codepol LSP Snapshot and Execution Contract

This companion note expands the `Request ordering, cancellation, and snapshot consistency` section in `TODO_CODEPOL_LSP.md`.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for the concrete request-state contract: snapshot identity, ordering, replay visibility, generation commit, cancellation, and stale-result discard.

## When To Read This

Read this note when you are:

- defining request binding metadata or snapshot-resolution logic
- implementing replay barriers, analysis generation commit, or stale-response discard rules
- designing cancellation and supersession behavior for interactive or background work
- deciding consistency levels for document-local, cross-file, or project-wide queries
- validating rename, refactor, or apply operations against exact snapshot preconditions

## Decision

Define this as a snapshot and execution contract. If you do not make it explicit, the daemon will eventually return technically valid but operationally wrong answers.

Use this default contract:

- every request binds to an explicit state vector
- reads run against a pinned snapshot, not a moving target
- replay and overlay application establish barriers
- background indexing produces new analysis generations
- cancellation is best-effort for compute but hard for publication
- responses and side effects carry enough metadata for clients to discard stale results

## Recommendation

Each observable answer should be understood as derived from a specific combination of state, not just "the current workspace."

Use a conceptual state vector like this:

```text
StateVector = (
  daemon_session_id,
  workspace_instance_id,
  client_session_id?,          // when client-local overlays matter
  replay_epoch,
  document_overlay_versions,   // per referenced document when relevant
  file_system_revision,        // daemon's view of on-disk workspace
  analysis_generation,         // semantic/project graph generation
  feature_generation?          // optional per-feature generation
)
```

Not every request needs every field, but this is the mental model.

## Snapshot Identities Requests Bind To

You asked what exact snapshot identity each request observes. Make these bindings explicit.

### A. Daemon Session

Every request is bound to exactly one:

```text
daemon_session_id
```

Why:

- daemon restart invalidates prior session state
- client must reject any response from an old session

Hard rule:

- a response from a different daemon session than the client's current attached session is stale and must be discarded

### B. Workspace Instance

Every workspace-scoped request binds to exactly one:

```text
workspace_instance_id
```

Why:

- restart or reattach may recreate the workspace
- old instance responses are stale even if the logical workspace is the same

Hard rule:

- if the workspace instance changed after request issue, the response is stale and must be discarded

### C. Overlay Or Document Version

For document-sensitive requests, bind to explicit client-visible versions.

Recommended:

- each open document per client session has a monotonically increasing `client_document_version`

A request referencing a document should include the version it wants observed, or declare that it accepts the latest replayed version.

Best default for interactive editor queries:

- bind to the client's current document version at request issue time

Examples:

- hover
- completion
- definition on the current buffer
- local diagnostics
- prepare rename

Hard rule:

- if the daemon computes against an older overlay version than requested, it must not return success as if current

### D. Replay Epoch

Add a per-client-session-per-workspace:

```text
replay_epoch
```

Increment it whenever replay or reconnect starts over.

Why:

- requests issued before replay completion must not be mistaken as valid against a newer replay state
- it lets the daemon and client reason about pre-vs-post replay work

Hard rule:

- requests bind to a replay epoch
- replies and side effects from earlier epochs are stale after a newer epoch becomes active

### E. File-System Revision

The daemon maintains a monotonic workspace on-disk revision:

```text
file_system_revision
```

Advanced project-wide queries often need to know which disk snapshot they observed.

This revision changes when the daemon incorporates file-watch invalidations or explicit refreshes.

### F. Analysis Generation

This is crucial.

The daemon should maintain a monotonic:

```text
analysis_generation
```

This represents a semantically coherent analysis or index state:

- dependency graph
- symbol index
- cross-references
- type analysis caches
- project-wide facts

Cross-file and project-wide requests must bind to one analysis generation, not a moving target.

### G. Optional Feature Generation

If different features mature independently, you may expose feature-specific generations such as:

- `xref_generation`
- `diagnostics_generation`
- `search_generation`

Keep one `analysis_generation` as the main consistency anchor.

## Request Classes And Required Snapshot Bindings

Not all reads need the same consistency level.

### Class 1: Document-Local Interactive Reads

Examples:

- hover
- completion
- local definition
- local diagnostics
- semantic tokens for one file

Bind to:

- daemon session
- workspace instance
- replay epoch
- client session
- target document version
- maybe the latest available local semantic state for that document

These usually do not need a full project analysis generation unless feature semantics require it.

### Class 2: Cross-File Semantic Reads

Examples:

- find references
- rename prepare or execute
- workspace symbol
- cross-file definition
- impact analysis

Bind to:

- daemon session
- workspace instance
- replay epoch
- any referenced overlay versions relevant to changed open documents
- one pinned analysis generation

### Class 3: Project-Wide Or Background Reads

Examples:

- architecture graph
- semantic search
- dependency graph
- index-based reports

Bind to:

- daemon session
- workspace instance
- replay epoch
- file-system revision
- one pinned analysis generation

### Class 4: Mutation Or Command Operations

Examples:

- rename
- apply refactor
- reindex workspace
- generate artifacts

These need preconditions:

- they should declare what snapshot they were validated against
- the daemon should reject them if required preconditions no longer hold

This is optimistic concurrency control for semantic commands.

## Pinned Snapshot Vs Latest Available State

This is the core decision.

### Recommended Default

Reads run against a pinned snapshot, not "whatever is latest while work happens."

Why:

- deterministic answers
- no mixing half-old and half-new state
- easier stale-result detection
- easier cancellation semantics

A request should conceptually capture:

```text
RequestBinding = {
  daemon_session_id,
  workspace_instance_id,
  replay_epoch,
  overlay_requirements,
  consistency_level,
  target_analysis_generation_policy
}
```

The daemon resolves that into an executable snapshot before starting work.

### Consistency Modes

Each request can declare one of these consistency modes:

#### 1. `pinned_latest_safe`

Use the latest snapshot that is internally coherent and satisfies readiness rules at dispatch time.

Best default.

#### 2. `pinned_exact`

Use exactly the requested generation or version set, or fail.

Use for precise operations such as rename or refactor.

#### 3. `latest_best_effort`

Allowed only for explicitly degraded or read-mostly features.

Responses must say they are degraded or best-effort.

Do not use `latest_best_effort` for correctness-sensitive refactors or cross-file semantic operations.

## Replay Ordering Rules

Replay must behave like a write stream that establishes state visible to later reads.

Rule:

- replay messages are ordered and form a barriered stream per daemon session, workspace instance, client session, and replay epoch

Within that stream:

1. session registration
2. workspace attach
3. subscription setup
4. open document messages
5. overlay snapshot messages
6. replay completion barrier

### Visibility Rule

Foreground requests that depend on overlays are not allowed to observe partial replay past their bound replay epoch barrier.

Meaning:

- if replay epoch `7` is in progress and not complete, requests for epoch `7` may:
  - block until the replay barrier
  - fail with `replay_in_progress`
  - or run only if they need no replayed state
- they must not observe some overlays from epoch `7` but not others unless that is explicitly allowed by feature design

Best default:

- document-local requests for a document whose overlay has already been applied may run if the feature is defined as document-local safe
- cross-file and project-wide requests wait for the replay barrier or return not-ready

## Ordering Rules Across Work Types

You asked for ordering across replay, foreground queries, warm-up and indexing, and file-watch invalidation.

### A. Replay Writes Vs Foreground Reads

Replay writes must be ordered before reads that bind to that replay epoch.

Rule:

- replay is a write stream
- read dispatch checks replay barrier visibility

### B. Foreground Reads Vs Background Indexing

Background indexing continuously produces candidate new analysis state, but reads never observe half-built generations.

Rule:

- background work writes into a new candidate generation
- that generation becomes visible only at commit or publish time
- reads either see old generation `G` or new generation `G+1`, never a mix

This is MVCC-like behavior for analysis state.

### C. File-Watch Invalidation

File-watch events are also writes.

Rule:

- invalidations advance `file_system_revision`
- they may schedule analysis of a future generation
- existing pinned reads continue against their pinned generation
- future reads may bind to the old generation until a new coherent generation is committed, unless the feature requires stronger freshness

Do not let a file-watch event partially mutate the visible snapshot mid-request.

### D. Warm-Up And Indexing

Warm-up should publish readiness state separately from generation commit.

Rule:

- feature readiness may move from `cold` to `warming` to `ready`
- actual semantic visibility changes only on generation commit
- readiness alone does not imply new data is visible until the relevant generation is published

## Cancellation Semantics

You asked whether cancellation is best-effort or hard.

### Recommended Split

- compute cancellation: best-effort
- publication cancellation: hard

This is the safest practical contract.

### Compute Cancellation: Best-Effort

The daemon may not be able to stop CPU work instantly:

- parsing
- type-checking
- search
- graph traversal

So cancellation means:

- stop as soon as practical
- no guarantee the internal task halts immediately

### Publication Cancellation: Hard

Once a request is canceled or superseded, it must not publish user-visible side effects unless explicitly allowed by protocol.

That means:

- no reply delivered as current success
- no diagnostics publication attributed to the canceled epoch or request
- no progress continuation after terminal cancel state
- no stale command preview surfaced as current

This matters more than raw compute stopping.

## Side Effects From Canceled Work

Define side-effect classes.

### A. Request-Local Response

Hard rule:

- a canceled request must not yield a normal success response
- it may yield `canceled`, `superseded`, or nothing if transport closed

### B. Progress Events

Simplest rule:

- after cancel is accepted, no further progress events for that request

### C. Published Diagnostics, Semantic Tokens, And Push Notifications

These are the dangerous ones.

Recommended rule:

- side effects must be tagged with the snapshot, generation, and replay epoch they were produced from
- the daemon must suppress publication if the producing work was canceled or superseded
- the client must also discard any publication that is stale by metadata

Both sides defend correctness.

### D. Intrinsic Daemon State Improvements

Sometimes canceled work may still warm caches internally. That is acceptable if:

- it does not violate visible correctness
- it is not advertised as the canceled request's result

## How Clients Detect And Discard Stale Responses

Every response and every publish event should include enough metadata.

Minimum response shape:

```json
{
  "daemon_session_id": "...",
  "workspace_instance_id": "...",
  "replay_epoch": 7,
  "request_id": "...",
  "request_binding": {
    "document_versions": {
      "file:///repo/a.ts": 173
    },
    "analysis_generation": 42
  }
}
```

For pushes such as diagnostics:

```json
{
  "publish_kind": "diagnostics",
  "daemon_session_id": "...",
  "workspace_instance_id": "...",
  "replay_epoch": 7,
  "document_id": "file:///repo/a.ts",
  "document_version": 173,
  "analysis_generation": 42
}
```

Client stale-discard rules:

- wrong daemon session: discard
- wrong workspace instance: discard
- older replay epoch: discard
- older document version than current: discard
- analysis generation older than already accepted for the same freshness domain: usually discard
- canceled or superseded request id: discard

## Supersession Rules For Interactive Requests

Interactive flows race constantly.

Recommended policy:

- newer requests supersede older ones within certain request families and keys

Examples:

- completion keyed by `(client_session, document_id, cursor_context)`
- hover keyed by `(client_session, document_id, position-ish)`
- semantic tokens keyed by `(client_session, document_id)`
- document diagnostics keyed by `(client_session, document_id)`

When a newer request for the same family and key arrives:

- the older one is marked superseded
- the daemon attempts best-effort compute cancel
- hard publication suppression applies

This prevents stale editor flicker.

## Consistency Guarantees For Cross-File And Project-Wide Queries

This needs to be explicit.

Recommended guarantee:

- cross-file and project-wide reads execute against one pinned analysis generation plus the relevant replay epoch and overlay visibility rules

That means:

- references, rename, search, and graph answers are internally consistent with one generation
- they may be slightly stale relative to the newest disk events or newest indexing work
- they are not a mix of old and new graph state

### Stronger Rule For Commands

Correctness-sensitive commands such as rename should use `pinned_exact` or `validate_then_execute`.

Flow:

1. client requests preview against generation `G`
2. user accepts
3. execute includes precondition "still valid on `G`"
4. daemon either:
   - executes on `G`-equivalent current state
   - or rejects with `precondition_failed_snapshot_changed`

Do not silently apply a rename validated on one generation to another without revalidation.

## Incremental Updates And Coherence

Incremental analysis is fine, but visible state must remain coherent.

Recommended model:

- mutable working state used internally by background workers
- immutable published snapshots used by reads

So a new generation looks like:

1. start from published generation `G`
2. process invalidations or updates internally
3. build candidate `G+1`
4. validate and publish `G+1` atomically
5. future reads may bind to `G+1`

That avoids half-updated cross-file results.

## File-Watch Invalidation Freshness Policy

You asked whether reads use pinned snapshots, latest available state, or feature-specific consistency levels.

Use feature-specific policy, but default to pinned published snapshots.

Suggested policy:

- document-local interactive reads:
  - prioritize overlay version correctness
  - may tolerate a slightly older project generation
- cross-file and project-wide reads:
  - use the latest published coherent generation
- correctness-sensitive commands:
  - require exact generation preconditions or revalidation
- best-effort UI features:
  - may opt into degraded latest-safe semantics

File-watch events should not force active reads to abort unless the feature demands exact freshness.

## Request Queueing And Dispatch Rules

A clean dispatcher should consider:

- replay barrier status
- workspace readiness
- feature readiness
- snapshot availability
- supersession or cancel status

Dispatch algorithm:

1. validate daemon session, workspace instance, and replay epoch
2. check readiness policy for request type
3. resolve pinned snapshot
4. check whether the request is already superseded
5. execute
6. before publish, re-check cancel, supersede, session, and epoch validity
7. publish or suppress

That final pre-publish re-check is essential.

## Diagnostics-Specific Rules

Diagnostics are side effects, so they need their own strictness.

### Document Diagnostics

Bind to:

- document version
- replay epoch
- maybe analysis generation

Rule:

- diagnostics for older document versions must not overwrite newer diagnostics

### Project Diagnostics

Bind to:

- analysis generation
- replay epoch
- workspace instance

Rule:

- project diagnostics must come from a coherent generation
- if the daemon restarts or replay epoch changes, old diagnostics are stale

A useful client rule:

- for each diagnostic source or domain, keep only the newest accepted `(replay_epoch, document_version | analysis_generation)` tuple

## Cancellation API Contract

Add explicit request lifecycle states:

```text
queued
running
cancel_requested
canceled
completed
superseded
failed
rejected_not_ready
```

Cancellation API:

- client sends `cancel_request(request_id)`
- daemon replies `cancel_ack` if it accepted the intent
- this does not mean compute already stopped
- it does mean no success publication should escape after cancellation is finalized

If you want a simpler client contract:

- treat `cancel_ack` as "publication suppressed from this point onward"

That is much easier for clients to reason about.

## Recommended Concrete Consistency Levels

Define three official levels.

### Level 1: `document_consistent`

For:

- completion
- hover
- local diagnostics
- semantic tokens

Guarantees:

- observes one daemon session, workspace instance, and replay epoch
- observes the specified or current document overlay version
- may use the latest safe local semantic state
- may use an older project analysis generation if the feature permits and the response says so

### Level 2: `workspace_consistent`

For:

- references
- workspace symbol
- graph and search
- project diagnostics

Guarantees:

- observes one pinned published analysis generation
- no mixed-generation answers
- coherent with one replay epoch and workspace instance

### Level 3: `exact_preconditioned`

For:

- rename execute
- refactor apply
- high-risk commands

Guarantees:

- validated against exact declared generation or version preconditions
- rejects instead of silently applying on changed state

These levels make the contract understandable.

## Recommended Policy Summary

Lock in this policy.

### Snapshot Identity

Every request binds to:

- daemon session
- workspace instance
- replay epoch
- document overlay version or versions when relevant
- one published analysis generation when relevant

### Ordering

- replay messages are ordered writes with a completion barrier
- file-watch invalidations and indexing produce future generations
- reads run against pinned published snapshots, not moving state
- no request may observe half-applied replay or half-published analysis

### Cancellation

- compute cancellation is best-effort
- publication cancellation is hard
- canceled or superseded work must not publish current responses or user-visible side effects
- responses and publishes must carry metadata so stale outputs can be discarded

### Cross-File And Project-Wide Consistency

- reads use one pinned coherent analysis generation
- commands require exact preconditions or revalidation

### Freshness Model

- default is latest published safe snapshot
- exact snapshot only when requested or required
- degraded best-effort only for explicitly non-authoritative features, and it must be labeled

## Bottom Line

The most important decisions are:

- reads observe pinned snapshots, not moving state
- replay and indexing publish through barriers and generations
- cancellation is soft for compute and hard for visible publication
- every response and side effect is tagged with enough identity to discard stale output
- cross-file queries are generation-consistent, not "latest-ish"
- correctness-sensitive commands use explicit snapshot preconditions

That gives Codepol deterministic behavior when edits, replay, reconnect, file-watch invalidation, and background indexing all race.

The next natural section after this is write and mutation semantics: rename, refactor, apply-edit, workspace commands, and how they validate preconditions and commit changes without violating the snapshot model.
