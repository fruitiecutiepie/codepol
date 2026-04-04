# Codepol LSP Continuation Plan

## Current Repo State
- Tranche 1 is complete in the repo: the shared service is now a **sessionized in-process engine** with per-client overlay isolation, session-scoped edit plans, and adapter migration in `apps/lsp` and `apps/cli`.
- Tranche 2 is the next milestone: add a **daemon control plane and long-lived host** over the same engine without widening the semantic feature surface yet.
- Keep Phase 4 scoped to **Codepol-owned semantics only**. Do not add generic hover or generic rename that compete with `tsserver`, `Pylance`, or `Pyright`.
- Keep `WorkspaceDiagnostic` narrow. Fixes remain surfaced through `WorkspaceCodeAction` and `WorkspaceEditPlan`, not embedded into diagnostics.
- Keep `queryIndexStatus` as the status source of truth and expand it for daemon/readiness reporting rather than inventing a parallel status API.

## Tranche 1: Sessionized In-Process Service (Completed)
- Replace the current public `WorkspaceService` surface with explicit session and attachment operations:
  - `registerClientSession({ clientKind: 'lsp' | 'cli' | 'test', clientInstanceId }) -> { clientSessionId, daemonSessionId }`
  - `closeClientSession({ clientSessionId })`
  - `attachWorkspace({ clientSessionId, rootPath, configPath }) -> { workspaceId, workspaceInstanceId }`
  - `openOverlay({ clientSessionId, workspaceId, uri, version, text })`
  - `updateOverlay({ clientSessionId, workspaceId, uri, version, text })`
  - `closeOverlay({ clientSessionId, workspaceId, uri })`
  - `queryDiagnostics({ clientSessionId, workspaceId, uri? })`
  - `queryCodeActions({ clientSessionId, workspaceId, uri, version, diagnosticIds? })`
  - `applyEditPlan({ clientSessionId, workspaceId, planId, documentVersions })`
  - `queryIndexStatus({ clientSessionId, workspaceId })`
- Add explicit identity types at the core boundary: `ClientSessionId`, `DaemonSessionId`, and `WorkspaceInstanceId`.
- Expand `IndexStatusResult` to `status: 'cold' | 'warming' | 'ready' | 'error'` and include `workspaceId`, `workspaceInstanceId`, `analysisGeneration`, `indexedFileCount`, `openDocumentCount`, `overlayCount`, and `lastError?`.
- Refactor service state into two layers:
  - Shared workspace state owns config, resolved files, disk-backed index metadata, and runtime/plugin readiness.
  - Per-client session state owns overlays, per-session analysis cache, per-session derived index state, and per-session code-action plans.
- Enforce one isolation rule throughout the service: **overlay content must never be written into shared workspace index state**.
- Implement index behavior as:
  - One disk-only base workspace file set and base index metadata.
  - One lazily-created **session-local derived index** per attached client session when cross-file analysis is needed.
  - Overlay edits update only that session-local derived index.
  - Disk/config invalidation clears all session-local derived indexes for the workspace.
- Do **not** add index clone/snapshot mutation support in tranche 1. Rebuilding session-local derived indexes is acceptable for correctness.
- Migrate adapters in the same tranche:
  - LSP `initialize` registers a client session and attaches the workspace.
  - LSP `didOpen`/`didChange`/`didClose` map directly to overlay APIs.
  - CLI one-shot flows create an ephemeral client session, attach the workspace, run queries, then close the session.
  - Existing tests switch to the new service API directly. No compatibility shim remains.

## Tranche 2: Daemon Host, Replay, and Status

### Scope
- Deliver a reconnect-safe daemon host over the existing sessionized engine.
- Keep the current LSP feature surface functionally the same: diagnostics, code actions, and edit-plan execution still work, but they now go through launcher/daemon plumbing when daemon mode is enabled.
- Do not start Phase 4 semantic methods, extension RPC, or analyzer replacement in this tranche.

### Guiding Constraints
- Reuse the tranche-1 engine and keep one semantic model for sessions, workspaces, overlays, code-action plans, and index status.
- Treat daemon lifecycle, replay, freshness metadata, and stale-result suppression as part of the public product contract, not incidental transport glue.
- Keep adapter-facing changes narrow: the LSP and CLI should switch transport/bootstrap logic, not re-implement session or replay semantics themselves.
- Ship in slices behind an explicit mode switch or fallback path until daemon mode is stable enough to become default.

### Workstream 0: Extract A Reusable Engine Before Adding Transport
- Split the current `InProcessWorkspaceService` implementation into:
  - a reusable engine that owns workspace/session state, analysis, invalidation, and status
  - an in-process adapter that preserves today’s direct API for tests and fallback mode
  - a daemon host adapter that will expose the same engine over transport
- Add internal state for:
  - `replayEpoch`
  - workspace readiness phase
  - per-feature readiness
  - request lifecycle state (`queued`, `running`, `cancel_requested`, `canceled`, `completed`, `superseded`, `failed`, `rejected_not_ready`)
- Expand `IndexStatusResult` for daemon execution so it can report:
  - `daemonSessionId`
  - `workspaceId`
  - `workspaceInstanceId`
  - `replayEpoch`
  - `workspaceReady`
  - `featureStatus`
  - `analysisGeneration`
  - indexed/open/overlay counts
  - `lastError`
- Exit criteria:
  - the existing in-process tests still pass through the new engine wrapper
  - no LSP or CLI behavior regresses before daemon mode is introduced

### Workstream 1: Shared Launcher And Daemon Control Plane
- Add a dedicated daemon entrypoint over the engine.
- Add a shared launcher library used by:
  - `apps/lsp`
  - `apps/cli`
  - daemon-focused tests
- Implement the control-plane filesystem layout from the design docs:
  - runtime descriptor
  - launch lock
  - transport endpoint path
  - state/cache directory roots
- Implement the control-plane startup sequence:
  - discover descriptor
  - validate ownership and liveness
  - acquire launch lock if needed
  - double-check discovery after locking
  - spawn daemon
  - require mandatory `hello` before any normal request
- Make daemon startup/fallback explicit:
  - preferred mode: daemon
  - fallback mode: in-process when daemon startup or compatibility checks fail
  - keep the chosen mode observable in logs and test assertions
- Exit criteria:
  - concurrent clients cannot double-spawn the daemon
  - stale descriptor/socket state is recovered deterministically
  - incompatible daemon builds fail early before normal requests

### Workstream 2: Session Registration, Attachment, And Replay Protocol
- Implement the session protocol described in `TODO_CODEPOL_LSP_WORKSPACE_SESSION_PROTOCOL.md`:
  - `register_client_session`
  - `attach_workspace`
  - explicit subscriptions
  - open-document replay
  - authoritative overlay snapshot replay
  - `complete_replay`
- Keep `clientSessionId` client-generated and stable for the lifetime of one editor window or CLI consumer.
- Make reconnect mean full re-registration plus re-attach plus replay. Never assume transport continuity equals session continuity.
- Use this replay order:
  1. `hello`
  2. `register_client_session`
  3. `attach_workspace`
  4. replay client-scoped options that affect outputs
  5. restore subscriptions
  6. replay open documents
  7. replay full overlay snapshots
  8. `complete_replay`
  9. resume normal request flow
- Keep overlays authoritative and replay them as **full snapshots**, not edit deltas.
- Initial subscription set for tranche 2 should be minimal and practical:
  - diagnostics
  - index/status progress
- Exit criteria:
  - reconnect to a fresh daemon reproduces the client’s overlay state exactly
  - requests cannot observe half-applied replay
  - post-replay diagnostics are republished from the new daemon session

### Workstream 3: Request Metadata, Queueing, And Cancellation
- Formalize a request envelope that carries enough freshness data to reject or suppress stale work:
  - `daemonSessionId`
  - `clientSessionId`
  - `workspaceInstanceId`
  - `replayEpoch`
  - request id
  - document version or overlay version when relevant
  - `analysisGeneration` when the feature binds to a published workspace snapshot
- Add a scheduler keyed by workspace and request class.
- Start with simple priority bands:
  - highest: attach, replay, status
  - high: foreground diagnostics for the active document
  - medium: code actions and edit-plan application
  - low: background indexing, persistence flushes, and watch-triggered recomputation
- Add explicit cancellation:
  - client sends `cancel_request`
  - daemon acknowledges cancellation intent
  - compute cancellation is best-effort
  - publication suppression is hard
- Enforce the pre-publish validity check from the snapshot contract:
  - re-check daemon session
  - re-check workspace instance
  - re-check replay epoch
  - re-check cancel/supersede state
  - only then publish diagnostics or status as current
- Fold Phase 1 external-runner cancellation into this workstream so queueing does not stop at the daemon boundary.
- Exit criteria:
  - superseded diagnostics never overwrite newer results
  - canceled work may finish internally but cannot publish as current
  - queueing keeps replay/startup/status work ahead of background warm-up

### Workstream 4: Workspace Watchers, Invalidation, And Background Warm-Up
- Add one watcher pipeline per logical workspace, not per client session.
- Reuse the existing `chokidar`-based watch knowledge from `apps/cli`, but move ownership into the daemon workspace lifecycle.
- Track invalidation at the right layer:
  - disk/config changes invalidate the shared workspace base state
  - session-local overlays remain client-owned and must be re-applied on top of the refreshed base
- Trigger background warm-up on:
  - first attach to a workspace
  - config changes
  - file create/change/delete events that affect indexed inputs
- Keep `workspaceInstanceId` stable across normal invalidation and reindexing. Only daemon restart or explicit workspace restart should create a new instance id.
- Update `queryIndexStatus` so clients can distinguish:
  - daemon connected but workspace unattached
  - workspace attached but replay in progress
  - workspace warming
  - workspace ready
  - feature-specific degradation or error
- Exit criteria:
  - file changes on disk invalidate and rebuild daemon-held base state
  - overlay isolation still holds while background warm-up runs
  - warm-up status transitions are deterministic and queryable

### Workstream 5: Persistence And Warm Start
- Persist only daemon-owned workspace state:
  - base disk-derived index/cache metadata
  - workspace config/environment identity
  - last successful published analysis generation or equivalent cache marker
- Do not persist:
  - client overlays
  - open-document state
  - subscriptions
  - session-scoped edit plans
- Key warm caches by:
  - logical workspace identity
  - environment/config identity
  - engine build/protocol compatibility version
- On attach:
  - try to restore compatible workspace cache
  - validate it cheaply
  - fall back to cold rebuild on mismatch, corruption, or incompatible build
- Exit criteria:
  - a healthy warm cache shortens first-ready time without changing correctness
  - incompatible or corrupt cache data is discarded automatically
  - replayed overlays still win over restored disk-backed state

### Workstream 6: Adapter Migration And Rollout
- Add a daemon-backed client transport for `apps/lsp` and `apps/cli`.
- Keep the adapter boundary narrow:
  - adapters own transport/bootstrap/reconnect logic
  - the shared engine still owns workspace/session semantics
- Suggested rollout order:
  1. engine split with zero behavior change
  2. daemon host plus launcher in tests
  3. CLI daemon mode behind an opt-in switch
  4. LSP daemon mode behind an opt-in switch
  5. fallback-tested default daemon mode once reconnect and stale-output behavior are stable
- Preserve an in-process fallback path during rollout so development is not blocked by daemon startup issues.
- Exit criteria:
  - CLI and LSP can run against either in-process or daemon mode using the same logical service contract
  - reconnect/fallback behavior is deterministic and test-covered

### Tranche 2 Test Plan
- Launcher/control-plane tests:
  - descriptor discovery and validation
  - single-launch lock behavior under parallel clients
  - stale lock or stale socket recovery
  - handshake compatibility failure paths
- Daemon protocol tests:
  - `hello` is mandatory before normal work
  - reconnect requires re-registration and replay
  - `complete_replay` acts as a barrier
  - stale daemon-session output is discarded
- Workspace daemon integration tests:
  - two client sessions share one daemon workspace base state but keep isolated overlays
  - file-watch invalidation rebuilds shared base state without leaking overlays
  - warm cache restore plus overlay replay produces correct diagnostics
  - cancel/supersede prevents stale diagnostics publication
- Adapter tests:
  - CLI daemon mode still preserves one-shot check/fix behavior
  - LSP initialize/open/change/close still produces the same external behavior through the daemon client
  - daemon restart causes re-registration, replay, and diagnostics refresh instead of silent stale continuity

### Tranche 2 Is Done When
- A single shared daemon can be discovered, launched, locked, and handshaken by multiple clients.
- LSP and CLI can reconnect by re-registering, re-attaching, replaying overlays, and waiting for replay completion.
- Watcher-driven invalidation and background warm-up operate inside the daemon workspace lifecycle.
- Warm-start persistence exists for daemon-owned workspace state and never persists client-owned overlay truth.
- Request freshness metadata, queueing, and cancellation prevent stale diagnostics or status from being published as current.
- `queryIndexStatus` reports enough structured readiness to drive future LSP status/progress work in tranche 3 without changing the transport model again.

## Tranche 3: Phase 4 and Phase 6 Surface
- Keep default LSP ownership narrow:
  - Do not implement generic hover.
  - Do not implement generic rename or prepare-rename.
  - Do not compete on normal code-symbol definition/references.
- Add Codepol-owned read features in this order:
  - `workspace/symbol` with clearly labeled Codepol results.
  - Progress/status signals driven by `queryIndexStatus`.
  - Codepol-owned definition/references only when the returned semantics are clearly outside standard language-server ownership.
- Add extension RPC only after daemon/session contracts are stable.
- Make the first extension RPC features read-only: index status, dependency graph, semantic search, and architecture summaries.
- Any future refactor or rename flow must validate exact snapshot preconditions and return `WorkspaceEditPlan`s, not ad hoc edits.

## Tranche 4: Replacement Roadmap
- Inventory wrapped analyzers by latency, diagnostic quality, and fix quality.
- Replace analyzers only where a Codepol-native implementation preserves or improves current behavior.
- Keep the workspace-service contracts stable while analyzers are swapped behind them.

## Test Plan
- Service integration must cover two client sessions attached to the same workspace opening the same URI with different overlays and receiving isolated diagnostics.
- Service integration must cover cross-file overlay changes in one session not affecting another session’s diagnostics.
- Service integration must cover session-scoped code actions and `planId`s so one session cannot apply another session’s plan.
- Service integration must cover closing one session overlay reverting only that session to disk state.
- Service integration must cover stale document versions being rejected per session, not globally.
- LSP adapter tests must cover session registration and workspace attachment during `initialize`.
- LSP adapter tests must cover diagnostics publication staying correct after the API replacement.
- LSP adapter tests must cover `workspace/executeCommand` applying only plans owned by the active client session.
- CLI/e2e tests must continue to cover one-shot check/fix behavior and the existing cross-file fix flow.
- Daemon-phase tests must cover reconnect as full re-registration plus replay, stale daemon-session output discard, and deterministic warm-start status transitions.

## Assumptions and Defaults
- The first implementation slice is a big-bang API replacement.
- The next milestone is the sessionized in-process core, not daemon transport.
- Phase 4 remains Codepol-only in scope until a later explicit decision changes the ownership matrix.
- Fix payloads stay separate from diagnostics.
- Session-local derived indexes are an acceptable tranche-1 tradeoff; shared-index optimization is deferred.