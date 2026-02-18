import type {
  CodepolPluginRule,
  FixProvider,
  FixProviderContext,
  PolicyViolation,
} from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { readFileSync } from 'node:fs';
import {
  noDuplicateExportsCheck,
  type NoDuplicateExportsArgs,
  type FileSource,
} from './noDuplicateExportsCheck';

// Rule ID must NOT contain '/' - codepol uses '/' for namespacing.
// Your ID will be auto-prefixed: "no-duplicate-exports" → "@scope/plugin/no-duplicate-exports"
const ruleId = 'no-duplicate-exports';

/**
 * Storage for the last check result, accessible for programmatic use.
 */
let lastCheckResult: PolicyViolation[] = [];

/**
 * Get the violations from the last check run.
 */
function lastViolationsGet(): PolicyViolation[] {
  return lastCheckResult;
}

/**
 * Clear the last check result.
 */
function lastViolationsClear(): void {
  lastCheckResult = [];
}

/**
 * FixProvider that performs cross-file duplicate export detection.
 * Note: We use FixProvider because it has access to all matched files,
 * enabling cross-file analysis that TreeCheckProvider cannot do.
 */
const noDuplicateExportsFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    const args = context.ruleTargets?.[0]?.args as NoDuplicateExportsArgs | undefined;

    // Read all files
    const files: FileSource[] = [];
    for (const filePath of context.files) {
      try {
        const source = readFileSync(filePath, 'utf8');
        files.push({ filePath, source });
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    // Run the duplicate check
    const violations = noDuplicateExportsCheck(files, args);

    // Store for programmatic access
    lastCheckResult = violations;

    // Report violations to stdout
    if (violations.length > 0) {
      for (const violation of violations) {
        console.error(
          `${violation.filePath}:${violation.line}:${violation.column}: error [${violation.ruleId}] ${violation.message}`
        );
      }
    }
  },
};

// Export the complete rule plugin
export const noDuplicateExportsRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    fixProvider: noDuplicateExportsFixProvider,
  },
});
