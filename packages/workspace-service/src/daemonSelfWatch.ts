/**
 * Self-termination utilities for long-lived daemon processes.
 *
 * Two independent watchdogs, both safe to stack:
 *
 * 1. `daemonSelfWatchEntryFileStart` — watch the daemon's own bundled
 *    entry file and exit when it changes on disk. Lets the VSCode dev
 *    loop (rebuild → install → reload window) reliably replace a running
 *    daemon without leaving poisoned ones behind.
 *
 * 2. `daemonExitOnFirstWasmAbortInstall` — register a
 *    {@link ParserParseAbortHandler} that calls `process.exit(exitCode)`
 *    on the first WASM abort in the process. Emscripten's `abort()` puts
 *    the shared tree-sitter module into an unrecoverable state where
 *    every subsequent `parser.parse` throws `RuntimeError: Aborted()`.
 *    Exiting is the only reliable recovery; the LSP will respawn a fresh
 *    daemon on its next request and parsing is healthy again.
 *
 * Both functions return a disposer. Neither is invoked automatically —
 * the daemon entry point opts in explicitly so other callers of the
 * workspace service (CLI, ESLint in-process) are unaffected.
 */
import fs from 'node:fs';
import {
  parserParseAbortHandlerSet,
  type ParserParseAbortInfo,
} from '@codepol/core';

export type DaemonSelfWatchDispose = () => void;

export type DaemonSelfWatchEntryFileOptions = {
  entryPath: string;
  /**
   * Minimum delay between change detection and exit. File writes are
   * rarely atomic; without a debounce we risk exiting mid-swap. Default
   * 100 ms is enough for typical `cp`/`mv`/editor save sequences.
   */
  debounceMs?: number;
  /** Exit code when the entry file changes. Default `0` (graceful). */
  exitCode?: number;
  /**
   * Hook invoked after the debounce fires and before `process.exit`. Used
   * by tests to observe the watcher without actually terminating. If the
   * hook returns `false`, the exit is suppressed.
   */
  onChange?: (reason: 'changed' | 'renamed') => boolean | void;
};

/**
 * Starts a filesystem watcher on `entryPath`. On any change/rename, after
 * the debounce window, invokes `onChange` and then `process.exit`. Swallows
 * watcher errors (some filesystems like overlayfs don't support `fs.watch`);
 * returns a no-op disposer in that case so callers need not branch.
 */
export function daemonSelfWatchEntryFileStart(
  options: DaemonSelfWatchEntryFileOptions,
): DaemonSelfWatchDispose {
  const debounceMs = options.debounceMs ?? 100;
  const exitCode = options.exitCode ?? 0;
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;

  const scheduleExit = (reason: 'changed' | 'renamed'): void => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (disposed) return;
      const shouldExit = options.onChange?.(reason) !== false;
      if (shouldExit) {
        process.exit(exitCode);
      }
    }, debounceMs);
    timer.unref?.();
  };

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(options.entryPath, (eventType) => {
      scheduleExit(eventType === 'rename' ? 'renamed' : 'changed');
    });
    watcher.on('error', () => {
      // Silent — watchers can die on platforms we don't support. The
      // LSP's freshness check still supersedes stale daemons on reload.
    });
  } catch {
    // Same rationale as above.
  }

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // best-effort
      }
    }
  };
}

export type DaemonExitOnFirstWasmAbortOptions = {
  /** Exit code used when the first WASM abort fires. Default `70`. */
  exitCode?: number;
  /**
   * Hook invoked before `process.exit`. Used by tests or callers who
   * want to log first. Returning `false` suppresses the exit.
   */
  onAbort?: (info: ParserParseAbortInfo) => boolean | void;
};

/**
 * Registers a parse-abort handler that terminates the process on the
 * first WASM abort. The handler is idempotent — parserParseTrace only
 * invokes the registered handler once per process lifetime (on the first
 * abort), so every retry scenario is naturally covered.
 */
export function daemonExitOnFirstWasmAbortInstall(
  options: DaemonExitOnFirstWasmAbortOptions = {},
): DaemonSelfWatchDispose {
  const exitCode = options.exitCode ?? 70;
  parserParseAbortHandlerSet((info) => {
    const shouldExit = options.onAbort?.(info) !== false;
    if (!shouldExit) return;
    // Defer one tick so the diag.error sink has a chance to flush before
    // the process dies. `unref` on the timer so a fast-failing process
    // doesn't block the exit.
    const t = setTimeout(() => {
      process.exit(exitCode);
    }, 0);
    t.unref?.();
  });
  return () => {
    parserParseAbortHandlerSet(undefined);
  };
}
