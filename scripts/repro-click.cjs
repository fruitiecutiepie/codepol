// Drive the in-process workspace engine exactly like the extension's LSP +
// daemon do when the sidebar renders a rule and the user clicks one.

const path = require('node:path');
const fs = require('node:fs');

const logFilePath = '/tmp/codepol-parse-debug.log';
try {
  fs.unlinkSync(logFilePath);
} catch {}

const {
  workspaceServiceCreate,
} = require('../packages/workspace-service/dist/index.js');
const {
  diagnosticsRuntimeSetConfig,
} = require('../packages/core/dist/index.js');

diagnosticsRuntimeSetConfig({
  environment: 'dev',
  overrides: {
    level: 'debug',
    scopes: { parser: 'trace', 'workspace.analyzer': 'debug' },
    sinks: ['console', 'file'],
    logFilePath,
    tracing: { enabled: true, sampleRate: 1 },
  },
});

(async () => {
  const cwd = process.cwd();
  const service = workspaceServiceCreate();

  const { clientSessionId } = await service.registerClientSession({
    clientKind: 'lsp',
    clientInstanceId: `codepol-repro-${process.pid}`,
  });
  console.error('[repro-click] registered clientSessionId=', clientSessionId);

  const { workspaceId, workspaceInstanceId } = await service.attachWorkspace({
    clientSessionId,
    rootPath: cwd,
    configPath: 'codepol.toml',
  });
  console.error('[repro-click] attached workspaceId=', workspaceId);

  // Extension completes the replay handshake before it queries.
  await service.completeReplay({ clientSessionId, workspaceId, workspaceInstanceId });

  // First, queryLintRules to get the rule ids (what the sidebar renders).
  const rulesResult = await service.queryLintRules({
    clientSessionId,
    workspaceId,
    requestId: 'r1',
  });
  console.error(
    '[repro-click] rules summary count=',
    rulesResult?.rules?.length,
  );

  // Now click each rule in turn (this is what the sidebar does on click).
  for (const rule of rulesResult.rules) {
    try {
      const details = await service.queryLintRuleDetails({
        clientSessionId,
        workspaceId,
        ruleId: rule.ruleId,
        requestId: `details-${rule.ruleId}`,
      });
      console.error(
        `[repro-click] rule=${rule.ruleId} diagnosticCount=${details?.totalDiagnosticCount ?? 'null'}`,
      );
    } catch (err) {
      console.error(
        `[repro-click] rule=${rule.ruleId} THREW:`,
        err?.stack || err,
      );
    }
  }

  console.error('[repro-click] done');
  process.exit(0);
})().catch((err) => {
  console.error('[repro-click] fatal:', err?.stack || err);
  process.exit(3);
});
