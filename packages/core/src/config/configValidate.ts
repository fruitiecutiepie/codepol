import type { CodepolConfig } from './configTypes';
import type {
  LintSeverity,
  PolicyBiomeRun,
  PolicyEslintRun,
  PolicyPluginDeclaration,
  PolicyPluginSource,
  PolicyRuffRun,
  PolicyRule,
  PolicyRuleFixMode,
  PolicyRuleTarget,
  PolicyTargetMap,
  PolicyTools,
} from '../policy/policyTypes';

function valueTypeGet(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function objectIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(path: string, message: string): never {
  throw new Error(`Invalid codepol config at ${path}: ${message}`);
}

function recordExpect(value: unknown, path: string): Record<string, unknown> {
  if (!objectIsRecord(value)) {
    validationError(path, `expected object, received ${valueTypeGet(value)}`);
  }
  return value;
}

function stringExpect(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    validationError(path, `expected string, received ${valueTypeGet(value)}`);
  }
  if (value.length === 0) {
    validationError(path, 'must not be empty');
  }
  return value;
}

function stringOptional(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return stringExpect(value, path);
}

function stringArrayExpect(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    validationError(path, `expected array, received ${valueTypeGet(value)}`);
  }
  return value.map((entry, index) => stringExpect(entry, `${path}[${index}]`));
}

function stringArrayOptional(value: unknown, path: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return stringArrayExpect(value, path);
}

function integerOptional(value: unknown, path: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    validationError(path, `expected integer, received ${valueTypeGet(value)}`);
  }
  if (value <= 0) {
    validationError(path, 'must be greater than 0');
  }
  return value;
}

function keysAllowed(record: Record<string, unknown>, allowed: string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      validationError(path, `unknown key "${key}"`);
    }
  }
}

function severityOptional(value: unknown, path: string): LintSeverity | undefined {
  if (value === undefined) {
    return undefined;
  }
  const severity = stringExpect(value, path);
  if (severity !== 'error' && severity !== 'warn' && severity !== 'off') {
    validationError(path, `expected one of "error", "warn", "off", received "${severity}"`);
  }
  return severity;
}

function fixModeOptional(value: unknown, path: string): PolicyRuleFixMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const mode = stringExpect(value, path);
  if (mode !== 'on-save' && mode !== 'manual' && mode !== 'never') {
    validationError(
      path,
      `expected one of "on-save", "manual", "never", received "${mode}"`,
    );
  }
  return mode;
}

function envOptional(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = recordExpect(value, path);
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    env[key] = stringExpect(entry, `${path}.${key}`);
  }
  return env;
}

function pluginSourceParse(value: unknown, path: string): PolicyPluginSource {
  const record = recordExpect(value, path);
  const kind = stringExpect(record.kind, `${path}.kind`);

  if (kind === 'builtin') {
    keysAllowed(record, ['kind'], path);
    return { kind: 'builtin' };
  }

  if (kind === 'process') {
    keysAllowed(record, ['kind', 'command', 'args', 'cwd', 'env', 'timeoutMs'], path);
    return {
      kind: 'process',
      command: stringExpect(record.command, `${path}.command`),
      args: stringArrayOptional(record.args, `${path}.args`),
      cwd: stringOptional(record.cwd, `${path}.cwd`),
      env: envOptional(record.env, `${path}.env`),
      timeoutMs: integerOptional(record.timeoutMs, `${path}.timeoutMs`),
    };
  }

  validationError(`${path}.kind`, `expected "builtin" or "process", received "${kind}"`);
}

function pluginDeclarationParse(value: unknown, path: string): PolicyPluginDeclaration {
  const record = recordExpect(value, path);
  keysAllowed(record, ['id', 'source'], path);
  return {
    id: stringExpect(record.id, `${path}.id`),
    source: pluginSourceParse(record.source, `${path}.source`),
  };
}

function targetParse(value: unknown, path: string): PolicyRuleTarget {
  const record = recordExpect(value, path);
  keysAllowed(record, ['language', 'parser', 'files', 'exclude'], path);
  return {
    language: stringExpect(record.language, `${path}.language`),
    parser: stringOptional(record.parser, `${path}.parser`),
    files: stringArrayExpect(record.files, `${path}.files`),
    exclude: stringArrayOptional(record.exclude, `${path}.exclude`),
  };
}

function targetsParse(value: unknown, path: string): PolicyTargetMap {
  const record = recordExpect(value, path);
  const targets: PolicyTargetMap = {};
  for (const [name, target] of Object.entries(record)) {
    targets[name] = targetParse(target, `${path}.${name}`);
  }
  return targets;
}

function ruleParse(value: unknown, path: string): PolicyRule {
  const record = recordExpect(value, path);
  keysAllowed(
    record,
    ['id', 'ruleId', 'description', 'severity', 'providers', 'args', 'targets', 'fix'],
    path,
  );
  return {
    id: stringOptional(record.id, `${path}.id`),
    ruleId: stringExpect(record.ruleId, `${path}.ruleId`),
    description: stringOptional(record.description, `${path}.description`),
    severity: severityOptional(record.severity, `${path}.severity`),
    providers: stringArrayOptional(record.providers, `${path}.providers`),
    args: record.args,
    targets: stringArrayExpect(record.targets, `${path}.targets`),
    fix: fixModeOptional(record.fix, `${path}.fix`),
  };
}

function rulesParse(value: unknown, path: string): PolicyRule[] {
  if (!Array.isArray(value)) {
    validationError(path, `expected array, received ${valueTypeGet(value)}`);
  }
  return value.map((rule, index) => ruleParse(rule, `${path}[${index}]`));
}

function eslintRunParse(value: unknown, path: string): PolicyEslintRun {
  const record = recordExpect(value, path);
  keysAllowed(record, ['targets', 'configPath'], path);
  return {
    targets: stringArrayExpect(record.targets, `${path}.targets`),
    configPath: stringExpect(record.configPath, `${path}.configPath`),
  };
}

function biomeRunParse(value: unknown, path: string): PolicyBiomeRun {
  const record = recordExpect(value, path);
  keysAllowed(record, ['targets', 'biomeBin', 'configPath', 'extraArgs'], path);
  return {
    targets: stringArrayExpect(record.targets, `${path}.targets`),
    biomeBin: stringOptional(record.biomeBin, `${path}.biomeBin`),
    configPath: stringOptional(record.configPath, `${path}.configPath`),
    extraArgs: stringArrayOptional(record.extraArgs, `${path}.extraArgs`),
  };
}

function ruffRunParse(value: unknown, path: string): PolicyRuffRun {
  const record = recordExpect(value, path);
  keysAllowed(
    record,
    ['targets', 'ruffBin', 'select', 'ignore', 'configPath', 'fixable', 'extraArgs'],
    path,
  );
  return {
    targets: stringArrayExpect(record.targets, `${path}.targets`),
    ruffBin: stringOptional(record.ruffBin, `${path}.ruffBin`),
    select: stringArrayOptional(record.select, `${path}.select`),
    ignore: stringArrayOptional(record.ignore, `${path}.ignore`),
    configPath: stringOptional(record.configPath, `${path}.configPath`),
    fixable: stringArrayOptional(record.fixable, `${path}.fixable`),
    extraArgs: stringArrayOptional(record.extraArgs, `${path}.extraArgs`),
  };
}

function toolRunsParse<T>(
  value: unknown,
  path: string,
  runParse: (value: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    validationError(path, `expected array, received ${valueTypeGet(value)}`);
  }
  return value.map((run, index) => runParse(run, `${path}[${index}]`));
}

function eslintToolParse(value: unknown, path: string): NonNullable<PolicyTools['eslint']> {
  const record = recordExpect(value, path);
  keysAllowed(record, ['runs'], path);
  return {
    runs: toolRunsParse(record.runs, `${path}.runs`, eslintRunParse),
  };
}

function biomeToolParse(value: unknown, path: string): NonNullable<PolicyTools['biome']> {
  const record = recordExpect(value, path);
  keysAllowed(record, ['runs'], path);
  return {
    runs: toolRunsParse(record.runs, `${path}.runs`, biomeRunParse),
  };
}

function ruffToolParse(value: unknown, path: string): NonNullable<PolicyTools['ruff']> {
  const record = recordExpect(value, path);
  keysAllowed(record, ['runs'], path);
  return {
    runs: toolRunsParse(record.runs, `${path}.runs`, ruffRunParse),
  };
}

function toolsParse(value: unknown, path: string): PolicyTools | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = recordExpect(value, path);
  keysAllowed(record, ['eslint', 'biome', 'ruff'], path);
  return {
    eslint: record.eslint === undefined ? undefined : eslintToolParse(record.eslint, `${path}.eslint`),
    biome: record.biome === undefined ? undefined : biomeToolParse(record.biome, `${path}.biome`),
    ruff: record.ruff === undefined ? undefined : ruffToolParse(record.ruff, `${path}.ruff`),
  };
}

function pluginsParse(value: unknown, path: string): PolicyPluginDeclaration[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    validationError(path, `expected array, received ${valueTypeGet(value)}`);
  }
  return value.map((plugin, index) => pluginDeclarationParse(plugin, `${path}[${index}]`));
}

const ESLINT_CONFIG_PATH_MIGRATION_MESSAGE =
  'Top-level `eslintConfigPath` is no longer supported. Configure ESLint under `tools`:\n' +
  '\n' +
  '  [tools.eslint]\n' +
  '  [[tools.eslint.runs]]\n' +
  '  targets = ["<target-name>"]\n' +
  '  configPath = "./eslint.config.mjs"\n' +
  '\n' +
  'See docs/policy-schema.md for details.';

const TOOL_BRIDGE_RULE_IDS: Record<keyof PolicyTools, string> = {
  eslint: '@codepol/plugin/eslint',
  biome: '@codepol/plugin/biome',
  ruff: '@codepol/plugin/ruff',
};

function legacyBridgeAndToolsMixedValidate(config: {
  rules: PolicyRule[];
  tools?: PolicyTools;
}): void {
  if (!config.tools) {
    return;
  }
  for (const [toolName, ruleId] of Object.entries(TOOL_BRIDGE_RULE_IDS) as Array<
    [keyof PolicyTools, string]
  >) {
    const tool = config.tools[toolName];
    if (!tool?.runs || tool.runs.length === 0) {
      continue;
    }
    if (!config.rules.some((rule) => rule.ruleId === ruleId)) {
      continue;
    }
    validationError(
      `config.tools.${toolName}.runs`,
      `cannot be used together with legacy bridge rule "${ruleId}" in config.rules`,
    );
  }
}

export function configValidate(raw: unknown): CodepolConfig {
  const record = recordExpect(raw, 'config');
  if ('eslintConfigPath' in record) {
    validationError('config.eslintConfigPath', ESLINT_CONFIG_PATH_MIGRATION_MESSAGE);
  }
  keysAllowed(record, ['targets', 'rules', 'exclude', 'plugins', 'tools'], 'config');

  const config: CodepolConfig = {
    targets: targetsParse(record.targets, 'config.targets'),
    rules: rulesParse(record.rules, 'config.rules'),
    exclude: stringArrayOptional(record.exclude, 'config.exclude'),
    plugins: pluginsParse(record.plugins, 'config.plugins'),
    tools: toolsParse(record.tools, 'config.tools'),
  };
  legacyBridgeAndToolsMixedValidate(config);

  return config;
}
