/**
 * @packageDocumentation
 * @codepol/plugin-esbuild - esbuild plugin for enforcing codepol policies.
 */

import path from 'path';
import type { Plugin } from 'esbuild';
import {
  configGet,
  configGetFromPath,
  policyViolationsGetOutputPretty,
} from '@codepol/core';
import {
  eslintConfigPathDetect,
  policyCheck,
} from '@codepol/workspace-service';

export type PolicyPluginOptions = {
  configPath?: string;
  eslintConfigPath?: string;
  fix?: boolean;
  cwd?: string;
};

export function esbuildPluginCreate(options: PolicyPluginOptions = {}): Plugin {
  return {
    name: 'codepol-policy',
    setup(build) {
      build.onStart(async () => {
        const cwd = options.cwd
          ? path.resolve(options.cwd)
          : build.initialOptions.absWorkingDir
            ? path.resolve(build.initialOptions.absWorkingDir)
            : process.cwd();

        const configResult = options.configPath
          ? await configGetFromPath(
              path.isAbsolute(options.configPath)
                ? options.configPath
                : path.resolve(cwd, options.configPath),
            )
          : await configGet(cwd);
        const { config, configPath } = configResult;

        const eslintConfigPath = options.eslintConfigPath
          ? path.resolve(cwd, options.eslintConfigPath)
          : config.eslintConfigPath
            ? path.resolve(path.dirname(configPath), config.eslintConfigPath)
            : eslintConfigPathDetect(cwd);

        const result = await policyCheck({
          config,
          configPath,
          eslintConfigPath,
          fix: options.fix ?? false,
          cwd,
        });

        const output: string[] = [];
        if (result.eslintOutput.length > 0) {
          output.push(result.eslintOutput);
        }
        const treeOutput = policyViolationsGetOutputPretty(result.treeViolations, cwd);
        if (treeOutput) {
          output.push('Tree-sitter policy violations:');
          output.push(treeOutput);
        }

        if (result.eslintHasErrors || result.treeViolations.length > 0) {
          throw new Error(output.join('\n\n') || 'Policy enforcement failed');
        }

        if (options.fix && output.length > 0) {
          console.log(output.join('\n\n'));
        }
      });
    },
  };
}

export default esbuildPluginCreate;
