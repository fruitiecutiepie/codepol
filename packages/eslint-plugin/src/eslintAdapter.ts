/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint adapter for TreeCheckProvider.
 *
 * Converts a TreeCheckProvider into an ESLint rule module, enabling
 * tree-sitter based checks to run within ESLint's infrastructure.
 */

import path from 'path';
import fg from 'fast-glob';
import { ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type {
  TreeCheckLintAdapter,
  TreeCheckAdapterOptions,
  PolicyFile,
  PolicyRule,
  PolicyCheckContext,
  PolicyRuleTargetContext,
  LintDiagnostic,
  CodepolPluginRule,
  ProjectIndex,
  IndexCapabilities,
} from '@codepol/core';
import {
  violationToLintDiagnostic,
  policyCacheClear,
  policyRuleTargetsResolve,
  globPatternsGetMatchAny,
  ruleTargetMatchesLanguage,
  configGetSync,
  configGetFromPathSync,
  projectIndexBuildSync,
  projectIndexUpdateFileFromSource,
  crossFileResolveForFile,
  projectIndexCreate,
  IndexStore,
  indexStoreNew,
  DEFAULT_EXTENSIONS,
  isErr,
  workspacePackageMapDiscover,
} from '@codepol/core';

// Re-export cache clear
export { policyCacheClear };

/**
 * ESLint rule options for tree-check adapted rules.
 */
type AdaptedRuleOptions = [
  {
    /** Path to the config file (auto-discovered if not specified) */
    configPath?: string;
    /** Resolved rule targets passed from the CLI */
    ruleTargets?: PolicyRuleTargetContext[];
    /** Global exclude patterns from the policy */
    policyExclude?: string[];
    /** Rule-specific arguments */
    [key: string]: unknown;
  }?
];

type MessageIds = 'treeCheckViolation';

function policyRuleTargetsGet(policy: PolicyFile): PolicyRuleTargetContext[] {
  const targets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    const resolvedTargets = policyRuleTargetsResolve(rule, policy);
    for (const target of resolvedTargets) {
      targets.push({
        ruleId: rule.ruleId,  // Use plugin rule ID for matching, not user-defined rule.id
        description: rule.description,
        args: rule.args,
        target,
      });
    }
  }
  return targets;
}

/**
 * Checks if a rule ID matches a target's rule ID.
 * Supports both exact matches and suffix matches for namespaced IDs.
 * E.g., plugin "forbidden-words" matches target "@scope/plugin/forbidden-words"
 */
function ruleIdMatches(pluginRuleId: string, targetRuleId: string): boolean {
  if (pluginRuleId === targetRuleId) {
    return true;
  }
  // Support suffix matching: target "@scope/plugin/rule-id" matches plugin "rule-id"
  if (targetRuleId.endsWith(`/${pluginRuleId}`)) {
    return true;
  }
  return false;
}

function fileMatchesPolicy(
  ruleTargets: PolicyRuleTargetContext[],
  policyExclude: string[],
  filePath: string,
  pluginRuleId: string
): PolicyRuleTargetContext | null {
  const relative = path.relative(process.cwd(), filePath);
  if (globPatternsGetMatchAny(policyExclude, relative)) {
    return null;
  }
  for (const ruleTarget of ruleTargets) {
    // Only match targets for THIS plugin's rule
    if (!ruleIdMatches(pluginRuleId, ruleTarget.ruleId)) {
      continue;
    }

    const target = ruleTarget.target;
    if (globPatternsGetMatchAny(target.files, relative)) {
      if (globPatternsGetMatchAny(target.exclude, relative)) {
        continue;
      }
      if (!ruleTargetMatchesLanguage(target, relative)) {
        continue;
      }
      return ruleTarget;
    }
  }
  return null;
}

/**
 * Converts a LintDiagnostic to ESLint's loc format.
 * ESLint uses 1-based lines but 0-based columns.
 */
function diagnosticToEslintLoc(diagnostic: LintDiagnostic): TSESLint.ReportDescriptor<MessageIds>['loc'] {
  return {
    start: {
      line: diagnostic.line,
      column: diagnostic.column - 1, // ESLint uses 0-based columns
    },
    end: {
      line: diagnostic.endLine ?? diagnostic.line,
      column: (diagnostic.endColumn ?? diagnostic.column) - 1,
    },
  };
}

// ============================================================================
// Project Index Caching for Cross-File Analysis
// ============================================================================

/**
 * Cache entry for project index.
 * Stores the IndexStore for incremental updates, plus cached ProjectIndex.
 */
type IndexCacheEntry = {
  /** The underlying IndexStore (mutable, supports incremental updates) */
  store: IndexStore;
  /** Cached ProjectIndex (read-only view of the store) */
  index: ProjectIndex;
  /** Working directory for module resolution */
  dir: string;
  /** Index capabilities */
  capabilities: IndexCapabilities;
};

/**
 * Singleton cache for project index.
 * Keyed by config path to handle multiple projects.
 */
const projectIndexCache = new Map<string, IndexCacheEntry>();

/**
 * Languages that have index adapters and can be indexed.
 */
const INDEXABLE_LANGUAGES = ['typescript', 'tsx', 'javascript', 'jsx', 'python'];

/**
 * File extensions that can be indexed.
 */
const INDEXABLE_EXTENSIONS = [
  // Typescript
  '.ts', '.tsx', '.mts', '.cts',
  // JavaScript
  '.js', '.jsx', '.mjs', '.cjs',
  // Python
  '.py', '.pyw',
];

/**
 * Discovers all indexable files from policy targets (synchronous).
 * Uses fast-glob sync for file discovery.
 *
 * Only applies the global policy exclude (dist, node_modules, etc.).
 * Target-level excludes (e.g. test/spec patterns) are intentionally NOT
 * applied here because the project index must see ALL potential consumers
 * for accurate cross-file analysis.  Target excludes control which files
 * get *checked*, not which files get *indexed*.
 */
function discoverIndexableFiles(policy: PolicyFile, cwd: string): string[] {
  const filesSet = new Set<string>();
  const globalExclude = policy.exclude ?? [];

  for (const rule of policy.rules) {
    const targets = policyRuleTargetsResolve(rule, policy);
    for (const target of targets) {
      // Only index if target language is indexable
      if (target.language && !INDEXABLE_LANGUAGES.includes(target.language)) {
        continue;
      }

      const files = fg.sync(target.files, {
        cwd,
        absolute: true,
        ignore: globalExclude,
        onlyFiles: true,
      });

      // Filter by indexable extensions
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (INDEXABLE_EXTENSIONS.includes(ext)) {
          filesSet.add(file);
        }
      }
    }
  }

  return Array.from(filesSet);
}

/**
 * Gets or builds the project index for cross-file analysis.
 * The index is cached per config path and reused across rule invocations.
 *
 * When a cached index exists, this function checks if the current file
 * being linted has changed (based on content hash) and performs an
 * incremental update if needed.
 *
 * @param configPath - Path to the config file (used as cache key)
 * @param policy - The policy file
 * @param cwd - Current working directory
 * @param currentFile - The file currently being linted (for incremental update)
 * @param source - The source content from ESLint (avoids reading stale content from disk)
 */
function getOrBuildProjectIndex(
  configPath: string,
  policy: PolicyFile,
  cwd: string,
  currentFile: string,
  source: string
): ProjectIndex {
  // Check cache first
  const cached = projectIndexCache.get(configPath);
  if (cached) {
    // Check if current file needs re-indexing using ESLint's source
    // This avoids the "one step behind" issue where disk content lags editor content
    const updated = projectIndexUpdateFileFromSource(cached.store, currentFile, source);
    if (updated) {
      // Re-resolve cross-file imports/exports for the updated file
      crossFileResolveForFile(cached.store, currentFile, {
        baseDir: cached.dir,
        extensions: DEFAULT_EXTENSIONS,
      });
      // Recreate index (cheap - just wraps the store)
      cached.index = projectIndexCreate(cached.store, cached.capabilities);
    }
    return cached.index;
  }

  // Discover all indexable files
  const files = discoverIndexableFiles(policy, cwd);

  // Build index synchronously using a new store
  const store = indexStoreNew();
  const workspacePackages = workspacePackageMapDiscover(cwd);
  const { index } = projectIndexBuildSync({ files, dir: cwd, store, workspacePackages });

  // Determine capabilities
  const capabilities: IndexCapabilities = {
    crossFileResolution: true,
    callGraph: 'heuristic',
    controlFlowGraph: true,
    supportedLanguages: ['typescript', 'tsx', 'javascript', 'jsx', 'python'],
  };

  // Cache the store and index for incremental updates
  projectIndexCache.set(configPath, {
    store,
    index,
    dir: cwd,
    capabilities,
  });

  return index;
}

/**
 * Clears the project index cache.
 * Useful for testing or when the project files change.
 */
export function projectIndexCacheClear(): void {
  projectIndexCache.clear();
}

/**
 * Creates an ESLint rule from a TreeCheckProvider.
 */
function createAdaptedRule(
  plugin: CodepolPluginRule,
  options?: TreeCheckAdapterOptions
): TSESLint.RuleModule<MessageIds, AdaptedRuleOptions> {
  const ruleName = options?.ruleName ?? `tree-check-${plugin.id}`;
  const ruleUrl = options?.ruleUrl ?? '';
  const defaultSeverity = options?.severity ?? 'error';

  const createRule = ESLintUtils.RuleCreator(() => ruleUrl);

  const treeCheckProvider = plugin.capabilities.treeCheckProvider;

  return createRule<AdaptedRuleOptions, MessageIds>({
    name: ruleName,
    meta: {
      type: 'problem',
      fixable: 'code',
      docs: {
        description: `Tree-check rule adapted from ${plugin.id}`,
      },
      messages: {
        treeCheckViolation: '{{message}}',
      },
      schema: [
        {
          type: 'object',
          properties: {
            configPath: {
              type: 'string',
              description: 'Path to the config file (auto-discovered if not specified)',
            },
            ruleTargets: {
              type: 'array',
              items: { type: 'object' },
            },
            policyExclude: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          additionalProperties: true, // Allow ruleArgs to be passed
        },
      ],
    },
    defaultOptions: [{}],
    create(context) {
      const filename = context.filename;
      if (filename === '<input>' || !filename) {
        return {};
      }

      if (!treeCheckProvider) {
        return {};
      }

      // Resolve options
      const ruleOptions = context.options[0] ?? {};
      
      // Config loading: explicit path > auto-discover
      // Uses sync loading since ESLint's create() must be synchronous
      let policy: PolicyFile;
      let configPath: string;
      try {
        if (ruleOptions.configPath) {
          const result = configGetFromPathSync(ruleOptions.configPath);
          policy = result.config;
          configPath = result.configPath;
        } else {
          const result = configGetSync(process.cwd());
          policy = result.config;
          configPath = result.configPath;
        }
      } catch {
        // Config file not found or invalid, skip checking
        return {};
      }

      const policyExclude = ruleOptions.policyExclude ?? policy.exclude ?? [];
      const ruleTargets = ruleOptions.ruleTargets ?? policyRuleTargetsGet(policy);

      // Check if file matches any rule target FOR THIS PLUGIN
      const matchedTarget = fileMatchesPolicy(ruleTargets, policyExclude, filename, plugin.id);
      if (!matchedTarget) {
        return {};
      }

      // Get args from matched target (policy rule args)
      // Fall back to extra options for backward compatibility
      const { configPath: _configPath, ruleTargets: _ruleTargets, policyExclude: _policyExclude, ...extraArgs } = ruleOptions;
      const ruleArgs = matchedTarget.args ?? extraArgs;

      // Check if this plugin requires project index (used in Program:exit)
      const cwd = process.cwd();
      const needsProjectIndex = plugin.capabilities.requiresProjectIndex;

      return {
        'Program:exit'(node) {
          const sourceCode = context.sourceCode;
          const source = sourceCode.getText();

          // Get project index if this plugin requires cross-file analysis
          // This is done here (not in create()) so we have access to the source content,
          // which avoids the "one step behind" issue where disk content lags editor content
          let projectIndex: ProjectIndex | undefined;
          if (needsProjectIndex) {
            projectIndex = getOrBuildProjectIndex(configPath, policy, cwd, filename, source);
          }

          // Build PolicyCheckContext
          const checkContext: PolicyCheckContext = {
            filePath: filename,
            source,
            policy,
            dir: cwd,
            target: matchedTarget.target,
            ruleArgs: ruleArgs,
            projectIndex,
          };

          // Build a synthetic PolicyRule for the provider
          // Note: targets is a string[] of target names; the actual target is in checkContext
          const syntheticRule: PolicyRule = {
            id: matchedTarget.ruleId,
            ruleId: plugin.id,
            description: matchedTarget.description,
            args: matchedTarget.args,
            targets: ['_synthetic'],
          };

          // Run the tree-check
          const checkResult = treeCheckProvider.check(syntheticRule, checkContext);
          
          if (isErr(checkResult)) {
            // Report internal check error as a warning/error
            context.report({
              node,
              messageId: 'treeCheckViolation',
              data: {
                message: `Tree-check error: ${checkResult.Err}`,
              },
            });
            return;
          }

          const violations = checkResult.Ok;

          // Report each violation
          for (const violation of violations) {
            const diagnostic = violationToLintDiagnostic(violation, defaultSeverity);
            context.report({
              node,
              loc: diagnosticToEslintLoc(diagnostic),
              messageId: 'treeCheckViolation',
              data: {
                message: diagnostic.message,
              },
              fix: diagnostic.fix
                ? (fixer) => fixer.replaceTextRange(
                    [diagnostic.fix!.byteRange.start, diagnostic.fix!.byteRange.end],
                    diagnostic.fix!.text,
                  )
                : undefined,
            });
          }
        },
      };
    },
  });
}

/**
 * ESLint adapter for TreeCheckProvider.
 *
 * Converts a TreeCheckProvider into an ESLint rule module.
 */
export const eslintAdapter: TreeCheckLintAdapter<TSESLint.RuleModule<string, unknown[]>> = {
  platform: 'eslint',
  adapt: (plugin, options) => createAdaptedRule(plugin, options) as TSESLint.RuleModule<string, unknown[]>,
};

