import path from 'node:path';
import { Language } from 'web-tree-sitter';

export type Lang = {
  langId: string;
  /** Path to WASM file. If omitted, uses bundled wasm/tree-sitter-{langId}.wasm */
  wasmPath?: string;
  fileExtensions: string[];
};

const langMap = new Map<string, Required<Lang>>();
const fileExtensionsMap = new Map<string, string>();
const langsMap = new Map<string, Language>();

/**
 * Resolves the path to a bundled WASM grammar file.
 */
export function wasmPathGet(grammarName: string): string {
  return path.resolve(__dirname, '..', '..', 'wasm', `${grammarName}.wasm`);
}

function fileExtensionsSetForLang(langId: string, extensions: string[]): string[] {
  const merged = new Set<string>();
  for (const extension of extensions) {
    const trimmed = extension.trim();
    if (!trimmed) {
      continue;
    }
    const normalised = (trimmed.startsWith('.') ? trimmed : `.${trimmed}`).toLowerCase();
    const existing = fileExtensionsMap.get(normalised);
    if (existing && existing !== langId) {
      throw new Error(
        `File extension "${normalised}" is already registered for language "${existing}".`
      );
    }
    fileExtensionsMap.set(normalised, langId);
    merged.add(normalised);
  }
  return [...merged];
}

export function langAdd(lang: Lang): void {
  const langId = lang.langId.trim();
  if (!langId) {
    throw new Error('Language lang must include a non-empty langId.');
  }
  if (!lang.fileExtensions || lang.fileExtensions.length === 0) {
    throw new Error(`Language "${langId}" must include at least one file extension.`);
  }

  const wasmPath = lang.wasmPath ?? wasmPathGet(`tree-sitter-${langId}`);

  const existing = langMap.get(langId);
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
    langMap.set(langId, {
      ...existing,
      fileExtensions: [...mergedExtensions],
    });
    return;
  }

  const normalisedExtensions = fileExtensionsSetForLang(langId, lang.fileExtensions);
  if (normalisedExtensions.length === 0) {
    throw new Error(`Language "${langId}" must include valid file extensions.`);
  }
  langMap.set(langId, {
    langId,
    wasmPath,
    fileExtensions: normalisedExtensions,
  });
}

export function langsGet(): Required<Lang>[] {
  return [...langMap.values()];
}

export function langSet(langId: string, language: Language): void {
  langsMap.set(langId, language);
}

export function langExists(langId: string): boolean {
  return langsMap.has(langId);
}

export function langGetForFile(filePath: string): Language | null {
  const extension = path.extname(filePath).toLowerCase();
  if (!extension) {
    return null;
  }
  const langId = fileExtensionsMap.get(extension);
  if (!langId) {
    return null;
  }
  return langsMap.get(langId) ?? null;
}
