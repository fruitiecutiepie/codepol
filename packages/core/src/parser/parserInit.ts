import path from 'node:path';
import Parser, { Language } from 'web-tree-sitter';
import { Result, Ok, Err } from '../result/result';

let typescriptLanguage: Language | null = null;
let tsxLanguage: Language | null = null;
let parserInitializedValue = false;

/**
 * Resolves the path to a WASM grammar file.
 * Looks in the wasm directory relative to this package.
 */
function wasmPathGet(grammarNameValue: string): string {
  return path.resolve(__dirname, '..', '..', 'wasm', `${grammarNameValue}.wasm`);
}

/**
 * Initializes the web-tree-sitter parser and loads language grammars.
 * Must be called before any scanning operations.
 */
export async function parserInit(): Promise<void> {
  if (parserInitializedValue) {
    return;
  }

  await Parser.init();

  const [tsLangValue, tsxLangValue] = await Promise.all([
    Parser.Language.load(wasmPathGet('tree-sitter-typescript')),
    Parser.Language.load(wasmPathGet('tree-sitter-tsx')),
  ]);

  typescriptLanguage = tsLangValue;
  tsxLanguage = tsxLangValue;
  parserInitializedValue = true;
}

/**
 * Creates a Tree-sitter parser configured for the given file type.
 * @returns Result containing the parser or an error message
 */
export function parserGetForFile(filePathValue: string): Result<Parser, string> {
  if (!parserInitializedValue) {
    const error = 'Parser not initialized. Call parserInit() before scanning files.';
    console.error(error);
    return Err(error);
  }
  const parserValue = new Parser();
  if (filePathValue.endsWith('.tsx')) {
    parserValue.setLanguage(tsxLanguage);
  } else {
    parserValue.setLanguage(typescriptLanguage);
  }
  return Ok(parserValue);
}
