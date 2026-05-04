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
import { andThen, Err, Ok, type Result, resultAll } from '../result/result';
import { WorkspaceFault } from '../workspace/workspaceFault';

function valueTypeGet(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function objectIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configErr(path: string, message: string): Result<never, WorkspaceFault> {
  return Err(new WorkspaceFault(`Invalid codepol config at ${path}: ${message}`));
}

function recordExpect(
  value: unknown,
  path: string
): Result<Record<string, unknown>, WorkspaceFault> {
  if (!objectIsRecord(value)) {
    return configErr(path, `expected object, received ${valueTypeGet(value)}`);
  }
  return Ok(value);
}

function stringExpect(value: unknown, path: string): Result<string, WorkspaceFault> {
  if (typeof value !== 'string') {
    return configErr(path, `expected string, received ${valueTypeGet(value)}`);
  }
  if (value.length === 0) {
    return configErr(path, 'must not be empty');
  }
  return Ok(value);
}

function stringOptional(
  value: unknown,
  path: string
): Result<string | undefined, WorkspaceFault> {
  if (value === undefined) {
    return Ok(undefined);
  }
  return stringExpect(value, path);
}

function stringArrayExpect(value: unknown, path: string): Result<string[], WorkspaceFault> {
  if (!Array.isArray(value)) {
    return configErr(path, `expected array, received ${valueTypeGet(value)}`);
  }
  const parts: Result<string, WorkspaceFault>[] = value.map((entry, index) =>
    stringExpect(entry, `${path}[${index}]`)
  );
  return resultAll(parts);
}

function stringArrayOptional(
  value: unknown,
  path: string
): Result<string[] | undefined, WorkspaceFault> {
  if (value === undefined) {
    return Ok(undefined);
  }
  return stringArrayExpect(value, path);
}

function integerOptional(
  value: unknown,
  path: string
): Result<number | undefined, WorkspaceFault> {
  if (value === undefined) {
    return Ok(undefined);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return configErr(path, `expected integer, received ${valueTypeGet(value)}`);
  }
  if (value <= 0) {
    return configErr(path, 'must be greater than 0');
  }
  return Ok(value);
}

function keysAllowed(
  record: Record<string, unknown>,
  allowed: string[],
  path: string
): Result<void, WorkspaceFault> {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      return configErr(path, `unknown key "${key}"`);
    }
  }
  return Ok(undefined);
}

function severityOptional(
  value: unknown,
  path: string
): Result<LintSeverity | undefined, WorkspaceFault> {
  if (value === undefined) {
    return Ok(undefined);
  }
  return andThen(stringExpect(value, path), (severity) => {
    if (severity !== 'error' && severity !== 'warn' && severity !== 'off') {
      return configErr(path, `expected one of "error", "warn", "off", received "${severity}"`);
    }
    return Ok(severity);
  });
}

function fixModeOptional(
  value: unknown,
  path: string
): Result<PolicyRuleFixMode | undefined, WorkspaceFault> {
  if (value === undefined) {
    return Ok(undefined);
  }
  return andThen(stringExpect(value, path), (mode) => {
    if (mode !== 'on-save' && mode !== 'manual' && mode !== 'never') {
      return configErr(
        path,
        `expected one of "on-save", "manual", "never", received "${mode}"`,
      );
    }
    return Ok(mode);
  });
}

function envOptional(
  value: unknown,
  path: string
): Result<Record<string, string> | undefined, WorkspaceFault> {
  if (value === undefined) {
    return Ok(undefined);
  }
  return andThen(recordExpect(value, path), (record) => {
    let combined: Result<Record<string, string>, WorkspaceFault> = Ok({});
    for (const [key, entry] of Object.entries(record)) {
      combined = andThen(combined, (env) =>
        andThen(stringExpect(entry, `${path}.${key}`), (s) => Ok({ ...env, [key]: s }))
      );
    }
    return combined;
  });
}

function pluginSourceParse(
  value: unknown,
  path: string
): Result<PolicyPluginSource, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(stringExpect(record.kind, `${path}.kind`), (kind): Result<PolicyPluginSource, WorkspaceFault> => {
      if (kind === 'builtin') {
        return andThen(keysAllowed(record, ['kind'], path), () => Ok({ kind: 'builtin' }));
      }
      if (kind === 'process') {
        return andThen(
          keysAllowed(record, ['kind', 'command', 'args', 'cwd', 'env', 'timeoutMs'], path),
          () =>
            andThen(stringExpect(record.command, `${path}.command`), (command) =>
              andThen(stringArrayOptional(record.args, `${path}.args`), (args) =>
                andThen(stringOptional(record.cwd, `${path}.cwd`), (cwd) =>
                  andThen(envOptional(record.env, `${path}.env`), (env) =>
                    andThen(integerOptional(record.timeoutMs, `${path}.timeoutMs`), (timeoutMs) =>
                      Ok({
                        kind: 'process',
                        command,
                        args,
                        cwd,
                        env,
                        timeoutMs,
                      })
                    )
                  )
                )
              )
            )
        );
      }
      return configErr(`${path}.kind`, `expected "builtin" or "process", received "${kind}"`);
    })
  );
}

function pluginDeclarationParse(
  value: unknown,
  path: string
): Result<PolicyPluginDeclaration, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(keysAllowed(record, ['id', 'source'], path), () =>
      andThen(stringExpect(record.id, `${path}.id`), (id) =>
        andThen(pluginSourceParse(record.source, `${path}.source`), (source) =>
          Ok({ id, source })
        )
      )
    )
  );
}

function targetParse(value: unknown, path: string): Result<PolicyRuleTarget, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(keysAllowed(record, ['language', 'parser', 'files', 'exclude'], path), () =>
      andThen(stringExpect(record.language, `${path}.language`), (language) =>
        andThen(stringOptional(record.parser, `${path}.parser`), (parser) =>
          andThen(stringArrayExpect(record.files, `${path}.files`), (files) =>
            andThen(stringArrayOptional(record.exclude, `${path}.exclude`), (exclude) =>
              Ok({ language, parser, files, exclude })
            )
          )
        )
      )
    )
  );
}

function targetsParse(value: unknown, path: string): Result<PolicyTargetMap, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) => {
    const entries = Object.entries(record).map(([name, target]) =>
      andThen(targetParse(target, `${path}.${name}`), (t) => Ok([name, t] as const))
    );
    return andThen(resultAll(entries), (pairs) => {
      const targets: PolicyTargetMap = {};
      for (const [name, t] of pairs) {
        targets[name] = t;
      }
      return Ok(targets);
    });
  });
}

function ruleParse(value: unknown, path: string): Result<PolicyRule, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(
      keysAllowed(
        record,
        ['id', 'ruleId', 'description', 'severity', 'providers', 'args', 'targets', 'fix'],
        path,
      ),
      () =>
        andThen(stringOptional(record.id, `${path}.id`), (id) =>
          andThen(stringExpect(record.ruleId, `${path}.ruleId`), (ruleId) =>
            andThen(stringOptional(record.description, `${path}.description`), (description) =>
              andThen(severityOptional(record.severity, `${path}.severity`), (severity) =>
                andThen(stringArrayOptional(record.providers, `${path}.providers`), (providers) =>
                  andThen(stringArrayExpect(record.targets, `${path}.targets`), (targets) =>
                    andThen(fixModeOptional(record.fix, `${path}.fix`), (fix) =>
                      Ok({
                        id,
                        ruleId,
                        description,
                        severity,
                        providers,
                        args: record.args,
                        targets,
                        fix,
                      })
                    )
                  )
                )
              )
            )
          )
        )
    )
  );
}

function rulesParse(value: unknown, path: string): Result<PolicyRule[], WorkspaceFault> {
  if (!Array.isArray(value)) {
    return configErr(path, `expected array, received ${valueTypeGet(value)}`);
  }
  return resultAll(value.map((rule, index) => ruleParse(rule, `${path}[${index}]`)));
}

function eslintRunParse(value: unknown, path: string): Result<PolicyEslintRun, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(keysAllowed(record, ['targets', 'configPath'], path), () =>
      andThen(stringArrayExpect(record.targets, `${path}.targets`), (targets) =>
        andThen(stringExpect(record.configPath, `${path}.configPath`), (configPath) =>
          Ok({ targets, configPath })
        )
      )
    )
  );
}

function biomeRunParse(value: unknown, path: string): Result<PolicyBiomeRun, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(
      keysAllowed(record, ['targets', 'biomeBin', 'configPath', 'extraArgs'], path),
      () =>
        andThen(stringArrayExpect(record.targets, `${path}.targets`), (targets) =>
          andThen(stringOptional(record.biomeBin, `${path}.biomeBin`), (biomeBin) =>
            andThen(stringOptional(record.configPath, `${path}.configPath`), (configPath) =>
              andThen(stringArrayOptional(record.extraArgs, `${path}.extraArgs`), (extraArgs) =>
                Ok({ targets, biomeBin, configPath, extraArgs })
              )
            )
          )
        )
    )
  );
}

function ruffRunParse(value: unknown, path: string): Result<PolicyRuffRun, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(
      keysAllowed(
        record,
        ['targets', 'ruffBin', 'select', 'ignore', 'configPath', 'fixable', 'extraArgs'],
        path,
      ),
      () =>
        andThen(stringArrayExpect(record.targets, `${path}.targets`), (targets) =>
          andThen(stringOptional(record.ruffBin, `${path}.ruffBin`), (ruffBin) =>
            andThen(stringArrayOptional(record.select, `${path}.select`), (select) =>
              andThen(stringArrayOptional(record.ignore, `${path}.ignore`), (ignore) =>
                andThen(stringOptional(record.configPath, `${path}.configPath`), (configPath) =>
                  andThen(stringArrayOptional(record.fixable, `${path}.fixable`), (fixable) =>
                    andThen(stringArrayOptional(record.extraArgs, `${path}.extraArgs`), (extraArgs) =>
                      Ok({
                        targets,
                        ruffBin,
                        select,
                        ignore,
                        configPath,
                        fixable,
                        extraArgs,
                      })
                    )
                  )
                )
              )
            )
          )
        )
    )
  );
}

function toolRunsParse<T>(
  value: unknown,
  path: string,
  runParse: (value: unknown, path: string) => Result<T, WorkspaceFault>
): Result<T[], WorkspaceFault> {
  if (!Array.isArray(value)) {
    return configErr(path, `expected array, received ${valueTypeGet(value)}`);
  }
  return resultAll(value.map((run, index) => runParse(run, `${path}[${index}]`)));
}

function eslintToolParse(
  value: unknown,
  path: string
): Result<NonNullable<PolicyTools['eslint']>, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(keysAllowed(record, ['runs'], path), () =>
      andThen(toolRunsParse(record.runs, `${path}.runs`, eslintRunParse), (runs) => Ok({ runs }))
    )
  );
}

function biomeToolParse(
  value: unknown,
  path: string
): Result<NonNullable<PolicyTools['biome']>, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(keysAllowed(record, ['runs'], path), () =>
      andThen(toolRunsParse(record.runs, `${path}.runs`, biomeRunParse), (runs) => Ok({ runs }))
    )
  );
}

function ruffToolParse(
  value: unknown,
  path: string
): Result<NonNullable<PolicyTools['ruff']>, WorkspaceFault> {
  return andThen(recordExpect(value, path), (record) =>
    andThen(keysAllowed(record, ['runs'], path), () =>
      andThen(toolRunsParse(record.runs, `${path}.runs`, ruffRunParse), (runs) => Ok({ runs }))
    )
  );
}

function toolsParse(value: unknown, path: string): Result<PolicyTools | undefined, WorkspaceFault> {
  if (value === undefined) {
    return Ok(undefined);
  }
  return andThen(recordExpect(value, path), (record) =>
    andThen(keysAllowed(record, ['eslint', 'biome', 'ruff'], path), () =>
      andThen(
        record.eslint === undefined
          ? Ok(undefined)
          : eslintToolParse(record.eslint, `${path}.eslint`),
        (eslint) =>
          andThen(
            record.biome === undefined ? Ok(undefined) : biomeToolParse(record.biome, `${path}.biome`),
            (biome) =>
              andThen(
                record.ruff === undefined ? Ok(undefined) : ruffToolParse(record.ruff, `${path}.ruff`),
                (ruff) => Ok({ eslint, biome, ruff })
              )
          )
      )
    )
  );
}

function pluginsParse(
  value: unknown,
  path: string
): Result<PolicyPluginDeclaration[] | undefined, WorkspaceFault> {
  if (value === undefined) {
    return Ok(undefined);
  }
  if (!Array.isArray(value)) {
    return configErr(path, `expected array, received ${valueTypeGet(value)}`);
  }
  return resultAll(value.map((plugin, index) => pluginDeclarationParse(plugin, `${path}[${index}]`)));
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

const LEGACY_EXTERNAL_TOOL_RULE_MIGRATIONS = new Map<string, string>([
  [
    '@codepol/plugin/eslint',
    'External ESLint bridge rules are no longer supported. Configure ESLint under:\n' +
      '\n' +
      '  [tools.eslint]\n' +
      '  [[tools.eslint.runs]]\n' +
      '  targets = ["<target-name>"]\n' +
      '  configPath = "./eslint.config.mjs"',
  ],
  [
    '@codepol/plugin/biome',
    'External Biome bridge rules are no longer supported. Configure Biome under:\n' +
      '\n' +
      '  [tools.biome]\n' +
      '  [[tools.biome.runs]]\n' +
      '  targets = ["<target-name>"]\n' +
      '  configPath = "./biome.json"',
  ],
  [
    '@codepol/plugin/ruff',
    'External Ruff bridge rules are no longer supported. Configure Ruff under:\n' +
      '\n' +
      '  [tools.ruff]\n' +
      '  [[tools.ruff.runs]]\n' +
      '  targets = ["<target-name>"]\n' +
      '  select = ["E", "F"]',
  ],
]);

function legacyExternalToolRulesValidate(
  rules: PolicyRule[]
): Result<void, WorkspaceFault> {
  for (const [index, rule] of rules.entries()) {
    const message = LEGACY_EXTERNAL_TOOL_RULE_MIGRATIONS.get(rule.ruleId);
    if (message) {
      return configErr(`config.rules[${index}].ruleId`, message);
    }
  }
  return Ok(undefined);
}

export function configValidate(raw: unknown): Result<CodepolConfig, WorkspaceFault> {
  return andThen(recordExpect(raw, 'config'), (record) => {
    if ('eslintConfigPath' in record) {
      return configErr('config.eslintConfigPath', ESLINT_CONFIG_PATH_MIGRATION_MESSAGE);
    }
    return andThen(
      keysAllowed(record, ['targets', 'rules', 'exclude', 'plugins', 'tools'], 'config'),
      () =>
        andThen(targetsParse(record.targets, 'config.targets'), (targets) =>
          andThen(rulesParse(record.rules, 'config.rules'), (rules) =>
            andThen(stringArrayOptional(record.exclude, 'config.exclude'), (exclude) =>
              andThen(pluginsParse(record.plugins, 'config.plugins'), (plugins) =>
                andThen(toolsParse(record.tools, 'config.tools'), (tools) => {
                  const config: CodepolConfig = {
                    targets,
                    rules,
                    exclude,
                    plugins,
                    tools,
                  };
                  return andThen(legacyExternalToolRulesValidate(config.rules), () => Ok(config));
                })
              )
            )
          )
        )
    );
  });
}
