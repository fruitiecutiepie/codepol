import type { Language } from 'web-tree-sitter';
import type Parser from 'web-tree-sitter';

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
  /**
   * Pooled `Parser` instances keyed by `Language`. Tree-sitter parsers are
   * cheap to reuse across sequential parses and expensive to re-allocate
   * (each `new Parser()` grabs native WASM memory that must be freed with
   * `delete()`). The shared WASM heap has a fixed cap (~16 MB by default),
   * so recreating parsers per call eventually aborts the module with
   * `RuntimeError: Aborted()`. Pooling keeps the heap bounded.
   *
   * Cleared when `parserOwner` changes so we never hand back a parser
   * that was allocated inside a now-defunct WASM module instance.
   */
  parsersByLanguage: Map<Language, Parser>;
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
      parsersByLanguage: new Map(),
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
    // Parsers from a defunct WASM module instance cannot be safely reused
    // or even `.delete()`d — drop the references and let GC handle the JS
    // wrappers. The native memory dies with the old module.
    state.parsersByLanguage.clear();
  }
  return state;
}
