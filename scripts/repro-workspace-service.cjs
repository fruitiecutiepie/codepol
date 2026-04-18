// Drive the workspace-service policyCheck API — same entry point the
// extension/daemon/LSP use for the "Run policy checks" flow.

const path = require('node:path');
const { policyCheck } = require('../packages/workspace-service/dist/index.js');
const { diagnosticsRuntimeSetConfig } = require('../packages/core/dist/index.js');

diagnosticsRuntimeSetConfig({
  level: 'debug',
  scopes: { parser: 'trace', 'workspace.analyzer': 'debug' },
  policy: { includeTiming: true },
});

(async () => {
  const cwd = process.cwd();
  console.error('[repro-ws] cwd=', cwd);
  try {
    const result = await policyCheck({
      cwd,
      env: process.env,
      configPath: 'codepol.toml',
      fix: false,
    });
    console.error(
      '[repro-ws] result:',
      JSON.stringify(
        {
          files: result.files?.length,
          violations: result.violations?.length,
          treeViolations: result.treeViolations?.length,
          diagnostics: result.workspaceDiagnostics?.length,
          eslintHasErrors: result.eslintHasErrors,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error('[repro-ws] threw:', err?.stack || err);
    process.exit(2);
  }
})();
