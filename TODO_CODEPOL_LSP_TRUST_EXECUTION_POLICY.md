# Codepol LSP Trust, Sandbox, and Execution Policy

This companion note expands the `Trust and sandboxing model` section in `TODO_CODEPOL_LSP.md`.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for the concrete execution policy: trust layers, tool origin classes, capability gating, environment profiles, cwd validation, resource ceilings, approval prompts, and audit behavior.

## When To Read This

Read this note when you are:

- defining workspace trust persistence or approval storage
- integrating process plugins, external linters, or repo-local helper executables
- designing the execution request schema, policy engine, or process supervisor
- deciding env passthrough, cwd restrictions, or resource-profile defaults
- designing blocked-execution UX, trust prompts, or execution audit logs
- deciding how network and filesystem access should be modeled for daemon-run tools

## Decision

Define this as a centralized daemon-host subsystem, not a few scattered checks inside tool adapters.

Use these separate concepts:

- daemon trust: baseline posture of the long-lived daemon process
- workspace trust: whether one workspace is allowed to request external execution at all
- tool or plugin trust: whether one executable origin is approved
- capability class: what kind of execution the feature is asking for
- execution supervisor: the runtime layer that applies env, cwd, timeout, memory, and cancellation limits

The core rule is:

```text
open workspace != permission to execute repo-defined code
```

## Recommendation

Model every external launch as a policy decision over explicit inputs.

Conceptually:

```text
ExecutionRequest = (
  daemon_session_id,
  workspace_id,
  workspace_instance_id,
  workspace_trust,
  tool_origin,
  capability_class,
  executable_id,
  executable_path?,
  cwd,
  env_profile,
  requested_env_classes[],
  network_policy,
  filesystem_policy,
  resource_profile,
  user_initiated
)
```

The policy engine returns:

```text
allow
allow_once
prompt
deny
```

Along with the concrete execution envelope:

- resolved executable path
- sanitized child environment
- canonicalized cwd
- applied timeout, memory, and concurrency ceilings
- logging and prompt metadata

## Baseline Daemon Posture

The daemon runs as the user, but it must not act like a general shell with ambient authority.

Defaults:

- do not automatically execute workspace-defined commands
- do not automatically execute process plugins declared by repo config
- do not automatically run repo-local binaries from `.venv`, `node_modules/.bin`, `target`, `build`, or similar paths
- do not pass the full daemon environment to child processes
- do not treat "feature asked to run a tool" as sufficient policy by itself

The daemon is a capability host, not a blanket executor.

## Trust Layers

### 1. Daemon Trust

This is the baseline privilege of the host process.

Requirements:

- run with least-surprising defaults
- centralize policy decisions in the daemon host
- keep adapters declarative so they request capabilities instead of enforcing their own security policy

### 2. Workspace Trust

Each workspace gets an explicit trust state.

Start with:

```text
untrusted
trusted
```

`trusted_with_execution` can be added later if the product wants a separate UX state, but it is not required for the first version because capability- and origin-specific approvals already add finer control.

Persist trust by stable workspace identity, at minimum:

- canonical root path

Optional additional identity inputs:

- repo remote fingerprint
- config fingerprint
- prior user confirmation record

Rules:

- new workspaces default to `untrusted`
- trust is explicit and revocable
- opening a folder never grants execution rights
- parent and child workspaces do not inherit trust unless the product defines that explicitly
- cloned repos and extracted archives do not inherit trust automatically

### 3. Tool And Plugin Trust

Even in a trusted workspace, not every executable is equally trusted.

Classify tool origin at least as:

- `builtin`: shipped with the product
- `user_global`: chosen by user settings from a global path
- `workspace_configured_global`: repo config selects a global executable or command
- `workspace_local`: executable lives under the workspace or dependency tree
- `downloaded_runtime`: helper binary or runtime fetched on demand
- `plugin_process`: process plugin launched out of process

Recommended trust order:

```text
builtin > user_global > workspace_configured_global > plugin_process > workspace_local
```

`downloaded_runtime` should be treated as high-risk unless it is product-managed and verifiably versioned.

## Capability Classes

Do not model external execution as one bucket.

Use capability classes such as:

- `static_analysis`
- `linting`
- `formatting`
- `build_metadata_probe`
- `test_discovery`
- `code_generation`
- `arbitrary_command`
- `process_plugin`

These are policy inputs, not just labels for logging.

Examples:

- `linting` may be allowed in a trusted workspace for approved tools
- `process_plugin` requires both workspace trust and plugin approval
- `arbitrary_command` is explicit-user-only
- `code_generation` must never run on file-open or background warm-up

## Default Policy By Trust State

### Untrusted Workspace

Allow:

- parse files
- index files
- read config files as data
- run bundled in-process analyzers that do not spawn processes

Block:

- process plugins
- repo-configured external tools
- workspace-local executables
- arbitrary shell commands
- secret-bearing env passthrough
- networked helpers unless separately approved
- any background tool that can mutate workspace contents

### Trusted Workspace

Trusted means external execution may become eligible. It does not mean every execution request is allowed.

Allow automatically:

- built-in analyzers and helpers
- `user_global` linters and formatters chosen by user settings
- sanitized env profiles with no secret classes by default
- cwd within allowed workspace or temp roots
- bounded time, memory, process-tree, and concurrency limits

Require extra approval:

- `workspace_configured_global` commands when the repo chooses the executable or command line
- `workspace_local` executables
- `plugin_process`
- `downloaded_runtime` that is not product-managed
- extra env classes beyond the default profile
- network use beyond the tool's default policy

Allow only on explicit user action:

- `arbitrary_command`
- write-capable `code_generation`
- build or test flows that can mutate the repo or consume broad secrets
- any request that exceeds the default resource profile

## Execution Request Shape

The daemon should normalize tool launches into a stable request shape before policy evaluation.

Recommended fields:

```text
ExecutionRequest {
  feature_id
  workspace_id
  workspace_instance_id
  workspace_trust
  tool_origin
  capability_class
  tool_id
  executable_path?
  requested_args[]
  cwd
  env_profile
  requested_env_classes[]
  network_policy
  filesystem_policy
  resource_profile
  user_initiated
}
```

Keep business logic out of the raw subprocess call site. Tool adapters should declare this request and let the policy engine decide.

## Environment Policy

Default to deny-by-default env passthrough.

Child processes should receive a sanitized environment built from:

- a minimal base profile
- a small allowlist
- tool-specific additions
- optional workspace-scoped explicit grants

Useful env classes:

- `runtime_basic`
- `developer_tools`
- `vcs_auth`
- `cloud_credentials`
- `custom_secrets`

Sensitive categories to block by default:

- `AWS_*`, `GCP_*`, `AZURE_*`
- package registry tokens
- `OPENAI_API_KEY` and similar service tokens
- database URLs and connection secrets
- SSH agent or socket variables
- CI-only secret variables

Rules:

- workspace config must not request unrestricted env passthrough without a strong approval path
- do not support "pass everything through" as a silent default
- prefer class-based approval over free-form env key lists in most UX
- surface missing env access as a structured policy failure, not a generic tool crash

## CWD Policy

Restrict cwd to known-safe roots.

Allow:

- workspace root
- subdirectories of workspace root
- explicitly approved tool working directories under the workspace
- daemon-managed temp directories

Disallow by default:

- arbitrary cwd outside the workspace or temp policy
- symlink escapes that canonicalize outside approved roots

Rules:

- canonicalize before validation
- default cwd to workspace root
- let tools request a subdirectory only when needed
- log the final resolved cwd on every launch

## Resource Profiles And Supervision

Every execution runs as a supervised job.

At minimum enforce:

- wall-clock timeout
- optional idle-output timeout for chatty tools
- memory ceiling
- process-tree kill on cancellation or timeout where supported
- max subprocess count
- max concurrent executions per workspace

Starting profiles:

```text
interactive: timeout 3000 ms, memory 256 MiB
background:  timeout 30000 ms, memory 512 MiB
explicit:    timeout 300000 ms, memory 2048 MiB
```

These numbers are starting defaults, not protocol constants.

Record at least:

- exit code
- timeout hit
- memory-limit hit
- stderr summary
- whether the run was auto-triggered or user-invoked

## Network And Filesystem Policy

Even if the first implementation cannot enforce OS-level sandboxing everywhere, the policy model should still express intent.

Recommended network classes:

- `none`
- `approved_tooling`
- `explicit_user_only`

Recommended filesystem classes:

- `read_workspace`
- `write_workspace`
- `write_temp`
- `write_outside_workspace`

Defaults:

- auto-run diagnostics and metadata probes are read-only
- temp writes are allowed when required for tool operation
- writes outside the workspace are denied unless explicitly user-invoked and approved
- network use should be denied unless the tool category is expected to need it or the user explicitly asked for it

## Approval Prompts

Prompts should be capability- and origin-specific, not broad "run code?" dialogs.

Prompt when:

- an untrusted workspace first requests external execution
- a workspace-local executable or process plugin is requested
- a tool requests extra env classes or network access beyond default policy

Each prompt should identify:

- feature name
- executable or plugin id
- origin classification
- resolved path when available
- cwd
- requested env classes
- requested network or filesystem policy when relevant

Recommended choices:

- allow once
- allow for this workspace
- deny

Use a stronger prompt tier for `workspace_local`, `plugin_process`, and non-product-managed `downloaded_runtime`.

## Failure Surface

Do not turn policy into prompt spam.

Show clear structured failure states such as:

- blocked by workspace trust
- blocked by tool approval policy
- missing env class grant
- cwd denied
- executable not found
- timed out
- exceeded memory ceiling

Repeated failures should show up in status or logs without forcing modal prompts every time.

## Audit And Status

The daemon should emit structured execution records for observability and debugging.

Capture at least:

- workspace id and trust state
- capability class
- tool origin and tool id
- resolved executable path
- cwd
- env profile and granted env classes
- network and filesystem policy
- resource profile
- auto-run vs user-invoked
- decision outcome
- exit or failure summary

This is important for both security review and operational debugging.

## Internal Split

Keep the policy boundary centralized.

A clean split is:

- tool descriptor: what the tool is and where it comes from
- execution request: what this invocation wants to do now
- policy engine: whether it may run and under which constraints
- execution supervisor: how it is launched, monitored, and killed
- trust and approval store: what the user has granted already
- audit surface: what happened and why

This prevents every integration from re-implementing security policy in slightly different ways.

## Bottom Line

Use this default stance:

- require explicit workspace trust before any external process execution
- default-deny process plugins and workspace-local executables until separately approved
- pass sanitized allowlisted env, not ambient daemon env
- restrict cwd to workspace roots and managed temp dirs
- run every child process under centralized time, memory, process-tree, and concurrency limits
- keep prompts specific to capability and tool origin
- make the daemon host the single policy owner
