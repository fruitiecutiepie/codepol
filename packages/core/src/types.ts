export type {
  LoggerImportConfig,
  LoggerConfig,
  PolicyRule,
  PolicyRuleSemantics,
  PolicyRuleTarget,
  PolicyRuleTargetContext,
  PolicyFile,
  TreeCheckProvider,
  LintProviderContext,
  LintProvider,
  EslintProviderConfig,
  FixProviderContext,
  FixProvider,
  PolicyPluginCapabilities,
  CodepolPlugin,
  PolicyPlugin,
  PolicyPluginDeclaration,
  PolicyPluginRuleDeclaration,
  PolicyPluginInitContext,
  PolicyCheckContext,
  PolicyViolation,
  RuleMatch,
  // Adapter types
  LintDiagnostic,
  TreeCheckAdapterOptions,
  TreeCheckLintAdapter,
} from './policy/policyTypes';

import type { PolicyPluginCapabilities } from './policy/policyTypes';

/**
 * Stable per-rule plugin interface for Codepol capabilities.
 */
export type CodepolRulePlugin = {
  /** Rule identifier */
  id: string;
  /** Capability bundle for this rule */
  capabilities: PolicyPluginCapabilities;
};
