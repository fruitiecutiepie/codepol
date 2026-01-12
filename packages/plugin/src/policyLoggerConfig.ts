import type { LoggerConfig, PolicyFile } from '@codepol/core';

const loggerPluginModule = '@codepol/plugin';
const loggerRuleId = 'require-logger-enter-exit';

type LoggerRuleArgs = {
  logger: LoggerConfig;
  policyPath?: string;
};

export function policyLoggerConfigGet(policy: PolicyFile): LoggerConfig | null {
  if (!policy.plugins) {
    return null;
  }
  for (const declaration of policy.plugins) {
    if (declaration.module !== loggerPluginModule) {
      continue;
    }
    if (!declaration.rules) {
      continue;
    }
    for (const rule of declaration.rules) {
      if (rule.id !== loggerRuleId || !rule.args || typeof rule.args !== 'object') {
        continue;
      }
      const candidate = rule.args as LoggerRuleArgs;
      if (candidate.logger) {
        return candidate.logger;
      }
    }
  }
  return null;
}
