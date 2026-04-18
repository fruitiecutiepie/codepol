import fs from 'node:fs';
import path from 'node:path';
import Parser from 'web-tree-sitter';
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
import { parseDebugLogWrite } from './parserParseDebug';

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

function parserInitDebugEnabled(): boolean {
  const raw = process.env.CODEPOL_DEBUG_PARSE;
  if (!raw) {
    return false;
  }
  const trimmed = raw.trim().toLowerCase();
  return trimmed !== '' && trimmed !== '0' && trimmed !== 'false';
}

/**
 * Initializes the web-tree-sitter parser and loads language grammars.
 * Must be called before any scanning operations.
 */
export async function parserInit(): Promise<void> {
  const state = parserRuntimeStateForOwnerGet(Parser);
  const debug = parserInitDebugEnabled();
  if (!state.parserInitPromise) {
    if (debug) {
      parseDebugLogWrite(
        '[codepol-parse-debug] parserInit: initializing web-tree-sitter core WASM',
      );
    }
    state.parserInitPromise = Parser.init({ locateFile: treeSitterWasmLocate })
      .then(() => {
        if (parserRuntimeStateGet().parserOwner === Parser) {
          state.parserInitialized = true;
        }
        if (debug) {
          parseDebugLogWrite(
            '[codepol-parse-debug] parserInit: web-tree-sitter core WASM initialized',
          );
        }
      })
      .catch((error) => {
        if (parserRuntimeStateGet().parserOwner === Parser) {
          state.parserInitPromise = undefined;
        }
        if (debug) {
          const message = error instanceof Error ? error.message : String(error);
          parseDebugLogWrite(
            `[codepol-parse-debug] parserInit: core WASM init failed: ${message}`,
          );
        }
        throw error;
      });
  }
  await state.parserInitPromise;

  const langs = langsGet();
  if (debug) {
    parseDebugLogWrite(
      `[codepol-parse-debug] parserInit: registered languages ${JSON.stringify(
        langs.map((lang) => ({
          langId: lang.langId,
          wasmPath: lang.wasmPath,
          wasmExists: fs.existsSync(lang.wasmPath),
          wasmSize: fs.existsSync(lang.wasmPath)
            ? fs.statSync(lang.wasmPath).size
            : undefined,
          fileExtensions: lang.fileExtensions,
          alreadyLoaded: langExists(lang.langId),
        })),
      )}`,
    );
  }
  await Promise.all(
    langs.map(async lang => {
      if (langExists(lang.langId)) {
        return;
      }
      try {
        const language = await Parser.Language.load(lang.wasmPath);
        langSet(lang.langId, language);
        if (debug) {
          parseDebugLogWrite(
            `[codepol-parse-debug] parserInit: loaded grammar "${lang.langId}" from ${lang.wasmPath}`,
          );
        }
      } catch (error) {
        if (debug) {
          const message = error instanceof Error ? error.message : String(error);
          parseDebugLogWrite(
            `[codepol-parse-debug] parserInit: FAILED to load grammar "${lang.langId}" from ${lang.wasmPath}: ${message}`,
          );
        }
        throw error;
      }
    })
  );
}

/**
 * Creates a Tree-sitter parser configured for the given file type.
 * @returns Result containing the parser or an error message
 */
export function parserGetForFile(filePath: string): Result<Parser, string> {
  const state = parserRuntimeStateForOwnerGet(Parser);
  if (!state.parserInitialized) {
    const error = 'Parser not initialized. Call parserInit() before scanning files.';
    console.error(error);
    return Err(error);
  }
  const parser = new Parser();
  const language = langGetForFile(filePath);
  if (!language) {
    const error = `No language registered for file "${filePath}". Register one with langAdd().`;
    console.error(error);
    return Err(error);
  }
  parser.setLanguage(language);
  return Ok(parser);
}
