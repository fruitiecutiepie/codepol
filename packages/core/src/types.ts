export type {
  LoggerImportConfig,
  LoggerConfig,
  PolicyRule,
  PolicyFile,
  TreeScanProvider,
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
  PolicyScanContext,
  PolicyViolation,
  RuleMatch,
} from './policy/policyTypes';

import type {
  EslintRuleProvider,
  FixProvider,
  PolicyPluginCapabilities,
  TreeScanProvider,
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
  /** Tree-sitter scan provider capability */
  treeScanProvider?: TreeScanProvider;
  /** Fix provider capability */
  fixProvider?: FixProvider;
};
