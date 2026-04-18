// Repro driver: drive the tree-check path against the current repo
// using the public policyViolationsGetFromDir API.

const path = require('node:path');
const {
  configGet,
  policyPluginsGet,
  ruleMatchesGet,
  policyViolationsGetForFile,
  parserInit,
  langAdd,
  isErr,
  pluginBuiltinRegister,
  diagnosticsRuntimeSetConfig,
} = require('../packages/core/dist/index.js');

diagnosticsRuntimeSetConfig({
  environment: 'dev',
  overrides: {
    level: 'debug',
    scopes: { parser: 'trace', 'workspace.analyzer': 'debug' },
    tracing: { enabled: true, sampleRate: 1 },
  },
});
const codepolBuiltinExports = require('../packages/plugin/dist/index.js');
const codepolBuiltin = codepolBuiltinExports.default ?? codepolBuiltinExports;

(async () => {
  pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

  langAdd({ langId: 'typescript', fileExtensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx', '.jsx'] });
  langAdd({ langId: 'python', fileExtensions: ['.py', '.pyw'] });
  await parserInit();

  const cwd = process.cwd();
  const { config, configPath } = await configGet(cwd);
  const policy = config;
  console.error(
    `[repro] policy: rules=${(policy.rules || []).length} targets=${Object.keys(policy.targets || {}).join(',')}`,
  );

  const pluginsResult = await policyPluginsGet(policy, cwd, { configPath });
  if (isErr(pluginsResult)) {
    console.error('[repro] plugins load failed:', pluginsResult.Err);
    process.exit(2);
  }
  const pluginsMap = pluginsResult.Ok;
  console.error(`[repro] plugins loaded: ${pluginsMap.size}`);

  const matches = await ruleMatchesGet(policy, cwd);
  console.error(`[repro] rule matches: ${matches.length}`);

  const treeMatches = matches.filter((m) => {
    if (m.rule.providers && m.rule.providers.length > 0) {
      return m.rule.providers.includes('tree-sitter');
    }
    // Walk plugins map entries: value shape is { plugin, pluginRule?, resolvedId? }
    for (const entry of pluginsMap.values()) {
      const pr = entry.pluginRule ?? entry.plugin?.pluginRule;
      if (!pr) continue;
      const resolvedId = entry.resolvedId ?? pr.id;
      if (m.rule.ruleId === resolvedId || m.rule.ruleId.endsWith('/' + pr.id)) {
        return Boolean(pr.capabilities?.treeCheckProvider);
      }
    }
    return false;
  });
  console.error(`[repro] tree-check matches: ${treeMatches.length}`);
  for (const m of treeMatches) {
    console.error(`  - ruleId=${m.rule.ruleId} files=${m.files.length}`);
  }

  const failures = [];
  let attempts = 0;
  for (const match of treeMatches) {
    for (const filePath of match.files) {
      attempts++;
      const result = policyViolationsGetForFile(
        filePath,
        match.rule,
        match.target,
        policy,
        pluginsMap,
        cwd,
        configPath,
        undefined,
        undefined,
      );
      if (isErr(result)) {
        failures.push({ ruleId: match.rule.ruleId, filePath, error: result.Err });
        if (failures.length <= 5) {
          console.error(
            `[repro] FAILURE #${failures.length}: rule=${match.rule.ruleId} file=${filePath}\n    err=${result.Err}`,
          );
        }
      }
    }
  }

  console.error(`[repro] summary: attempts=${attempts} failures=${failures.length}`);
  process.exit(failures.length > 0 ? 1 : 0);
})().catch((err) => {
  console.error('[repro] fatal:', err?.stack || err);
  process.exit(3);
});
