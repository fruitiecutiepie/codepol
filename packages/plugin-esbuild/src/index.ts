/**
 * @packageDocumentation
 * @codepol/plugin-esbuild - esbuild plugin for enforcing codepol policies.
 */

import path from 'path';
import type { Plugin } from 'esbuild';
import {
  configGet,
  configGetFromPath,
  isErr,
  policyViolationsGetOutputPretty,
  WorkspaceFault,
} from '@codepol/core';
import { policyCheck } from '@codepol/workspace-service';

export type PolicyPluginOptions = {
  configPath?: string;
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
        if (isErr(configResult)) {
          throw new WorkspaceFault(configResult.Err.message);
        }
        const { config, configPath } = configResult.Ok;

        const result = await policyCheck({
          config,
          configPath,
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
          throw new WorkspaceFault(output.join('\n\n') || 'Policy enforcement failed');
        }

        if (options.fix && output.length > 0) {
          console.log(output.join('\n\n'));
        }
      });
    },
  };
}

export default esbuildPluginCreate;
