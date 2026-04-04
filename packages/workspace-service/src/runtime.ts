import {
  langAdd,
  parserInit,
  pluginModuleRegister,
} from '@codepol/core';
import codepolPlugin from '@codepol/plugin';
import vulturePlugin from '@codepol/plugin-vulture';

let runtimeInitPromise: Promise<void> | undefined;
let builtinPluginsRegistered = false;

function builtinPluginsRegister(): void {
  if (builtinPluginsRegistered) {
    return;
  }

  pluginModuleRegister('@codepol/plugin', { default: codepolPlugin });
  pluginModuleRegister('@codepol/plugin-vulture', { default: vulturePlugin });
  builtinPluginsRegistered = true;
}

export function ensureWorkspaceRuntimeReady(): Promise<void> {
  if (!runtimeInitPromise) {
    builtinPluginsRegister();
    langAdd({ langId: 'typescript', fileExtensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx', '.jsx'] });
    langAdd({ langId: 'python', fileExtensions: ['.py', '.pyw'] });
    runtimeInitPromise = parserInit();
  }

  return runtimeInitPromise;
}
