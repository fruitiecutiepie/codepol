import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Language } from 'web-tree-sitter';
import {
  parserRuntimeStateGet,
  type ParserRuntimeState,
  type RegisteredLang,
} from './parserRuntimeState';

export type Lang = {
  langId: string;
  /** Path to WASM file. If omitted, uses bundled wasm/tree-sitter-{langId}.wasm */
  wasmPath?: string;
  fileExtensions: string[];
};

/**
 * Canonical path for registry compare/store. Multiple bundled copies of
 * `@codepol/core` in one process share parser runtime state on `globalThis`,
 * but each copy resolves default grammar paths from its own `__dirname`;
 * `realpathSync` collapses those to one key when they refer to the same file.
 */
function wasmPathRegistryCanonical(wasmPath: string): string {
  const resolved = path.resolve(wasmPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Same grammar file copied into two package paths (e.g. pnpm nested install). */
function wasmGrammarFilesContentEqual(pathA: string, pathB: string): boolean {
  const ra = path.resolve(pathA);
  const rb = path.resolve(pathB);
  try {
    const sa = fs.statSync(ra);
    const sb = fs.statSync(rb);
    if (sa.size !== sb.size) {
      return false;
    }
    const ha = crypto.createHash('sha256').update(fs.readFileSync(ra)).digest('hex');
    const hb = crypto.createHash('sha256').update(fs.readFileSync(rb)).digest('hex');
    return ha === hb;
  } catch {
    return false;
  }
}

/**
 * Resolves the path to a bundled WASM grammar file.
 * Checks multiple locations in order:
 *   1. packages/core/wasm/ (standard npm mode)
 *   2. Next to the current script file (esbuild bundle mode)
 *   3. Next to the executable (standalone binary mode)
 */
export function wasmPathGet(grammarName: string): string {
  const filename = `${grammarName}.wasm`;

  const candidates = [
    path.resolve(__dirname, '..', '..', 'wasm', filename),
    path.resolve(__dirname, filename),
    path.resolve(path.dirname(process.execPath), filename),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

function fileExtensionsSetForLang(langId: string, extensions: string[]): string[] {
  const state = parserRuntimeStateGet();
  const merged = new Set<string>();
  for (const extension of extensions) {
    const trimmed = extension.trim();
    if (!trimmed) {
      continue;
    }
    const normalised = (trimmed.startsWith('.') ? trimmed : `.${trimmed}`).toLowerCase();
    const existing = state.fileExtensionsToLangId.get(normalised);
    if (existing && existing !== langId) {
      throw new Error(
        `File extension "${normalised}" is already registered for language "${existing}".`
      );
    }
    state.fileExtensionsToLangId.set(normalised, langId);
    merged.add(normalised);
  }
  return [...merged];
}

export function langAdd(lang: Lang): void {
  const state = parserRuntimeStateGet();
  const langId = lang.langId.trim();
  if (!langId) {
    throw new Error('Language lang must include a non-empty langId.');
  }
  if (!lang.fileExtensions || lang.fileExtensions.length === 0) {
    throw new Error(`Language "${langId}" must include at least one file extension.`);
  }

  let wasmPath = wasmPathGet(`tree-sitter-${langId}`);
  if (lang.wasmPath != null) {
    wasmPath = lang.wasmPath;
  }
  const wasmPathCanonical = wasmPathRegistryCanonical(wasmPath);

  const existing = state.registeredLangs.get(langId);
  if (existing) {
    const pathsEquivalent =
      wasmPathRegistryCanonical(existing.wasmPath) === wasmPathCanonical ||
      wasmGrammarFilesContentEqual(existing.wasmPath, wasmPath);
    if (!pathsEquivalent) {
      throw new Error(
        `Language "${langId}" is already registered with a different wasmPath.`
      );
    }
    const mergedExtensions = new Set(existing.fileExtensions);
    const addedExtensions = fileExtensionsSetForLang(langId, lang.fileExtensions);
    for (const extension of addedExtensions) {
      mergedExtensions.add(extension);
    }
    state.registeredLangs.set(langId, {
      ...existing,
      wasmPath: wasmPathCanonical,
      fileExtensions: [...mergedExtensions],
    });
    return;
  }

  const normalisedExtensions = fileExtensionsSetForLang(langId, lang.fileExtensions);
  if (normalisedExtensions.length === 0) {
    throw new Error(`Language "${langId}" must include valid file extensions.`);
  }
  const registeredLang: RegisteredLang = {
    langId,
    wasmPath: wasmPathCanonical,
    fileExtensions: normalisedExtensions,
  };
  state.registeredLangs.set(langId, registeredLang);
}

export function langsGet(): Required<Lang>[] {
  return [...parserRuntimeStateGet().registeredLangs.values()];
}

export function langSet(langId: string, language: Language): void;
export function langSet(
  state: ParserRuntimeState,
  langId: string,
  language: Language,
): void;
export function langSet(
  stateOrLangId: ParserRuntimeState | string,
  langIdOrLanguage: string | Language,
  language?: Language,
): void {
  const state = typeof stateOrLangId === 'string'
    ? parserRuntimeStateGet()
    : stateOrLangId;
  const langId = typeof stateOrLangId === 'string'
    ? stateOrLangId
    : langIdOrLanguage as string;
  const loadedLanguage = typeof stateOrLangId === 'string'
    ? langIdOrLanguage as Language
    : language;
  if (!loadedLanguage) {
    throw new Error('langSet requires a Language instance.');
  }
  state.loadedLanguages.set(langId, loadedLanguage);
}

export function langExists(langId: string): boolean;
export function langExists(state: ParserRuntimeState, langId: string): boolean;
export function langExists(
  stateOrLangId: ParserRuntimeState | string,
  langId?: string,
): boolean {
  const state = typeof stateOrLangId === 'string'
    ? parserRuntimeStateGet()
    : stateOrLangId;
  const resolvedLangId = typeof stateOrLangId === 'string'
    ? stateOrLangId
    : langId;
  if (!resolvedLangId) {
    return false;
  }
  return state.loadedLanguages.has(resolvedLangId);
}

export function langGetForFile(filePath: string): Language | null;
export function langGetForFile(
  state: ParserRuntimeState,
  filePath: string,
): Language | null;
export function langGetForFile(
  stateOrFilePath: ParserRuntimeState | string,
  filePath?: string,
): Language | null {
  const state = typeof stateOrFilePath === 'string'
    ? parserRuntimeStateGet()
    : stateOrFilePath;
  const resolvedFilePath = typeof stateOrFilePath === 'string'
    ? stateOrFilePath
    : filePath;
  if (!resolvedFilePath) {
    return null;
  }
  const extension = path.extname(resolvedFilePath).toLowerCase();
  if (!extension) {
    return null;
  }
  const langId = state.fileExtensionsToLangId.get(extension);
  if (!langId) {
    return null;
  }
  let result: Language | null = null;
  if (state.loadedLanguages.get(langId) != null) {
    result = state.loadedLanguages.get(langId)!;
  }
  return result;
}

/**
 * Returns the registered language ID for a file path based on its extension.
 * Uses the `langAdd` registry (the `fileExtensionsMap`).
 * Returns `null` if the extension is not registered.
 */
export function langIdGetForFile(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (!extension) {
    return null;
  }
  return parserRuntimeStateGet().fileExtensionsToLangId.get(extension) ?? null;
}
