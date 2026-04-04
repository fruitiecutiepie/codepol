# Codepol LSP Continuation Plan

## Summary
- Implement the next milestone as a **big-bang replacement** of the current document-based `WorkspaceService` with a **sessionized in-process service**.
- Keep Phase 4 scoped to **Codepol-owned semantics only**. Do not add generic hover or generic rename that compete with `tsserver`, `Pylance`, or `Pyright`.
- Keep `WorkspaceDiagnostic` narrow. Fixes remain surfaced through `WorkspaceCodeAction` and `WorkspaceEditPlan`, not embedded into diagnostics.
- Optimize tranche 1 for **overlay isolation correctness**, not shared-index performance.

## Tranche 1: Sessionized In-Process Service
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
- Add a dedicated daemon entrypoint over the same sessionized service engine.
- Implement launcher ownership, runtime descriptor, lock file, and mandatory `hello` handshake before normal requests.
- Implement session protocol operations from the design docs: `register_client_session`, `attach_workspace`, replay of overlays/subscriptions, and `complete_replay`.
- Introduce explicit readiness phases: daemon ready, client registered, workspace attached, workspace ready, and feature ready.
- Add file watching, invalidation, background indexing, and warm-start persistence behind the same workspace/session model.
- Formalize request/result freshness metadata with `daemonSessionId`, `workspaceInstanceId`, `clientSessionId`, overlay versions, and `analysisGeneration`.
- Add cancellation and prioritization. Superseded or canceled work may continue internally, but it must not publish diagnostics or status as current.
- Make `queryIndexStatus` the source for cold-start progress and health reporting, not just a ready/counts snapshot.

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