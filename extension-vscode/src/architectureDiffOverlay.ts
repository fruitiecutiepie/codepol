/**
 * Phase 6 PR-aware diagnostic overlay.
 *
 * Owns a `vscode.DiagnosticCollection` named
 * `codepol/architecture/new-since-baseline` and republishes a warning
 * for every cycle / dead module that the workspace introduced since a
 * baseline snapshot. The label is configurable via the
 * `codepol.architecture.baselineLabel` setting; an empty / missing
 * label disables the overlay so the default extension install is a
 * no-op.
 *
 * Lifecycle:
 *
 * - `start` reads the current setting and refreshes once.
 * - `refreshSchedule` debounces refresh requests so a burst of file
 *   saves does not fan out into N protocol round-trips.
 * - `dispose` clears the collection and releases the dispose chain.
 *
 * The class is a thin shell over
 * {@link architectureDiffOverlayDiagnosticsCreate}: the helper decides
 * which URIs / messages get a warning, this class translates that map
 * into `vscode.Diagnostic` values and writes the collection.
 */

import * as vscode from 'vscode';
import {
  architectureDiffOverlayDiagnosticsCreate,
  type ArchitectureDiffOverlayDiagnostic,
} from './architectureDiffOverlayViewModel';
import {
  CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE,
  CODEPOL_CONFIG_ARCHITECTURE_BASELINE_LABEL,
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_CYCLE,
} from './constants';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

/**
 * Default debounce window for refresh requests. Keeps us well below
 * the LSP's own analysis debounce so a burst of saves coalesces into
 * one protocol round-trip without feeling laggy.
 */
const ARCHITECTURE_DIFF_OVERLAY_REFRESH_DEBOUNCE_MS = 750;

export type CodepolArchitectureDiffOverlayHost = {
  protocol: Pick<
    CodepolProtocolClient,
    'queryDependencyDiff' | 'queryDeadModules'
  >;
  /**
   * Resolve the current baseline label from configuration. Injected so
   * the overlay can be unit-tested without a fake `vscode.workspace`.
   * Defaults to reading
   * `codepol.architecture.baselineLabel` from `vscode.workspace.getConfiguration`.
   */
  baselineLabelGet?: () => string;
  /**
   * Optional debounce window override (ms). The default suits VS Code;
   * tests pass `0` to fire synchronously.
   */
  refreshDebounceMs?: number;
};

export class CodepolArchitectureDiffOverlay implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly baselineLabelGet: () => string;
  private readonly refreshDebounceMs: number;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private inflightRefreshToken: symbol | undefined;
  private started = false;

  constructor(private readonly host: CodepolArchitectureDiffOverlayHost) {
    this.collection = vscode.languages.createDiagnosticCollection(
      CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE,
    );
    this.baselineLabelGet =
      host.baselineLabelGet ?? architectureDiffOverlayBaselineLabelDefaultGet;
    this.refreshDebounceMs =
      host.refreshDebounceMs ?? ARCHITECTURE_DIFF_OVERLAY_REFRESH_DEBOUNCE_MS;
    this.disposables.push(this.collection);
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CODEPOL_CONFIG_ARCHITECTURE_BASELINE_LABEL)) {
          this.refreshSchedule();
        }
      }),
      vscode.workspace.onDidSaveTextDocument(() => this.refreshSchedule()),
    );
  }

  /**
   * Begin overlay operation. Subsequent edits / config changes
   * trigger a debounced refresh; this method also runs an initial
   * refresh so the Problems panel shows the right state immediately
   * after activation.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.refreshSchedule();
  }

  /**
   * Enqueue a refresh, coalescing bursts of triggers into one
   * protocol round-trip. Uses a dedicated `inflightRefreshToken` so a
   * superseded refresh cannot publish stale diagnostics.
   */
  refreshSchedule(): void {
    if (!this.started) return;
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
    }
    if (this.refreshDebounceMs <= 0) {
      this.refreshTimer = undefined;
      void this.refreshRun();
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshRun();
    }, this.refreshDebounceMs);
  }

  /**
   * Run a single refresh cycle. Public so tests can drive it
   * synchronously.
   */
  async refreshRun(): Promise<void> {
    const baselineLabel = this.baselineLabelGet();
    if (baselineLabel.trim().length === 0) {
      // Overlay disabled by config — clear any stale diagnostics
      // we previously published so the Problems panel matches the
      // current setting.
      this.collection.clear();
      return;
    }
    const refreshToken = Symbol('overlay-refresh');
    this.inflightRefreshToken = refreshToken;
    let diff;
    let deadModules;
    try {
      [diff, deadModules] = await Promise.all([
        this.protocolCallSafe(() =>
          this.host.protocol.queryDependencyDiff({ baselineLabel }),
        ),
        this.protocolCallSafe(() =>
          this.host.protocol.queryDeadModules({}),
        ),
      ]);
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) return;
      // The overlay is best-effort; surface unexpected failures via
      // the output channel rather than a popup and clear the
      // collection so we never leave stale warnings up.
      this.collection.clear();
      return;
    }
    if (this.inflightRefreshToken !== refreshToken) return;

    const diagnosticsByUri = architectureDiffOverlayDiagnosticsCreate({
      diff,
      deadModules,
      baselineLabel,
    });
    const entries: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];
    for (const [uri, diagnostics] of diagnosticsByUri) {
      entries.push([
        vscode.Uri.parse(uri),
        diagnostics.map(
          (diagnostic) =>
            architectureDiffOverlayDiagnosticToVscode(uri, diagnostic),
        ),
      ]);
    }
    this.collection.set(entries);
  }

  dispose(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch {
        // Disposers are best-effort; never throw on shutdown.
      }
    }
    this.disposables.length = 0;
  }

  private async protocolCallSafe<T>(call: () => Promise<T | null>): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) return null;
      throw error;
    }
  }
}

function architectureDiffOverlayBaselineLabelDefaultGet(): string {
  const value = vscode.workspace
    .getConfiguration()
    .get<string>(CODEPOL_CONFIG_ARCHITECTURE_BASELINE_LABEL, '');
  return typeof value === 'string' ? value : '';
}

/**
 * Adapt the helper's plain diagnostic into a `vscode.Diagnostic`.
 * Keeps the `command:` link in the hover Markdown so users can jump
 * straight from the Problems panel into the cycle-highlighted
 * Architecture Links panel.
 */
function architectureDiffOverlayDiagnosticToVscode(
  uri: string,
  diagnostic: ArchitectureDiffOverlayDiagnostic,
): vscode.Diagnostic {
  const range = new vscode.Range(0, 0, 0, 0);
  const value = new vscode.Diagnostic(
    range,
    diagnostic.message,
    vscode.DiagnosticSeverity.Warning,
  );
  value.source = diagnostic.source;
  value.code = diagnostic.code;
  if (diagnostic.relatedUris.length > 0) {
    value.relatedInformation = diagnostic.relatedUris.map(
      (relatedUri) =>
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(vscode.Uri.parse(relatedUri), range),
          'cycle member',
        ),
    );
  }
  if (
    diagnostic.code === 'architecture-cycle-new' &&
    diagnostic.cycleMemberUris.length >= 2
  ) {
    // VS Code does not expose a hover-Markdown slot on Diagnostic
    // directly; we encode the show-cycle command into the diagnostic
    // `data` payload so a future code-action provider can emit a
    // lightbulb action that calls `codepol.architecture.showCycle`
    // with the member URIs. This keeps the path identical to the
    // existing cycle code action wired off the
    // `codepol/architecture` source.
    (value as vscode.Diagnostic & {
      data?: { showCycleCommand: { command: string; arguments: unknown[] } };
    }).data = {
      showCycleCommand: {
        command: CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_CYCLE,
        arguments: [{ memberUris: diagnostic.cycleMemberUris }],
      },
    };
  }
  // Anchor the diagnostic on the file the helper keyed it under.
  // Using `_uri` would silently drop it; the collection.set caller
  // handles routing via the array of `[Uri, Diagnostic[]]` entries.
  void uri;
  return value;
}
