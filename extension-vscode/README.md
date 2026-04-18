# Codepol VS Code Extension

This package hosts the thin VS Code client for the existing Codepol LSP.

## Local Development

1. Run `pnpm install` from the repo root.
2. Run `pnpm run build:extension-vscode-stack`.
3. Open the repo root in standard VS Code.
4. In `Run and Debug`, launch `Codepol Extension: Fixture Workspace` or `Codepol Extension: Current Repo Workspace`.

Useful local helpers:

- `pnpm run dev:extension-vscode-stack`
- `pnpm run test:extension-vscode:smoke`
- `pnpm run package:extension-vscode:vsix`

The checked-in VS Code tasks and launch config live at the repo root in `.vscode/`.

## Packaging

Run `pnpm run package:extension-vscode:vsix` from the repo root to build a local installable VSIX at `artifacts/codepol-extension-vscode.vsix`.

The packaging flow builds dedicated bundled `extension.js`, `lsp.js`, and `daemon.js` runtime entries into `dist-vsix/`, copies the required Tree-sitter WASM assets, stages that bundled payload into a clean extension, runs `vsce`, and verifies that the VSIX contains the bundled runtime files without `node_modules`.

## Diagnostics settings and commands

The extension exposes the Codepol diagnostics runtime through three settings
and four commands. Changes relay through the LSP to the daemon, so every
Codepol process running for this workspace sees the same configuration.

### Settings (`codepol.diagnostics.*`)

| Setting | Type | Default | Description |
| ------- | ---- | ------- | ----------- |
| `environment` | enum `user` / `dev` / `test` / `verbose` | `user` | Named preset. `user` is safe field posture, `verbose` is the only truly loud preset. |
| `overrides` | object (`Partial<RuntimeDiagnosticsPolicy>`) | `{}` | Overlay layered on top of the preset: `level`, `scopes.<name>`, `tracing.enabled` / `.sampleRate`, `metrics.enabled`, `snapshots.enabled` / `.maxBytes`, `checks.invariants`, `redaction.mode`, `sinks`, `logFilePath`, `otelEndpoint`. |
| `escalations` | array of `{ scope, level, ttlSec, reason }` | `[]` | Standing escalations applied on activation. `scope` accepts `global`, `scope:<dotted>`, `request:<id>`, `workspace:<id>`. |

### Commands

| Command id | Title |
| ---------- | ----- |
| `codepol.extension.setDiagnosticsEnvironment` | Codepol: Set Diagnostics Environment |
| `codepol.extension.addDiagnosticsEscalation` | Codepol: Add Diagnostics Escalation |
| `codepol.extension.clearDiagnosticsEscalations` | Codepol: Clear Diagnostics Escalations |
| `codepol.extension.showDiagnosticsConfig` | Codepol: Show Current Diagnostics Config |

Under the hood the extension calls `workspace/executeCommand` with
`codepol.diagnostics.configure` (config changes),
`codepol.diagnostics.escalate`, and
`codepol.diagnostics.revokeEscalation`. The LSP forwards each call to the
daemon so escalations are process-global on the daemon side. See
[../packages/core/src/diagnostics/README.md](../packages/core/src/diagnostics/README.md)
for the underlying model.

## Fix on save

Codepol exposes a `source.fixAll.codepol` code action that merges every
rule whose `codepol.toml` entry declares `fix = "on-save"` into a single
`EditPlan`. To run it automatically on save, add this to your VS Code
settings:

```jsonc
"editor.codeActionsOnSave": {
  "source.fixAll.codepol": "explicit"
}
```

Per-rule variants are published as `source.fixAll.codepol.<ruleId>` — for
example, the language client can request
`source.fixAll.codepol.@codepol/plugin/enforce-casing` to apply only that
rule's fixes. Rules with `fix = "never"` (or `severity = "off"`) are
hidden from every code-action surface, including the standard quickfix
lightbulb.

## Smoke Test

Run `pnpm --dir extension-vscode test:smoke` after building to launch a standard VS Code extension test host against the bundled fixture workspace.

If you are running inside Cursor or another nonstandard VS Code-compatible shell, prefer the GitHub Actions smoke job for a trustworthy result.
