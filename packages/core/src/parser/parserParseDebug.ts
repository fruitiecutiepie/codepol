/**
 * Debug-only tracing for web-tree-sitter `parser.parse()` calls.
 *
 * Gate: `CODEPOL_DEBUG_PARSE=1` (or any truthy value) enables logging.
 * Output: stderr via `console.error`, tagged with `[codepol-parse-debug]`.
 *
 * The WASM module is shared process-wide; once Emscripten `abort()` fires,
 * every subsequent call re-throws `RuntimeError: Aborted()`. To separate
 * the true culprit from collateral damage we track whether any prior
 * parse in this process has already thrown, and tag the log accordingly.
 *
 * This module intentionally has NO side effects unless the env flag is set.
 */
import type Parser from 'web-tree-sitter';
import type { Tree } from 'web-tree-sitter';

type ParseDebugContext = {
  /** Absolute file path whose source is being parsed. */
  filePath: string;
  /** Optional rule id for tree-check call sites; index/adapter sites may omit. */
  ruleId?: string;
  /** Short label identifying the call site (e.g. "jsTsTree", "adapterCore"). */
  callSite: string;
};

type ParseDebugTracker = {
  firstAbortLogged: boolean;
  parseCount: number;
};

const parseDebugTrackerKey = Symbol.for('codepol.parser-parse-debug-tracker');

type GlobalWithDebugTracker = typeof globalThis & {
  [parseDebugTrackerKey]?: ParseDebugTracker;
};

function debugTrackerGet(): ParseDebugTracker {
  const g = globalThis as GlobalWithDebugTracker;
  if (!g[parseDebugTrackerKey]) {
    g[parseDebugTrackerKey] = {
      firstAbortLogged: false,
      parseCount: 0,
    };
  }
  return g[parseDebugTrackerKey]!;
}

function debugIsEnabled(): boolean {
  const raw = process.env.CODEPOL_DEBUG_PARSE;
  if (!raw) {
    return false;
  }
  const trimmed = raw.trim().toLowerCase();
  return trimmed !== '' && trimmed !== '0' && trimmed !== 'false';
}

function sourcePreviewGet(source: unknown): string {
  if (typeof source !== 'string') {
    return `<non-string:${typeof source}>`;
  }
  const head = source.slice(0, 80).replace(/\s+/g, ' ');
  return head.length < source.length ? `${head}...` : head;
}

function sourceByteLengthGet(source: unknown): number | undefined {
  if (typeof source !== 'string') {
    return undefined;
  }
  return Buffer.byteLength(source, 'utf8');
}

function errorIsWasmAbort(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const name = err.name ?? '';
  const message = err.message ?? '';
  return name === 'RuntimeError' || /\bAborted\b/.test(message);
}

/**
 * Runs `parser.parse(source)` with optional diagnostic logging.
 *
 * Always returns whatever `parser.parse` returns; always re-throws whatever
 * `parser.parse` throws. Logging is strictly additive and gated on
 * `CODEPOL_DEBUG_PARSE`.
 */
export function parserParseDebug(
  parser: Parser,
  source: string,
  context: ParseDebugContext,
): Tree {
  if (!debugIsEnabled()) {
    return parser.parse(source);
  }

  const tracker = debugTrackerGet();
  const parseIndex = ++tracker.parseCount;
  const byteLength = sourceByteLengthGet(source);
  const preview = sourcePreviewGet(source);

  console.error(
    `[codepol-parse-debug] parse#${parseIndex} begin`,
    JSON.stringify({
      callSite: context.callSite,
      ruleId: context.ruleId,
      filePath: context.filePath,
      sourceType: typeof source,
      sourceLength: typeof source === 'string' ? source.length : undefined,
      sourceByteLength: byteLength,
      sourcePreview: preview,
      firstAbortAlreadyLogged: tracker.firstAbortLogged,
    }),
  );

  const startedAtNs = process.hrtime.bigint();
  try {
    const tree = parser.parse(source);
    const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
    console.error(
      `[codepol-parse-debug] parse#${parseIndex} ok`,
      JSON.stringify({
        callSite: context.callSite,
        ruleId: context.ruleId,
        filePath: context.filePath,
        elapsedMs,
        rootType: tree.rootNode.type,
      }),
    );
    return tree;
  } catch (err) {
    const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
    const wasmAbort = errorIsWasmAbort(err);
    const collateral = wasmAbort && tracker.firstAbortLogged;
    if (wasmAbort && !tracker.firstAbortLogged) {
      tracker.firstAbortLogged = true;
    }
    const errorName = err instanceof Error ? err.name : typeof err;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    console.error(
      `[codepol-parse-debug] parse#${parseIndex} threw ` +
        (collateral
          ? '(COLLATERAL: WASM already aborted in an earlier parse)'
          : wasmAbort
            ? '(FIRST WASM ABORT: inspect this file/source)'
            : '(non-abort error)'),
      JSON.stringify({
        callSite: context.callSite,
        ruleId: context.ruleId,
        filePath: context.filePath,
        sourceType: typeof source,
        sourceLength: typeof source === 'string' ? source.length : undefined,
        sourceByteLength: byteLength,
        sourcePreview: preview,
        elapsedMs,
        errorName,
        errorMessage,
      }),
    );
    if (errorStack) {
      console.error(`[codepol-parse-debug] parse#${parseIndex} stack\n${errorStack}`);
    }
    throw err;
  }
}
