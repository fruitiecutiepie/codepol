import path from 'path';
import type { Plugin } from 'esbuild';
import { formatTreeViolations, runPolicyChecks } from './policy-runner';

export interface PolicyPluginOptions {
  policyPath?: string;
  eslintConfigPath?: string;
  fix?: boolean;
  cwd?: string;
}

function resolvePath(value: string | undefined, cwd: string, fallback: string): string {
  if (value === undefined) {
    return path.resolve(cwd, fallback);
  }
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

export function policyPlugin(options: PolicyPluginOptions = {}): Plugin {
  return {
    name: 'policy-plugin',
    setup(build) {
      build.onStart(async () => {
        const cwd = options.cwd
          ? path.resolve(options.cwd)
          : build.initialOptions.absWorkingDir
            ? path.resolve(build.initialOptions.absWorkingDir)
            : process.cwd();

        const policyPath = resolvePath(options.policyPath, cwd, 'policy.json');
        const eslintConfigPath = resolvePath(options.eslintConfigPath, cwd, '.eslintrc.cjs');

        const result = await runPolicyChecks({
          policyPath,
          eslintConfigPath,
          fix: options.fix,
          cwd,
        });

        const outputs: string[] = [];
        if (result.eslintOutput.length > 0) {
          outputs.push(result.eslintOutput);
        }
        const treeOutput = formatTreeViolations(result.treeViolations, cwd);
        if (treeOutput) {
          outputs.push('Tree-sitter policy violations:');
          outputs.push(treeOutput);
        }

        if (result.eslintHasErrors || result.treeViolations.length > 0) {
          const message = outputs.join('\n\n') || 'Policy enforcement failed';
          throw new Error(message);
        }

        if (options.fix && outputs.length > 0) {
          console.log(outputs.join('\n\n'));
        }
      });
    },
  };
}

export default policyPlugin;
