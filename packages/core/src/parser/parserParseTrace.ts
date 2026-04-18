/**
 * Thin tracing wrapper around web-tree-sitter `parser.parse()`.
 *
 * The wrapper never branches on "debug on?" itself — it just calls the
 * injected `Diagnostics`, which owns gating. Normal mode pays the cost of
 * two `enabled(...)` checks and a span begin/end; debug payload builders run
 * lazily only when the effective level permits.
 *
 * The WASM module is shared process-wide; once Emscripten `abort()` fires,
 * every subsequent parse re-throws `RuntimeError: Aborted()`. To separate
 * the true culprit from collateral damage we track whether any prior parse
 * in this process has already thrown, and tag the log accordingly. Tracker
 * lives on `globalThis` under a `Symbol.for` key so every module instance
 * sharing the process observes the same state.
 */
import type Parser from 'web-tree-sitter';
import type { Tree } from 'web-tree-sitter';
import type { Diagnostics } from '../diagnostics/diagnosticsTypes';

export type ParserParseTraceContext = {
  /** Absolute file path whose source is being parsed. */
  filePath: string;
  /** Optional rule id for tree-check call sites; index/adapter sites may omit. */
  ruleId?: string;
  /** Short label identifying the call site (e.g. "adapterCore"). */
  callSite: string;
};

/**
 * Information passed to an abort handler when the shared WASM instance
 * first aborts. Handlers can use this to log, report, or terminate the
 * owning process. The parse call itself still throws the original error;
 * handlers are invoked synchronously *before* the re-throw.
 */
export type ParserParseAbortInfo = {
  callSite: string;
  ruleId?: string;
  filePath: string;
  parseIndex: number;
  sourceLength: number | undefined;
  sourceByteLength: number | undefined;
  sourcePreview: string;
  errorName: string;
  errorMessage: string;
};

export type ParserParseAbortHandler = (info: ParserParseAbortInfo) => void;

type ParseAbortTracker = {
  firstAbortLogged: boolean;
  parseCount: number;
  /**
   * Optional, at-most-once handler invoked on the FIRST abort only. Kept
   * on the tracker (globalThis-scoped) so multiple `@codepol/core` module
   * instances observe the same registration across re-requires.
   */
  firstAbortHandler?: ParserParseAbortHandler;
};

const parseAbortTrackerKey = Symbol.for('codepol.parser-parse-abort-tracker');

type GlobalWithTracker = typeof globalThis & {
  [parseAbortTrackerKey]?: ParseAbortTracker;
};

function abortTrackerGet(): ParseAbortTracker {
  const g = globalThis as GlobalWithTracker;
  if (!g[parseAbortTrackerKey]) {
    g[parseAbortTrackerKey] = {
      firstAbortLogged: false,
      parseCount: 0,
    };
  }
  return g[parseAbortTrackerKey]!;
}

/**
 * Every `parser.parse()` call allocates WASM-side memory for the returned
 * `Tree`. JavaScript's GC only reclaims the JS wrapper — the underlying
 * native buffer remains pinned until `tree.delete()` is called explicitly.
 * After thousands of parses the 16 MB default WASM heap fills up and the
 * module aborts with `RuntimeError: Aborted()`.
 *
 * Most callers do not want to manage tree lifetimes manually, so we
 * register every tree with a `FinalizationRegistry`: once the JS wrapper
 * becomes unreachable, the registry's cleanup callback reclaims the
 * native memory. This is best-effort (finalizers are not guaranteed to
 * run promptly) but — combined with pooled parsers — is sufficient to
 * keep the WASM heap bounded for long-running daemons.
 *
 * SyntaxNode instances hold a strong reference to their Tree, so as long
 * as any node from a tree is alive the tree will not be finalized. That
 * invariant is what makes this safe despite callers often destructuring
 * `{ root }` and discarding the `tree` variable — `root.tree` pins it.
 *
 * The held value deliberately does NOT reference the Tree JS wrapper:
 * FinalizationRegistry keeps its held values strongly, so any reference
 * back to the target would prevent collection. Instead we capture just
 * the raw native pointer (`tree[0]`) and a reference to the prototype
 * `delete` method. At finalization time we invoke the method on a stub
 * object that carries the pointer, which lets the tree-sitter runtime
 * call `_ts_tree_delete(ptr)` without needing the original wrapper.
 */
type TreeDeleteMethod = (this: { 0: number }) => void;
type TreeCleanupHandle = {
  /**
   * Native pointer at registration time. The finalizer calls
   * `_ts_tree_delete(ptr)` on this address. Once the tree is disposed
   * (either explicitly by a caller or by a prior finalizer run), this is
   * set to 0 so any subsequent finalizer fire becomes a no-op — guarding
   * against double-free which corrupts the WASM heap.
   */
  ptr: number;
  deleteFn: TreeDeleteMethod;
};

// Minimal structural type for `FinalizationRegistry`. The global lib type
// only landed in ES2021 and this package targets ES2019, but Node ≥ 14.6
// supplies the runtime. Declaring the shape locally avoids bumping `lib`
// across the whole codebase.
type FinalizationRegistryLike<T> = {
  register(target: object, heldValue: T, unregisterToken?: object): void;
  unregister(unregisterToken: object): boolean;
};
type FinalizationRegistryCtor = new <T>(
  cleanup: (heldValue: T) => void,
) => FinalizationRegistryLike<T>;

const finalizationRegistryCtor: FinalizationRegistryCtor | undefined = (() => {
  const globalAny = globalThis as unknown as {
    FinalizationRegistry?: FinalizationRegistryCtor;
  };
  return typeof globalAny.FinalizationRegistry === 'function'
    ? globalAny.FinalizationRegistry
    : undefined;
})();

const treeFinalizer: FinalizationRegistryLike<TreeCleanupHandle> | undefined =
  finalizationRegistryCtor
    ? new finalizationRegistryCtor<TreeCleanupHandle>((handle) => {
        if (handle.ptr === 0) return;
        const ptr = handle.ptr;
        // Clear before calling delete so a re-entrant finalizer (unlikely
        // but possible) cannot race into a double-free.
        handle.ptr = 0;
        try {
          // Call the prototype method with a stub `this` that carries the
          // pointer. The method closes over the tree-sitter module's `C`
          // object so it can free native memory without the original JS
          // wrapper.
          handle.deleteFn.call({ 0: ptr });
        } catch {
          // `delete()` on a tree whose owning WASM module already aborted
          // (or was torn down) will itself throw. Finalizer failures must
          // not propagate.
        }
      })
    : undefined;

type TreeWithPointer = { 0: number; delete: TreeDeleteMethod };

/**
 * Tracks the in-flight cleanup handle for each live Tree so callers can
 * invalidate it before explicit disposal (`treeDisposeNow`) to prevent
 * the finalizer from firing a second `_ts_tree_delete` on a pointer the
 * tree-sitter allocator has already freed. A double-free in the WASM
 * allocator corrupts its free list, which manifests downstream as
 * 100 %-CPU spins, `RuntimeError: Aborted()`, or silent heap damage.
 *
 * `WeakMap` keys are held weakly, so this map never extends tree lifetime.
 */
const treeCleanupHandles = new WeakMap<object, TreeCleanupHandle>();

function treeRegisterForCleanup(tree: unknown): void {
  if (!treeFinalizer || !tree || typeof tree !== 'object') return;
  const candidate = tree as Partial<TreeWithPointer>;
  const ptr = candidate[0];
  const deleteFn = candidate.delete;
  if (typeof ptr !== 'number' || ptr === 0 || typeof deleteFn !== 'function') {
    return;
  }
  const handle: TreeCleanupHandle = { ptr, deleteFn };
  // Register with `tree` as both the finalize target AND the unregister
  // token. This lets `treeDisposeNow` cancel the pending finalizer at the
  // moment of explicit disposal.
  treeFinalizer.register(tree, handle, tree);
  treeCleanupHandles.set(tree, handle);
}

/**
 * Explicitly releases a tree's native memory and unregisters its pending
 * finalizer so it does not double-free. Safe to call multiple times.
 *
 * Callers that finish with a tree inside a tight loop (e.g. bulk
 * indexing) should use this instead of relying on GC-driven cleanup,
 * because the WASM heap can fill faster than finalizers run.
 */
export function treeDisposeNow(tree: unknown): void {
  if (!tree || typeof tree !== 'object') return;
  const target = tree as object;
  const handle = treeCleanupHandles.get(target);
  const alreadyDisposed = handle ? handle.ptr === 0 : false;
  if (handle) {
    // Zero the handle BEFORE calling delete: if the finalizer somehow
    // fires concurrently (re-entrant GC inside delete, for instance)
    // it will observe ptr === 0 and skip the free.
    handle.ptr = 0;
    treeCleanupHandles.delete(target);
  }
  if (treeFinalizer) {
    try {
      treeFinalizer.unregister(target);
    } catch {
      // Some engines throw if the token was never registered; ignore.
    }
  }
  if (alreadyDisposed) return;
  const candidate = tree as Partial<TreeWithPointer>;
  if (typeof candidate.delete !== 'function') return;
  // Skip if the tree's native pointer is already cleared — that means
  // `tree.delete()` was called directly by some other code path.
  if (candidate[0] === 0) return;
  try {
    candidate.delete.call(target as { 0: number });
  } catch {
    // Tree may already be disposed (WASM aborted mid-parse, etc.).
  }
}

/**
 * Register a handler invoked exactly once — on the first process-wide WASM
 * abort. Subsequent aborts (the "collateral" ones) do not fire it.
 * Passing `undefined` unregisters. Intended for the daemon entry point to
 * call `process.exit(70)` so the LSP respawns with a fresh WASM instance.
 */
export function parserParseAbortHandlerSet(
  handler: ParserParseAbortHandler | undefined,
): void {
  const tracker = abortTrackerGet();
  tracker.firstAbortHandler = handler;
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
  if (!(err instanceof Error)) return false;
  const name = err.name ?? '';
  const message = err.message ?? '';
  return name === 'RuntimeError' || /\bAborted\b/.test(message);
}

/**
 * Runs `parser.parse(source)` with optional diagnostic tracing.
 *
 * Always returns whatever `parser.parse` returns; always re-throws whatever
 * `parser.parse` throws. Tracing is strictly additive and gated by the
 * injected `Diagnostics`.
 */
export function parserParseTrace(
  parser: Parser,
  source: string,
  diag: Diagnostics,
  context: ParserParseTraceContext,
): Tree {
  const tracker = abortTrackerGet();
  const parseIndex = ++tracker.parseCount;

  const span = diag.span('parse', {
    callSite: context.callSite,
    ruleId: context.ruleId,
    filePath: context.filePath,
    parseIndex,
  });

  if (diag.enabled('debug')) {
    diag.debug('parse.begin', () => ({
      callSite: context.callSite,
      ruleId: context.ruleId,
      filePath: context.filePath,
      parseIndex,
      sourceType: typeof source,
      sourceLength: typeof source === 'string' ? source.length : undefined,
      sourceByteLength: sourceByteLengthGet(source),
      sourcePreview: sourcePreviewGet(source),
      firstAbortAlreadyLogged: tracker.firstAbortLogged,
    }));
  }

  try {
    const tree = parser.parse(source);
    // Arrange for the native memory backing `tree` to be reclaimed once
    // the JS wrapper (and any SyntaxNodes that reference it) become
    // unreachable. Without this, long-running processes exhaust the
    // shared WASM heap and every subsequent parse throws
    // `RuntimeError: Aborted()`.
    treeRegisterForCleanup(tree);
    span.end({ ok: true, rootType: tree.rootNode.type });
    return tree;
  } catch (err) {
    const wasmAbort = errorIsWasmAbort(err);
    const wasFirstAbort = wasmAbort && !tracker.firstAbortLogged;
    const collateral = wasmAbort && !wasFirstAbort;
    if (wasFirstAbort) {
      tracker.firstAbortLogged = true;
    }
    const errorName = err instanceof Error ? err.name : typeof err;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    const tag = collateral
      ? 'collateral_abort'
      : wasmAbort
        ? 'first_abort'
        : 'non_abort';
    const sourceLength = typeof source === 'string' ? source.length : undefined;
    const sourceByteLength = sourceByteLengthGet(source);
    const sourcePreview = sourcePreviewGet(source);
    diag.error('parse.failed', {
      tag,
      callSite: context.callSite,
      ruleId: context.ruleId,
      filePath: context.filePath,
      parseIndex,
      sourceType: typeof source,
      sourceLength,
      sourceByteLength,
      sourcePreview,
      errorName,
      errorMessage,
    });
    if (errorStack) {
      diag.debug('parse.failed.stack', () => ({
        parseIndex,
        stack: errorStack,
      }));
    }
    span.end({ ok: false, tag });
    if (wasFirstAbort && tracker.firstAbortHandler) {
      try {
        tracker.firstAbortHandler({
          callSite: context.callSite,
          ruleId: context.ruleId,
          filePath: context.filePath,
          parseIndex,
          sourceLength,
          sourceByteLength,
          sourcePreview,
          errorName,
          errorMessage,
        });
      } catch (handlerError) {
        diag.error('parse.abort_handler_threw', {
          parseIndex,
          handlerErrorMessage:
            handlerError instanceof Error
              ? handlerError.message
              : String(handlerError),
        });
      }
    }
    throw err;
  }
}
