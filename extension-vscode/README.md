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

The packaging flow packs the workspace runtime packages into local tarballs, installs them into a clean staging extension with `npm install --omit=dev`, prunes non-runtime dependency artifacts from `node_modules`, runs `vsce`, and verifies that the VSIX contains the bundled Codepol runtime packages and Tree-sitter WASM assets.

## Smoke Test

Run `pnpm --dir extension-vscode test:smoke` after building to launch a standard VS Code extension test host against the bundled fixture workspace.

If you are running inside Cursor or another nonstandard VS Code-compatible shell, prefer the GitHub Actions smoke job for a trustworthy result.
