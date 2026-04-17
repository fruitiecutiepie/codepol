import type { Language } from 'web-tree-sitter';

export type RegisteredLang = {
  langId: string;
  wasmPath: string;
  fileExtensions: string[];
};

export type ParserRuntimeState = {
  parserOwner?: unknown;
  parserInitialized: boolean;
  parserInitPromise?: Promise<void>;
  registeredLangs: Map<string, RegisteredLang>;
  fileExtensionsToLangId: Map<string, string>;
  loadedLanguages: Map<string, Language>;
};

const parserRuntimeStateKey = Symbol.for('codepol.parser-runtime-state');

type GlobalParserRuntimeState = typeof globalThis & {
  [parserRuntimeStateKey]?: ParserRuntimeState;
};

export function parserRuntimeStateGet(): ParserRuntimeState {
  const globalRuntime = globalThis as GlobalParserRuntimeState;
  if (!globalRuntime[parserRuntimeStateKey]) {
    globalRuntime[parserRuntimeStateKey] = {
      parserOwner: undefined,
      parserInitialized: false,
      parserInitPromise: undefined,
      registeredLangs: new Map(),
      fileExtensionsToLangId: new Map(),
      loadedLanguages: new Map(),
    };
  }
  return globalRuntime[parserRuntimeStateKey]!;
}

/**
 * Keeps language registrations global while invalidating live parser state
 * whenever a different web-tree-sitter module instance is observed.
 */
export function parserRuntimeStateForOwnerGet(
  parserOwner: unknown,
): ParserRuntimeState {
  const state = parserRuntimeStateGet();
  if (state.parserOwner !== parserOwner) {
    state.parserOwner = parserOwner;
    state.parserInitialized = false;
    state.parserInitPromise = undefined;
    state.loadedLanguages.clear();
  }
  return state;
}
