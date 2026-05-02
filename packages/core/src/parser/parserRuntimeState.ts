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
   * Scoped to a single `web-tree-sitter` module owner so parsers from one
   * WASM module instance are never reused with another.
   */
  parsersByLanguage: Map<Language, Parser>;
};

const parserRuntimeStateKey = Symbol.for('codepol.parser-runtime-state');

type SharedParserRuntimeState = {
  registeredLangs: Map<string, RegisteredLang>;
  fileExtensionsToLangId: Map<string, string>;
  ownerStates: Map<unknown, ParserRuntimeState>;
  defaultOwnerState: ParserRuntimeState;
};

type GlobalParserRuntimeState = typeof globalThis & {
  [parserRuntimeStateKey]?: SharedParserRuntimeState;
};

function parserOwnerStateCreate(
  parserOwner: unknown,
  registeredLangs: Map<string, RegisteredLang>,
  fileExtensionsToLangId: Map<string, string>,
): ParserRuntimeState {
  return {
    parserOwner,
    parserInitialized: false,
    parserInitPromise: undefined,
    registeredLangs,
    fileExtensionsToLangId,
    loadedLanguages: new Map(),
    parsersByLanguage: new Map(),
  };
}

function sharedParserRuntimeStateGet(): SharedParserRuntimeState {
  const globalRuntime = globalThis as GlobalParserRuntimeState;
  let shared = globalRuntime[parserRuntimeStateKey];
  if (!shared) {
    const registeredLangs = new Map<string, RegisteredLang>();
    const fileExtensionsToLangId = new Map<string, string>();
    shared = {
      registeredLangs,
      fileExtensionsToLangId,
      ownerStates: new Map(),
      defaultOwnerState: parserOwnerStateCreate(
        undefined,
        registeredLangs,
        fileExtensionsToLangId,
      ),
    };
    globalRuntime[parserRuntimeStateKey] = shared;
  }
  return shared;
}

export function parserRuntimeStateGet(): ParserRuntimeState {
  return sharedParserRuntimeStateGet().defaultOwnerState;
}

/**
 * Keeps language registrations global while isolating live parser state per
 * web-tree-sitter module instance. Editor hosts can load multiple package
 * copies in one process; one owner must not mark another owner uninitialized.
 */
export function parserRuntimeStateForOwnerGet(
  parserOwner: unknown,
): ParserRuntimeState {
  const shared = sharedParserRuntimeStateGet();
  let state = shared.ownerStates.get(parserOwner);
  if (!state) {
    state = parserOwnerStateCreate(
      parserOwner,
      shared.registeredLangs,
      shared.fileExtensionsToLangId,
    );
    shared.ownerStates.set(parserOwner, state);
  }
  return state;
}
