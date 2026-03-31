# Codepol LSP Daemon Control Plane

This companion note expands the `Daemon discovery, launch, and version handshake` section in `TODO_CODEPOL_LSP.md`.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for the concrete daemon lifecycle contract: discovery, launch authority, compatibility, recovery, reconnect, and fallback behavior.

## When To Read This

Read this note when you are:

- implementing the shared launcher library
- defining the runtime directory layout, daemon descriptor, or launch lock
- designing the startup handshake or protocol negotiation
- handling reconnect, stale socket cleanup, or daemon replacement during upgrades
- making the editor extension, CLI, and tests share the same daemon lifecycle rules

## Decision

Define this explicitly as a daemon control plane. Treat it as part of the product surface, not incidental boot code.

Use this default contract:

- well-known local endpoint directory
- single launch authority per install
- mandatory startup handshake before any work
- strict protocol compatibility with looser engine capability compatibility
- deterministic stale lock and socket recovery
- clean fallback to in-process or per-client mode

## Recommendation

Separate these concerns:

- discovery: where a client looks
- ownership: who is allowed to start or replace the daemon
- identity: which daemon binary or build this is
- compatibility: whether client and daemon may talk
- liveness: whether the endpoint is actually usable
- recovery: how to repair stale state
- fallback: what to do if shared daemon mode is unavailable

Do not overload the socket or named pipe itself to answer all of these.

Use a small set of filesystem artifacts plus a mandatory handshake RPC.

## Filesystem Layout

Use a per-user runtime directory and a per-user state directory.

If multiple install channels may coexist, namespace the runtime and state paths by app name plus install id or channel. The examples below omit that extra segment for brevity.

### Runtime Dir

Use the runtime directory for ephemeral, machine-local, current-session artifacts.

Unix and macOS:

- prefer `$XDG_RUNTIME_DIR/<app>` when available
- otherwise use a user-private temp or runtime directory

Windows:

- use a user-scoped named pipe namespace for transport
- keep auxiliary runtime files in `%LOCALAPPDATA%\<App>\runtime`

Example logical structure:

```text
runtime/
  daemon.lock
  daemon.info.json
  daemon.sock            # unix socket, if using sockets
  launch.token          # optional launcher-owned metadata
```

### State Dir

Use the state directory for durable metadata and caches:

```text
state/
  installs/
    <engine_build_id>/
  logs/
  cache/
  compatibility/
  last-known-good.json
```

Keep runtime and state separate:

- runtime can be deleted and rebuilt
- state is reused across sessions and upgrades

## Discovery Path

Discovery should be deterministic and cheap.

Clients should resolve a daemon descriptor path first, not guess at a raw socket or pipe path.

Example:

```text
<runtime-dir>/daemon.info.json
```

The descriptor should contain enough data to identify and validate the daemon before or during connect:

```json
{
  "transport": {
    "kind": "unix_socket",
    "path": "/.../daemon.sock"
  },
  "pid": 12345,
  "started_at_unix_ms": 1774912345678,
  "protocol_version": "3.2",
  "engine_version": "1.14.0",
  "build_id": "b6f9d1a",
  "install_id": "stable",
  "session_nonce": "8f2c...",
  "owner_uid": "user123"
}
```

Why this is better:

- clients do not guess endpoint format
- transport can evolve without changing the discovery contract
- PID, build, and session data are available before normal RPCs
- stale endpoint detection is easier

### Discovery Algorithm

1. Compute the runtime directory.
2. Read `daemon.info.json` if present.
3. Validate basic ownership and permissions.
4. Probe liveness using the advertised transport.
5. If the probe succeeds, run the startup handshake.
6. If the descriptor is missing, invalid, or the probe fails, enter launch or recovery flow.

## Launch Authority

Use the client-side launcher library as the launch authority, not the extension UI and not the daemon itself.

The same launcher implementation should be reused by:

- editor extension
- CLI
- tests or tools that need daemon access

This prevents each client from inventing its own boot logic.

### Single-Launch Mechanism

Use a launch lock:

```text
runtime/daemon.lock
```

Acquire it with OS-supported exclusive locking.

Launch flow:

1. Client tries discovery.
2. If no healthy daemon exists, client acquires the launch lock.
3. After locking, client repeats discovery.
4. If the daemon is still absent or unhealthy, the lock holder spawns it.
5. Wait for the daemon descriptor and readiness handshake.
6. Release the launch lock.

That double-check after locking is required to avoid double-spawn races.

## Startup Handshake

The first RPC after transport connect should be a mandatory `hello` or `InitializeSession`.

No normal requests should begin before this completes successfully.

### Handshake Goals

The handshake should confirm:

- control-plane protocol compatibility
- engine and build identity
- auth or session nonce if used
- client identity and capabilities
- workspace expectations when relevant
- optional feature negotiation

### Client To Daemon

```json
{
  "type": "hello",
  "protocol_version": "3.2",
  "client": {
    "kind": "vscode-extension",
    "client_version": "0.9.0",
    "instance_id": "ext-host-abc",
    "supported_protocols": ["3.2", "3.1"],
    "supports_fallback_modes": ["in_process", "direct_lsp"]
  },
  "expected": {
    "install_channel": "stable"
  }
}
```

### Daemon To Client

```json
{
  "type": "hello_ack",
  "protocol_version": "3.2",
  "compatibility": "ok",
  "daemon": {
    "engine_version": "1.14.0",
    "build_id": "b6f9d1a",
    "pid": 12345,
    "session_nonce": "8f2c..."
  },
  "capabilities": {
    "lsp_proxy": true,
    "semantic_search": true,
    "impact_analysis": false
  }
}
```

### Handshake Invariants

The client must verify:

- protocol is accepted
- daemon build or channel is acceptable
- session nonce matches the descriptor when the descriptor advertised one
- transport endpoint is not stale or hijacked
- requested capabilities are compatible enough for the selected mode

No real work starts before this passes.

## Version Compatibility Rules

Use two version axes plus separate cache and schema versioning.

### A. Control-Plane Protocol Version

This governs:

- discovery descriptor schema
- handshake schema
- RPC framing and base request-response model
- lifecycle commands

This should be strict.

Recommended rule:

- major mismatch is incompatible
- minor mismatch is compatible only if the daemon explicitly accepts the client's minor
- patch mismatch is always compatible

Example:

- `3.x` client may talk to `3.y` daemon if negotiation says yes
- `2.x` client and `3.x` daemon is a hard fail

### B. Engine And Capability Version

This governs:

- semantic feature behavior
- supported queries and commands
- indexing format compatibility

This can be more flexible.

Recommended rule:

- handshake returns an explicit capability map plus engine version
- clients gate optional features on capabilities, not version strings alone

In other words:

- protocol compatibility decides whether the two sides may talk at all
- capabilities decide which features are enabled

### C. Cache And Schema Version

Keep cache and schema versioning separate again:

- index schema version
- persistent cache format version

The daemon may migrate or invalidate these independently. Do not tie them directly to extension version.

## Upgrade Rules

When the extension upgrades, use one of these paths:

### Case 1: Protocol-Compatible Daemon Already Running

- keep using it
- optionally schedule a background restart later if newer engine capabilities are desirable

### Case 2: Protocol-Incompatible Daemon Running

- do not use it
- if the launcher owns replacement policy, request controlled restart or replacement
- otherwise fail over to a fallback mode

### Case 3: Protocol-Compatible But Missing Required Capabilities

- use degraded mode
- or request restart if a newer installed daemon binary is available

Do not silently speak to an incompatible daemon and hope for the best.

## Stale Process And Stale Socket Recovery

Recovery rules must be deterministic.

### Signals Of Staleness

Any of these should count as stale:

- descriptor exists but connect fails
- PID in the descriptor no longer exists
- socket exists but handshake times out
- handshake session nonce does not match the descriptor
- daemon reports a different build than the descriptor unexpectedly
- lock metadata exists but the owning process is gone

### Recovery Algorithm

After a failed probe:

1. Acquire the launch lock.
2. Re-read the descriptor.
3. Re-probe liveness.
4. If still dead or stale, the lock holder removes stale runtime artifacts:
   - stale socket
   - stale descriptor
   - stale `launch.token` or equivalent launcher metadata if the owner is dead
5. Spawn a fresh daemon.
6. Wait for a fresh descriptor and successful handshake.
7. Release the launch lock.

Important rules:

- only the lock holder may delete shared runtime artifacts
- always re-check after locking to avoid deleting a daemon another client just launched

### Socket Cleanup

Unix socket files often remain after crashes.

Rule:

- socket file existence alone does not prove liveness
- successful handshake proves liveness

### PID Checks

PID existence is helpful but not sufficient:

- PIDs may be reused
- the process may exist but not be the expected daemon

Treat PID checks as advisory. Handshake is authoritative.

## Reconnect Behavior

Clients should tolerate daemon restarts.

Recommended client behavior when a connection drops:

1. Mark the old daemon session invalid.
2. Pause or reject in-flight requests according to request semantics.
3. Run full discovery again.
4. Reconnect.
5. Re-run the handshake.
6. Re-open workspace or session state as needed.
7. Re-send overlays, subscriptions, and replayable client state.

Treat reconnect as attaching to a new session, not as continuing the old one.

That means client state must be replayable:

- open documents
- unsaved buffers or overlays
- watched workspaces
- subscriptions
- resumable background tasks if any

## Fallback Modes

Define fallback modes in advance. Do not invent them ad hoc during error handling.

### Mode A: Shared Daemon Mode

Preferred mode:

- multi-window reuse
- warm caches
- shared background services

### Mode B: Private Per-Client Backend Mode

Fallback when shared daemon mode is unavailable or incompatible:

- client spawns a dedicated backend process
- same core, but no cross-client reuse

Use this when:

- launch lock is broken
- daemon upgrade is in conflict
- transport is unavailable
- permissions are wrong on the shared runtime directory

### Mode C: Reduced Feature Mode

If backend startup fails entirely:

- direct editor-native LSP only, if applicable
- syntax-only or basic features
- disable custom panels or heavy semantic features

### Mode D: Hard Fail

Use only when no safe degraded path exists.

### Client Policy

Make the fallback ladder explicit in code:

```text
try shared daemon
-> if unavailable and policy allows, try private backend
-> if unavailable and policy allows, try reduced mode
-> otherwise fail with actionable diagnostics
```

Do not hide fallback ambiguity from the user or logs.

## Packaging And Binary Selection

The launcher must know which daemon binary to start.

Define:

- install channel such as `stable`, `insiders`, or `dev`
- binary path resolution rules
- architecture selection rules
- signature or checksum expectations if relevant

Recommended default:

- launcher resolves the daemon binary from the extension or package assets first
- allow explicit override for dev and test scenarios
- write the resolved `build_id` into the descriptor at launch time

This helps during upgrades because a new client can detect that the running daemon came from an older build.

## CLI Interoperability

If CLI and extension should share the daemon, they must share:

- discovery rules
- launch lock rules
- handshake rules
- compatibility rules

Do not let the CLI bypass them.

Best pattern:

- one shared launcher library or package used by both
- one descriptor schema
- one recovery algorithm

Also include `client.kind` in the handshake:

- `vscode-extension`
- `cli`
- `test-runner`

This improves observability and policy decisions.

## Recommended Concrete Policy

A clean default policy is:

### Discovery

- look for `daemon.info.json` in a per-user runtime directory
- descriptor points to the actual transport endpoint

### Launch Authority

- shared launcher library acquires exclusive `daemon.lock`
- only the lock holder may spawn or clean stale artifacts

### Handshake

- mandatory `hello` before any work
- includes protocol version, client kind and version, daemon build, session identity, and capability map

### Compatibility

- control-plane protocol major must match
- protocol minor must be accepted by the daemon
- protocol patch is ignored
- optional features are gated by negotiated capabilities
- cache and index schema versions are handled separately by the daemon

### Recovery

- failed connect or failed handshake triggers locked recovery flow
- only the lock holder may remove descriptor, socket, or launch metadata
- socket existence alone never implies health

### Reconnect

- full rediscovery
- full handshake
- full session replay

### Fallback

- shared daemon
- private backend
- reduced mode
- hard fail only when nothing safe remains

Chosen mode should be visible in logs and status reporting.

## Minimal Pseudo-Flow

```text
client start
-> read daemon.info.json
-> if present, try connect
-> if connect succeeds, run hello handshake
   -> if compatible: use daemon
   -> if incompatible: go to launch or recovery policy
-> else acquire daemon.lock
   -> rediscover
   -> if healthy now: use it
   -> else cleanup stale runtime artifacts
   -> spawn daemon
   -> wait for descriptor and readiness
   -> connect and run hello handshake
   -> if success: use daemon
   -> else fallback
```

## Keep Control Plane Separate From Workspace Readiness

Do not let "daemon available?" collapse into "workspace ready?" These are separate phases:

### Phase 1: Daemon Control Plane Ready

- process is alive
- transport works
- handshake passes

### Phase 2: Workspace Attached

- workspace is opened
- config is resolved
- caches are restored
- indexing has started or been restored

### Phase 3: Feature Readiness

- completions are ready
- definitions are ready
- advanced graph or search features may still be warming

Expose these phases separately. It avoids a large class of confusing failure modes.

## Bottom Line

Lock in this operational contract:

- per-user runtime descriptor file for discovery
- shared launcher library as sole launch authority
- exclusive launch lock
- mandatory hello, version, and capability handshake
- strict protocol compatibility with flexible capability negotiation
- lock-guarded stale artifact cleanup
- explicit fallback ladder: shared daemon to private backend to reduced mode

This gives Codepol a stable lifecycle contract for:

- extension upgrades
- stale socket cleanup
- multi-client reuse
- CLI sharing
- graceful degradation

The next detailed note after this should usually cover workspace attachment and session replay, because reconnect correctness depends on it.
