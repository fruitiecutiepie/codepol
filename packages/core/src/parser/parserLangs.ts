import fs from 'node:fs';
import path from 'node:path';
import { Language } from 'web-tree-sitter';
import {
  parserRuntimeStateGet,
  type RegisteredLang,
} from './parserRuntimeState';

export type Lang = {
  langId: string;
  /** Path to WASM file. If omitted, uses bundled wasm/tree-sitter-{langId}.wasm */
  wasmPath?: string;
  fileExtensions: string[];
};

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

  const existing = state.registeredLangs.get(langId);
  if (existing) {
    if (existing.wasmPath !== wasmPath) {
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
    wasmPath,
    fileExtensions: normalisedExtensions,
  };
  state.registeredLangs.set(langId, registeredLang);
}

export function langsGet(): Required<Lang>[] {
  return [...parserRuntimeStateGet().registeredLangs.values()];
}

export function langSet(langId: string, language: Language): void {
  parserRuntimeStateGet().loadedLanguages.set(langId, language);
}

export function langExists(langId: string): boolean {
  return parserRuntimeStateGet().loadedLanguages.has(langId);
}

export function langGetForFile(filePath: string): Language | null {
  const state = parserRuntimeStateGet();
  const extension = path.extname(filePath).toLowerCase();
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
