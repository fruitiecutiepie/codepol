# Codepol VS Code Extension

This package hosts the thin VS Code client for the existing Codepol LSP.

## Local Development

1. Run `pnpm install` from the repo root.
2. Run `pnpm --dir extension-vscode build`.
3. Open the repo in VS Code.
4. Start an Extension Development Host and load the extension from `extension-vscode/`.

## Smoke Test

Run `pnpm --dir extension-vscode test:smoke` after building to launch a standard VS Code extension test host against the bundled fixture workspace.

If you are running inside Cursor or another nonstandard VS Code-compatible shell, prefer the GitHub Actions smoke job for a trustworthy result.
