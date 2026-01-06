export type {
  LoggerImportConfig,
  LoggerConfig,
  PolicyRule,
  PolicyRuleSemantics,
  PolicyRuleTarget,
  PolicyRuleTargetContext,
  PolicyFile,
  TreeCheckProvider,
  EslintRuleProviderContext,
  EslintRuleProvider,
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
} from './policy/policyTypes';

import type {
  EslintRuleProvider,
  FixProvider,
  PolicyPluginCapabilities,
  TreeCheckProvider,
} from './policy/policyTypes';

/**
 * Stable per-rule plugin interface for Codepol capabilities.
 */
export type CodepolRulePlugin = {
  /** Rule identifier */
  id: string;
  /** Supported languages */
  languages: string[];
  /** Capability bundle for this rule */
  capabilities?: PolicyPluginCapabilities;
  /** ESLint rule provider capability */
  eslintRuleProvider?: EslintRuleProvider;
  /** Tree-sitter check provider capability */
  treeCheckProvider?: TreeCheckProvider;
  /** Fix provider capability */
  fixProvider?: FixProvider;
};
