import fs from 'node:fs';
import path from 'node:path';
import Parser from 'web-tree-sitter';
import type { Language } from 'web-tree-sitter';
import { Result, Ok, Err } from '../result/result';
import {
  langGetForFile,
  langsGet,
  langExists,
  langSet,
} from './parserLangs';
import {
  parserRuntimeStateForOwnerGet,
  parserRuntimeStateGet,
} from './parserRuntimeState';
import type { Diagnostics } from '../diagnostics/diagnosticsTypes';
import { diagnosticsRuntimeGet } from '../diagnostics/diagnosticsRuntimeGlobal';

/**
 * Resolves the web-tree-sitter core WASM file.
 * Checks next to the executable first (standalone binary mode),
 * then falls back to the web-tree-sitter package location.
 */
function treeSitterWasmLocate(filename: string, scriptDir: string): string {
  const besideExe = path.resolve(path.dirname(process.execPath), filename);
  if (fs.existsSync(besideExe)) return besideExe;
  return path.join(scriptDir, filename);
}

function parserInitDiagnosticsGet(diag: Diagnostics | undefined): Diagnostics {
  if (diag) return diag;
  return diagnosticsRuntimeGet().getDiagnostics('parser.init');
}

/**
 * Initializes the web-tree-sitter parser and loads language grammars.
 * Must be called before any scanning operations.
 */
export async function parserInit(diag?: Diagnostics): Promise<void> {
  const state = parserRuntimeStateForOwnerGet(Parser);
  const d = parserInitDiagnosticsGet(diag);
  if (!state.parserInitPromise) {
    d.debug('core_wasm.initializing');
    state.parserInitPromise = Parser.init({ locateFile: treeSitterWasmLocate })
      .then(() => {
        if (parserRuntimeStateGet().parserOwner === Parser) {
          state.parserInitialized = true;
        }
        d.debug('core_wasm.initialized');
      })
      .catch((error) => {
        if (parserRuntimeStateGet().parserOwner === Parser) {
          state.parserInitPromise = undefined;
        }
        const message = error instanceof Error ? error.message : String(error);
        d.error('core_wasm.init_failed', { errorMessage: message });
        throw error;
      });
  }
  await state.parserInitPromise;

  const langs = langsGet();
  d.debug('grammars.registered', () => ({
    langs: langs.map((lang) => ({
      langId: lang.langId,
      wasmPath: lang.wasmPath,
      wasmExists: fs.existsSync(lang.wasmPath),
      wasmSize: fs.existsSync(lang.wasmPath)
        ? fs.statSync(lang.wasmPath).size
        : undefined,
      fileExtensions: lang.fileExtensions,
      alreadyLoaded: langExists(lang.langId),
    })),
  }));
  await Promise.all(
    langs.map(async lang => {
      if (langExists(lang.langId)) {
        return;
      }
      try {
        const language = await Parser.Language.load(lang.wasmPath);
        langSet(lang.langId, language);
        d.debug('grammar.loaded', () => ({
          langId: lang.langId,
          wasmPath: lang.wasmPath,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        d.error('grammar.load_failed', {
          langId: lang.langId,
          wasmPath: lang.wasmPath,
          errorMessage: message,
        });
        throw error;
      }
    })
  );
}

/**
 * Returns a pooled Tree-sitter parser for a specific `Language`.
 *
 * Parsers are reused across calls keyed by the `Language` object. This is
 * safe because:
 *   - Node runs parse calls on a single thread, so there is no concurrent
 *     access to the same parser instance.
 *   - The parser's only stateful configuration we set is `setLanguage`,
 *     and calling it with the same language is idempotent.
 *
 * This avoids the WASM-heap growth that occurred when each call to
 * `parserGetForFile` allocated a fresh `new Parser()` that was never
 * `.delete()`d — after ~8k parses the shared WASM module aborts with
 * `RuntimeError: Aborted()` and becomes permanently unusable.
 */
export function parserGetForLanguage(language: Language): Result<Parser, string> {
  const state = parserRuntimeStateForOwnerGet(Parser);
  if (!state.parserInitialized) {
    const error = 'Parser not initialized. Call parserInit() before scanning files.';
    console.error(error);
    return Err(error);
  }
  const cached = state.parsersByLanguage.get(language);
  if (cached) {
    return Ok(cached);
  }
  const parser = new Parser();
  parser.setLanguage(language);
  state.parsersByLanguage.set(language, parser);
  return Ok(parser);
}

/**
 * Creates a Tree-sitter parser configured for the given file type.
 *
 * Returns a pooled instance; callers MUST NOT call `.delete()` on the
 * returned parser — it is shared across the process lifetime.
 *
 * @returns Result containing the parser or an error message
 */
export function parserGetForFile(filePath: string): Result<Parser, string> {
  const state = parserRuntimeStateForOwnerGet(Parser);
  if (!state.parserInitialized) {
    const error = 'Parser not initialized. Call parserInit() before scanning files.';
    console.error(error);
    return Err(error);
  }
  const language = langGetForFile(filePath);
  if (!language) {
    const error = `No language registered for file "${filePath}". Register one with langAdd().`;
    console.error(error);
    return Err(error);
  }
  return parserGetForLanguage(language);
}
