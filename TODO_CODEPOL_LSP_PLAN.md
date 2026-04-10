# Codepol LSP Continuation Plan

## Current Repo State
- Tranche 1 is complete in the repo: the shared service is now a **sessionized in-process engine** with per-client overlay isolation, session-scoped edit plans, and adapter migration in `apps/lsp` and `apps/cli`.
- Tranche 2 is complete in the repo: the **daemon control plane and long-lived host** now sit over the same engine, with reconnect, replay, invalidation, persistence, queueing/cancellation, and rollout coverage in place without widening the semantic feature surface yet.
- Tranche 3 is complete in the repo for the narrowed Phase-4/Phase-6 cut: the LSP now ships **narrow `workspace/symbol`**, **cold-start status/progress**, and **read-only `codepol/*` RPC** over the existing LSP JSON-RPC stream.
- Tranche 4 is complete in the repo for its first real replacement slice: the analyzer ownership/scorecard foundation is in place, and `@codepol/plugin/no-unused-vars` is the first shipped native-over-wrapped JS/TS migration with parity coverage on the current service, daemon, CLI, and LSP surfaces.
- The earlier Codepol-only restriction on generic `definition`, `references`, `hover`, `prepareRename`, and `rename` is now lifted. Those surfaces are the next scoped follow-up tranche, but ownership still must remain explicit against `tsserver`, `Pylance`, and `Pyright`.
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

## Tranche 2: Daemon Host, Replay, and Status (Completed)

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
- Started in the repo:
  - `packages/workspace-service` now exposes `WorkspaceServiceEngine`
  - `workspaceServiceCreate()` is now a thin in-process adapter over that shared engine
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
- Started in the repo:
  - `packages/workspace-service/src/daemon.ts` now defines runtime-path resolution, descriptor read/write helpers, a shared launcher flow, and the mandatory `hello` handshake contract
  - `apps/daemon` now exists as the first daemon entrypoint package
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
- Started in the repo:
  - the daemon layer now has hello-gated RPC handling for the current `WorkspaceService` surface, including `register_client_session`, `attach_workspace`, overlay methods, diagnostics, code actions, edit-plan apply, and index status
  - `WorkspaceDaemonServiceClient` now maps the current daemon RPC surface back to the existing `WorkspaceService` interface
  - `register_client_session` now accepts stable client-generated `clientSessionId` values so reconnect/replay can stop depending on daemon-generated session ids
  - `complete_replay` now exists as an explicit barrier and the daemon rejects normal workspace reads before replay is marked applied
  - diagnostics subscriptions are now explicit and idempotent in the daemon session, and the LSP initialize path replays diagnostics subscription plus current overlay snapshots before `complete_replay`
  - `apps/lsp` now retries recoverable daemon transport failures by re-resolving the service, re-registering the stable client session, re-attaching the workspace, replaying open overlays, and then retrying the failed request once
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
- Started in the repo:
  - `apps/lsp` now treats `$/cancelRequest` as best-effort request cancellation and returns `Request cancelled` for in-flight LSP requests canceled before response publication
  - diagnostics publication in `apps/lsp` is now freshness-gated by workspace replay epoch plus per-document state version so older diagnostic queries cannot overwrite newer open/change/close state
  - the daemon transport now supports `cancel_request` against in-flight transport request ids, and daemon-backed workspace-service reads/apply calls now accept abort signals so canceled interactive requests can stop before response publication
  - Biome and Ruff subprocess execution now also runs through abortable async runner paths, so daemon cancellation no longer waits for those external analyzers to finish before the request can settle as canceled
  - the daemon protocol now carries and validates `workspaceInstanceId` on overlay/read requests plus `replayEpoch` on post-replay reads/status calls, so stale sessions are rejected at the service boundary instead of only at the LSP adapter
  - the daemon-backed workspace-service client now carries `daemonSessionId` on all client-session-bound RPCs, and the daemon rejects stale or missing daemon ids before workspace attach/replay/overlay/read work starts
  - the daemon session now has a workspace-keyed priority queue, with `attach`/`replay`/`status` ahead of diagnostics and diagnostics ahead of code actions or edit-plan work when requests backlog on the same workspace lane
  - diagnostics reads now carry the current overlay document version, index/status reads can carry `analysisGeneration`, and stale diagnostics/status requests are rejected or suppressed before they can publish as current
  - interactive diagnostics/code-action/status requests now carry logical `requestId`s, and the daemon suppresses older same-class responses as `request_superseded` once a newer request for the same workspace lane arrives
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
- Phase 1 external-runner cancellation is now folded into this workstream so queueing does not stop at the daemon boundary.
- Exit criteria:
  - superseded diagnostics never overwrite newer results
  - canceled work may finish internally but cannot publish as current
  - queueing keeps replay/startup/status work ahead of background warm-up

### Workstream 4: Workspace Watchers, Invalidation, And Background Warm-Up
- Started in the repo:
  - the shared workspace engine now owns one watcher pipeline per attached logical workspace, invalidates base/session state on watched disk changes while keeping `workspaceInstanceId` stable, and lazily reloads config on the next analysis after a watched config-file change
  - daemon-mode workspace engines now schedule background warm-up after replay and after watched disk/config invalidation, and `queryIndexStatus` now reports `replayState: 'pending' | 'applied'` so callers can distinguish replay gating from normal warming
  - `queryIndexStatus` now also returns `daemonSessionId`, `replayEpoch`, `workspaceReady`, and structured per-feature readiness metadata so tranche-3 status publication can key off the existing status call instead of needing another transport change
  - diagnostics feature readiness can now report `degraded` when a provider like Biome or Ruff fails but the rest of analysis still completes, instead of mirroring the top-level workspace status
  - workspace-index readiness is now scoped to the configured and matched rules rather than the whole plugin package, so no-index policies stay `workspaceIndex: ready` with `Not required by current policy` even while other features are still `cold` or `warming`
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
- Completed in the repo:
  - the workspace engine can now restore a validated warm-analysis snapshot on attach, rehydrate per-session ready state from daemon-owned disk-backed data, and skip replay-time warm-up when the restored snapshot is already current
  - warm-cache persistence is now filesystem-backed in the daemon runtime directory, keyed by workspace identity plus engine/build/environment identity, and it automatically discards corrupt cache files on read
  - persisted state is limited to daemon-owned disk-derived analysis/base-index metadata; overlay-derived analysis is never written, and replayed overlays still invalidate restored snapshots before foreground reads
  - index-required workspaces now persist and restore a live project-index store snapshot rather than only a cached analysis result, so restored sessions can continue incremental overlay updates without a cold index rebuild
  - daemon control-plane coverage now includes warm-start reuse across daemon incarnations, including restored `workspaceIndex` readiness and overlay updates against the restored index
  - warm-cache validity now also fingerprints configured external tool binaries and config files such as Biome or Ruff inputs when they are referenced by explicit paths, and the filesystem store prunes stale build/environment cache variants for the same logical workspace
  - warm-cache validity now also fingerprints plugin compatibility, including builtin package build artifacts, process-plugin script paths, and resolved plugin capability signatures, so daemon warm restore drops stale snapshots after plugin rebuilds or registry changes
  - index-required warm restore now also validates discovered workspace package metadata, so monorepo package-name or entry-point changes in `package.json` invalidate the cached project index before it can be reused
  - daemon-owned warm caches now derive environment identity from tool-resolution environment variables such as `PATH`, `NODE_PATH`, and active virtual-env prefixes instead of only the Node version, so non-explicit binary resolution changes invalidate cached state
  - warm restore now has direct regression coverage that client-owned open overlays and session-scoped edit plans are not resurrected from daemon-owned cache state
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
- Completed in the repo:
  - `apps/lsp/src/serviceFactory.ts` now resolves a daemon-backed `WorkspaceService` client by default, with `CODEPOL_WORKSPACE_SERVICE_MODE=in_process` as the rollout escape hatch
  - `apps/lsp` currently preserves an in-process fallback path when daemon bootstrap fails during rollout
  - `apps/cli/src/serviceFactory.ts` now resolves a daemon-backed one-shot policy-check client by default, with `CODEPOL_WORKSPACE_SERVICE_MODE=in_process` as the rollout escape hatch
  - `apps/cli` currently preserves an in-process fallback path when daemon bootstrap fails during rollout
  - daemon handshake compatibility failures now short-circuit as explicit errors instead of being treated as generic unhealthy-daemon retries, and the CLI/LSP factories now pass `CODEPOL_INSTALL_ID` through the `hello` expectation so mismatched runtime dirs fall back deterministically without relaunching
  - adapter coverage now proves both the default daemon path and the explicit `in_process` override for CLI and LSP, CLI daemon-mode tests now cover both one-shot check and one-shot fix behavior, and LSP daemon-backed tests now cover initialize/open/change/close diagnostics parity plus reconnect-driven diagnostics refresh after daemon restart
  - launcher coverage now proves parallel clients serialize behind one daemon start, that a stale `daemon.lock` is cleared during recovery, and that daemon startup removes a stale `daemon.sock` path before binding
  - daemon-backed workspace integration coverage now proves two client sessions can attach to the same daemon workspace, share one base workspace identity, keep overlay diagnostics isolated, rebuild shared disk-backed state after watched invalidation without leaking overlays, restore warm-cache state while still letting replayed overlays win, and expose `cold -> warming -> ready` status transitions from `queryIndexStatus` during daemon-owned background warm-up
  - broad tranche-2 verification now runs the daemon protocol, workspace integration, LSP adapter, and CLI adapter suites together
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
- Status: completed in the repo.
- A single shared daemon can be discovered, launched, locked, and handshaken by multiple clients.
- LSP and CLI can reconnect by re-registering, re-attaching, replaying overlays, and waiting for replay completion.
- Watcher-driven invalidation and background warm-up operate inside the daemon workspace lifecycle.
- Warm-start persistence exists for daemon-owned workspace state and never persists client-owned overlay truth.
- Request freshness metadata, queueing, and cancellation prevent stale diagnostics or status from being published as current.
- `queryIndexStatus` reports enough structured readiness to drive future LSP status/progress work in tranche 3 without changing the transport model again.

## Tranche 3: Narrow LSP Surface and Read-Only Codepol RPC (Complete In Repo)

### Scope That Shipped
- Keep default LSP ownership narrow:
  - no generic hover
  - no generic rename or prepare-rename
  - no generic definition or references that compete with normal language-server ownership
- Reuse the existing LSP JSON-RPC stream and the existing daemon/service session model rather than inventing a second extension transport for the first read-only features.
- Make the first tranche-3 features read-only and overlay-aware:
  - `workspace/symbol`
  - cold-start status/progress driven by `queryIndexStatus`
  - `codepol/indexStatus`
  - `codepol/dependencyGraph`
  - `codepol/semanticSearch`
  - `codepol/architectureSummary`

### Public API And Type Surface Now In Repo
- `packages/core` now exposes editor-neutral read result types:
  - `WorkspaceLocation`
  - `WorkspaceSymbolKind`
  - `WorkspaceSymbolResult`
  - `WorkspaceSearchResult`
  - `WorkspaceDependencyGraphResult`
  - `WorkspaceArchitectureSummaryResult`
- `IndexStatusFeatureStatus` now reports readiness for:
  - `workspaceSymbols`
  - `semanticSearch`
  - `dependencyGraph`
  - `architectureSummary`
- `WorkspaceService` now exposes read methods for:
  - `queryWorkspaceSymbols`
  - `queryDependencyGraph`
  - `querySemanticSearch`
  - `queryArchitectureSummary`
- The daemon RPC surface now has request/ack pairs for those four read methods and applies the same freshness contract already used elsewhere:
  - `daemonSessionId`
  - `workspaceInstanceId`
  - `replayEpoch`
  - logical `requestId`
  - `analysisGeneration` where reads bind to a published analysis snapshot

### Runtime Behavior Now In Repo
- LSP-attached sessions now enable and warm a project index even when current policy rules do not require one, because tranche-3 reads depend on index-backed data.
- `workspace/symbol` is intentionally narrow and Codepol-specific:
  - currently returns module-only `workspace_module` results
  - searches indexed basename plus workspace-relative path
  - maps each result to the file URI with a zero-width range at file start
  - tags results as Codepol-owned in adapter metadata so they do not masquerade as generic language-server symbols
- `codepol/indexStatus`, `codepol/dependencyGraph`, `codepol/semanticSearch`, and `codepol/architectureSummary` all route through the current `CodepolLspServer` session and therefore reuse:
  - the attached workspace
  - replay epoch validation
  - overlay truth
  - reconnect/replay behavior
  - daemon freshness checks
- Current feature semantics are:
  - `codepol/indexStatus`: raw `queryIndexStatus` passthrough
  - `codepol/dependencyGraph`: module graph nodes, import edges, entry points, and cycles
  - `codepol/semanticSearch`: ranked module plus exported-symbol search over the index; no natural-language or full-text behavior
  - `codepol/architectureSummary`: deterministic structural summary derived from index stats and module-graph facts
- LSP cold-start progress now polls `queryIndexStatus` instead of introducing a push-status transport:
  - polling starts after initialize/attach and after reconnect
  - polling is fast while `cold` or `warming` and slower while `ready`
  - `window/workDoneProgress/create` plus `$/progress` are emitted when the client advertises progress support
  - progress reopens if a ready workspace falls back to `cold` or `warming` after invalidation
  - polling stops on shutdown, exit, or client-session close
- Daemon queueing/supersession priorities now include the tranche-3 reads:
  - `query_index_status` remains highest priority
  - `query_workspace_symbols` and `query_semantic_search` are high priority
  - `query_dependency_graph` and `query_architecture_summary` are medium priority

### Tranche 3 Coverage Now In Repo
- Workspace-service integration coverage now includes:
  - LSP-class sessions warm index-backed read features even under no-index-required policy
  - semantic search remains overlay-aware after unsaved edits
  - stale `analysisGeneration` is rejected for tranche-3 reads
  - warm-cache restore supports index-backed semantic search and dependency-graph reads
- Daemon coverage now includes:
  - read-only RPCs for workspace symbols, dependency graph, semantic search, and architecture summary work through `WorkspaceDaemonServiceClient`
  - superseded workspace-symbol requests are suppressed as stale
  - superseded semantic-search requests are suppressed as stale
  - stale `analysisGeneration` is rejected separately for workspace symbols, dependency graph, semantic search, and architecture summary
  - replayed overlays still win over restored warm-cache state for semantic search
- LSP adapter coverage now includes:
  - `initialize` advertises `workspaceSymbolProvider`
  - `workspace/symbol` returns Codepol-owned module results
  - `codepol/*` requests reuse the active overlay-aware session
  - work-done progress covers `cold -> warming -> ready`, reopens after invalidation, and ends on error
  - reconnect-plus-progress coverage verifies status polling resumes after a recoverable daemon reconnect

### Tranche 3 Completion Notes
- `workspace/symbol` wording is now tightened to the shipped module-only `workspace_module` behavior.
- Daemon regression coverage now includes explicit `query_semantic_search` supersession plus dedicated stale-`analysisGeneration` checks for each tranche-3 read RPC.
- LSP regression coverage now includes reconnect-plus-progress behavior so status polling after daemon reconnect is covered directly.
- Tranche 3 is complete without widening into generic `definition`, `references`, `hover`, `prepareRename`, or `rename`; that deferral is now lifted for follow-up implementation.

### Reopened Follow-Up After Tranche 3
- Generic `definition`, `references`, `hover`, `prepareRename`, and `rename` are now back in scope for implementation. The earlier Codepol-owned decision notes remain useful constraints, but rollout is no longer deferred by default.
- Any future refactor or rename flow must use the defined snapshot and execution contract and continue to return `WorkspaceEditPlan`s rather than ad hoc edits.
- Keep the current LSP JSON-RPC carrier unless the documented extension-RPC threshold is met.

### Constraints Already Defined For The Reopened Follow-Up
- Capability ownership matrix:
  - per language, keep ownership explicit for which semantic classes on `definition`, `references`, `hover`, `prepareRename`, and `rename` are Codepol-owned versus delegated to `tsserver`, `Pylance`, or `Pyright`
  - keep ownership defined by semantic class, not just by LSP method name
- Exposure model:
  - use the defined split between Codepol-owned results that are safe for default LSP handlers versus those that should stay behind explicit Codepol commands or views
  - require provenance plus semantic-class labels so adapters can present alternate results without competing silently with the primary language server
- Surface-specific semantics:
  - `definition` and `references`: allowed target classes, multiplicity, ambiguity handling, relation kinds, and grouped-vs-graph presentation are captured in `TODO_CODEPOL_LSP_DEFINITION_REFERENCES_MODEL.md`.
  - `hover`: covered semantic classes, invocation contexts, payload shape, and `relation_anchor` exclusion from MVP are captured in `TODO_CODEPOL_LSP_HOVER_MODEL.md`.
  - `prepareRename` / `rename`: renameable entity classes, namespace rules, prepare requirements, preview behavior, collision policy, and user-visible failure modes are captured in `TODO_CODEPOL_LSP_RENAME_MODEL.md`.
- Snapshot and execution contract:
  - use the defined request bindings for each surface: client overlay version, replay epoch, and whether one pinned `analysisGeneration` is required
  - require correctness-sensitive rename or refactor flows to use validate-then-execute semantics and fail on snapshot drift rather than silently re-targeting newer state
- Edit-plan contract:
  - keep rename and refactor previews and execution service-owned and `WorkspaceEditPlan`-backed rather than adapter-built `WorkspaceEdit`s
  - widen `WorkspaceEditPlan` only as needed so rename or refactor plans can carry the metadata they need without falling back to ad hoc transport-specific edits
- Extension transport threshold:
  - use the defined criteria for a separate extension RPC carrier, such as long-lived subscriptions, streaming or progressive UI workflows, or extension-only interactions that do not fit the current request-response LSP JSON-RPC model
- Supporting decision docs governing implementation:
  - `TODO_CODEPOL_LSP_CAPABILITY_MATRIX.md`
  - `TODO_CODEPOL_LSP_DEFINITION_REFERENCES_MODEL.md`
  - `TODO_CODEPOL_LSP_HOVER_MODEL.md`
  - `TODO_CODEPOL_LSP_RENAME_MODEL.md`
  - `TODO_CODEPOL_LSP_SNAPSHOT_EXECUTION_CONTRACT.md`
  - `TODO_CODEPOL_LSP_FIX_MODEL.md` if rename or refactor planning reuses or extends the current edit-plan model

## Tranche 4: Replacement Program (Completed)
- Scope of the shipped tranche:
  - a JS/TS-first replacement program behind the existing workspace-service boundary
  - one real dual-path migration to prove the mechanism end to end
- Keep adapters and public interfaces stable:
  - no `WorkspaceService` surface changes
  - no daemon RPC changes
  - no new LSP methods
  - no widening of generic `hover`/`definition`/`references`/`rename` ownership
- Tranche 4 shipped in two phases:
  - `4A foundation`: analyzer ownership matrix, internal analyzer-runner contract, per-analysis scorecards, and parity/inventory coverage
  - `4B migration`: switch one real JS/TS wrapped analyzer path to Codepol-native ownership only after parity passes
- `4A` foundation is complete in the repo:
  - native tree checks and wrapped analyzers now run through one internal scorecarded contract in `packages/workspace-service`
  - JS/TS rules that expose both a tree check and a wrapped lint provider now prefer the native Codepol path before execution instead of deduping after the fact
  - wrapped-only JS/TS rules still run unchanged
  - native-owned rule failures now degrade diagnostics instead of silently falling back to wrapped output in the same analysis run
  - each analysis generation now also records an internal JS/TS wrapped-candidate inventory with ownership, wrapped platforms, recent diagnostic counts, latency buckets, and fix-surface notes for test verification
  - analyzer scorecards persist through warm-cache restore for service and daemon tests
- `4B` is complete for the first real in-tree dual-path rule:
  - `@codepol/plugin/no-unused-vars` now ships as a real non-test builtin JS/TS rule with both native and wrapped ESLint implementations, and the workspace service selects the native path before execution
  - parity is now covered for ownership reporting plus diagnostic and fix behavior on the current service, daemon, CLI, and LSP surfaces
  - do not replace generic third-party ESLint or Biome ecosystems; keep them wrapped unless Codepol owns the semantics end-to-end
- Tranche 4 itself is therefore complete:
  - one real migration was enough to prove the ownership, parity, and adapter-stability model
  - future rule migrations are optional follow-on work, not tranche-4 blockers
- Migration gate for any future `4B` candidate:
  - diagnostic code, range, severity, and source behavior must stay stable or improve
  - existing fix behavior on current CLI/LSP surfaces must be preserved or improved
  - no runtime fallback from failed native execution to wrapped output inside the same analysis pass

## Tranche 4 Coverage Now In Repo
- Service integration now covers:
  - dual-capability JS/TS rules preferring native output without double-reporting
  - wrapped-only JS/TS rules continuing to emit wrapped diagnostics
  - native-owned rule failure degrading diagnostics without wrapped fallback
  - analyzer scorecards and analyzer inventory surviving warm restore
- Daemon coverage now includes:
  - analyzer scorecard restore for a native-owned JS/TS rule across daemon incarnations
  - cancellation of a long-running external analyzer through daemon request signals
- LSP and CLI coverage now includes:
  - `@codepol/plugin/no-unused-vars` diagnostic parity on current user-facing surfaces
  - tree-backed code-action and one-shot fix behavior staying stable after native ownership selection

## Assumptions and Defaults
- Tranche 4 is complete after `4A foundation` plus the first `4B` migration for `@codepol/plugin/no-unused-vars`; future candidates stay opt-in behind the same parity gate.
- Tranche 4 shipped under a Codepol-only ownership model; the newly unblocked generic semantic surfaces are tracked as follow-up tranche work under an explicit ownership matrix.
- Fix payloads stay separate from diagnostics.
- Session-local derived indexes are an acceptable tranche-1 tradeoff; shared-index optimization is deferred.

## Tranche 5: Generic Definition, References, Hover, PrepareRename, and Rename (Unblocked)
- Scope this tranche to implementing the previously deferred generic semantic-navigation and rename surfaces through the existing shared service, daemon transport, and LSP adapter.
- Use the existing decision notes as prerequisites already satisfied:
  - capability ownership/coexistence is defined
  - surface-specific semantics are documented for `definition`/`references`, `hover`, and `prepareRename`/`rename`
  - snapshot/replay/freshness rules are defined
  - edit-plan constraints for rename/refactor execution are defined
- Keep rollout explicit:
  - preserve an ownership matrix per language and semantic class
  - do not silently compete with `tsserver`, `Pylance`, or `Pyright`
  - keep rename and refactor execution validate-then-apply and `WorkspaceEditPlan`-backed
- Workstreams:
  - service and core types: add the editor-neutral result and request shapes needed for generic `definition`, `references`, `hover`, `prepareRename`, and rename preview/apply
  - daemon transport: add RPC coverage, freshness binding, cancellation, and queue priorities for the new methods
  - LSP adapter: advertise the new capabilities, map requests/responses, and preserve coexistence rules with the primary language server
  - tests: add overlay-aware definition/reference coverage, hover freshness coverage, prepare-rename gating, rename preview/apply coverage, and stale-snapshot rejection
- Exit criteria:
  - these surfaces are no longer described as deferred in the status docs
  - overlay/replay/snapshot guarantees are enforced for each new surface
  - rename preview and apply remain auditable, bounded, and fail closed on drift or ambiguity
