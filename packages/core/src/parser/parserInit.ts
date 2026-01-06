import Parser from 'web-tree-sitter';
import { Result, Ok, Err } from '../result/result';
import {
  langGetForFile,
  langsGet,
  langExists,
  langSet,
} from './parserLangs';

let parserInitialized = false;

/**
 * Initializes the web-tree-sitter parser and loads language grammars.
 * Must be called before any scanning operations.
 */
export async function parserInit(): Promise<void> {
  if (!parserInitialized) {
    await Parser.init();
    parserInitialized = true;
  }

  const langs = langsGet();
  await Promise.all(
    langs.map(async lang => {
      if (langExists(lang.langId)) {
        return;
      }
      const language = await Parser.Language.load(lang.wasmPath);
      langSet(lang.langId, language);
    })
  );
}

/**
 * Creates a Tree-sitter parser configured for the given file type.
 * @returns Result containing the parser or an error message
 */
export function parserGetForFile(filePath: string): Result<Parser, string> {
  if (!parserInitialized) {
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
