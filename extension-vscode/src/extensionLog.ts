import * as vscode from 'vscode';

/** Shared VS Code Output channel name for Codepol extension + LSP client traces. */
export const CODEPOL_LSP_TRACE_OUTPUT_NAME = 'Codepol LSP';

let outputChannel: vscode.LogOutputChannel | undefined;

/**
 * Lazily creates the singleton `LogOutputChannel` used for extension lifecycle
 * and language client instrumentation.
 */
export function codepolExtensionOutputChannelGet(): vscode.LogOutputChannel {
  outputChannel ??= vscode.window.createOutputChannel(CODEPOL_LSP_TRACE_OUTPUT_NAME, {
    log: true,
  });
  return outputChannel;
}

function formatMessage(name: string, detail?: string): string {
  if (detail === undefined || detail === '') {
    return name;
  }
  return `${name} ${detail}`;
}

function formatFields(fields?: Record<string, unknown>): string | undefined {
  if (fields === undefined || Object.keys(fields).length === 0) {
    return undefined;
  }
  try {
    return JSON.stringify(fields);
  } catch {
    return String(fields);
  }
}

/** Lifecycle boundaries: visible at default log levels. */
export function codepolExtensionLogInfo(
  name: string,
  fields?: Record<string, unknown>,
  message?: string,
): void {
  const ch = codepolExtensionOutputChannelGet();
  const extra = formatFields(fields);
  const line = extra ? `${formatMessage(name, message)} ${extra}` : formatMessage(name, message);
  ch.info(line);
}

/** Progress and repeated events: typically filtered unless log level is verbose. */
export function codepolExtensionLogDebug(
  name: string,
  fields?: Record<string, unknown>,
  message?: string,
): void {
  const ch = codepolExtensionOutputChannelGet();
  const extra = formatFields(fields);
  const line = extra ? `${formatMessage(name, message)} ${extra}` : formatMessage(name, message);
  ch.debug(line);
}

export function codepolExtensionLogError(
  name: string,
  fields?: Record<string, unknown>,
  message?: string,
): void {
  const ch = codepolExtensionOutputChannelGet();
  const extra = formatFields(fields);
  const line = extra ? `${formatMessage(name, message)} ${extra}` : formatMessage(name, message);
  ch.error(line);
}

export function codepolExtensionLogTrace(name: string, message?: string): void {
  codepolExtensionOutputChannelGet().trace(formatMessage(name, message));
}
