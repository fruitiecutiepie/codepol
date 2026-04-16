import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { WorkspaceSemanticHoverResult } from '@codepol/core';
import {
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
} from './constants';
import type { CodepolProtocolClient } from './protocolClient';
import {
  codepolConnectionDisposedErrorIs,
  codepolFeatureBlockedMessageResolve,
  codepolFeatureGateResolve,
  codepolFeatureUnavailableMessageResolve,
  type CodepolReadinessSnapshot,
} from './readiness';
import type { CodepolReadinessSource } from './readinessController';
import {
  sidebarActiveTargetCreate,
  sidebarIndexStatusCreate,
  sidebarRecentTargetCreate,
  sidebarRecentTargetsNext,
  sidebarSearchResultsCreate,
  type SidebarActiveTargetViewModel,
  type SidebarIndexStatusViewModel,
  type SidebarRecentTargetViewModel,
  type SidebarSearchResultViewModel,
  type SidebarTone,
} from './sidebarModels';

type ActiveEditorLocation = {
  uri: string;
  line: number;
  character: number;
};

type CodepolSidebarState = {
  search: {
    query: string;
    busy: boolean;
    disabled: boolean;
    disabledReason?: string;
    message: string;
    tone: SidebarTone;
    results: SidebarSearchResultViewModel[];
  };
  activeTarget: SidebarActiveTargetViewModel;
  indexStatus: SidebarIndexStatusViewModel;
  recentTargets: SidebarRecentTargetViewModel[];
};

type SidebarViewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'search'; query?: string }
  | {
      type: 'openLocation';
      uri?: string;
      line?: number;
      character?: number;
      sourceLabel?: string;
      title?: string;
      subtitle?: string;
      detail?: string;
    }
  | {
      type: 'hoverAction';
      action?: string;
      uri?: string;
    };

export type CodepolSidebarActions = {
  openLocation(input: {
    uri: string;
    line: number;
    character: number;
  }): Promise<void>;
  executeCommand(command: string, uri: string): Promise<void>;
};

function errorMessageResolve(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function searchPresentationCreate(input: {
  query: string;
  busy: boolean;
  blockedMessage?: string;
  unavailable?: boolean;
  errorMessage?: string;
  results: SidebarSearchResultViewModel[];
}): {
  message: string;
  tone: SidebarTone;
} {
  const normalizedQuery = input.query.trim();

  if (input.busy) {
    return {
      message: 'Searching workspace modules and exported symbols…',
      tone: 'neutral',
    };
  }

  if (input.blockedMessage) {
    return {
      message: input.blockedMessage,
      tone: 'warning',
    };
  }

  if (input.errorMessage) {
    return {
      message: input.errorMessage,
      tone: 'error',
    };
  }

  if (input.unavailable) {
    return {
      message: 'Codepol semantic search is not available for this workspace yet.',
      tone: 'warning',
    };
  }

  if (normalizedQuery.length === 0) {
    return {
      message: 'Search workspace modules and exported symbols by name.',
      tone: 'neutral',
    };
  }

  if (input.results.length === 0) {
    return {
      message: `No semantic matches for "${normalizedQuery}".`,
      tone: 'warning',
    };
  }

  return {
    message: `${input.results.length} semantic match${input.results.length === 1 ? '' : 'es'} for "${normalizedQuery}".`,
    tone: 'neutral',
  };
}

function sidebarStateCreate(): CodepolSidebarState {
  const searchPresentation = searchPresentationCreate({
    query: '',
    busy: false,
    results: [],
  });

  return {
    search: {
      query: '',
      busy: false,
      disabled: false,
      message: searchPresentation.message,
      tone: searchPresentation.tone,
      results: [],
    },
    activeTarget: sidebarActiveTargetCreate({
      hover: null,
    }),
    indexStatus: sidebarIndexStatusCreate({
      status: null,
    }),
    recentTargets: [],
  };
}

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function jsonScriptEscape(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function sidebarHtmlCreate(input: {
  nonce: string;
  initialState: CodepolSidebarState;
}): string {
  const initialState = jsonScriptEscape(input.initialState);

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${input.nonce}';"
      />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Codepol Search &amp; Details</title>
      <style>
        :root {
          color-scheme: light dark;
        }
        body {
          margin: 0;
          padding: 14px;
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent) 0, transparent 42%),
            var(--vscode-sideBar-background);
        }
        .stack {
          display: grid;
          gap: 12px;
        }
        .card {
          border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 86%, transparent);
          border-radius: 12px;
          padding: 12px;
          background: color-mix(in srgb, var(--vscode-sideBar-background) 90%, var(--vscode-editorWidget-border) 10%);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
        }
        .section-header {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .section-header h2,
        .section-header h3 {
          margin: 0;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--vscode-descriptionForeground);
        }
        .section-header p {
          margin: 4px 0 0;
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
        }
        .toolbar-button,
        .list-button,
        .action-button {
          border: 1px solid var(--vscode-button-border, transparent);
          border-radius: 10px;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          cursor: pointer;
        }
        .toolbar-button {
          padding: 7px 10px;
          white-space: nowrap;
        }
        .toolbar-button:hover,
        .list-button:hover,
        .action-button:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }
        .toolbar-button:disabled,
        .list-button:disabled,
        .action-button:disabled {
          cursor: default;
          opacity: 0.6;
          background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 82%, transparent);
        }
        .search-input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--vscode-input-border, transparent);
          border-radius: 10px;
          padding: 10px 12px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          outline: none;
        }
        .search-input:focus {
          border-color: var(--vscode-focusBorder);
        }
        .search-input:disabled {
          opacity: 0.75;
          cursor: default;
        }
        .helper {
          margin: 10px 0 0;
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
        }
        .tone-warning {
          color: var(--vscode-editorWarning-foreground);
        }
        .tone-error {
          color: var(--vscode-errorForeground);
        }
        .tone-success {
          color: var(--vscode-testing-iconPassed);
        }
        .pill-row,
        .action-row,
        .metric-grid,
        .feature-grid,
        .list {
          display: grid;
          gap: 8px;
        }
        .metric-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          margin-top: 12px;
        }
        .metric {
          padding: 10px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-input-background) 86%, transparent);
        }
        .metric-label,
        .feature-label,
        .meta-label {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--vscode-descriptionForeground);
        }
        .metric-value,
        .feature-readiness {
          display: block;
          margin-top: 4px;
          font-weight: 600;
        }
        .feature-grid {
          margin-top: 12px;
        }
        .feature {
          padding: 10px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editorWidget-background) 82%, transparent);
        }
        .feature-detail,
        .target-subtitle,
        .target-summary,
        .target-status,
        .result-meta,
        .source-label,
        .empty {
          color: var(--vscode-descriptionForeground);
        }
        .feature-detail,
        .target-summary,
        .result-meta,
        .empty {
          margin-top: 4px;
          font-size: 12px;
        }
        .target-title,
        .result-title,
        .recent-title {
          font-size: 14px;
          font-weight: 600;
        }
        .target-subtitle,
        .recent-subtitle {
          margin-top: 4px;
          font-size: 12px;
        }
        .target-summary,
        .target-status {
          margin-top: 8px;
        }
        .field-list {
          list-style: none;
          padding: 0;
          margin: 12px 0 0;
          display: grid;
          gap: 8px;
        }
        .field-item {
          display: grid;
          gap: 3px;
          padding: 10px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-input-background) 84%, transparent);
        }
        .action-row {
          grid-auto-flow: column;
          grid-auto-columns: 1fr;
          margin-top: 12px;
        }
        .action-button {
          padding: 9px 10px;
        }
        .list {
          list-style: none;
          padding: 0;
          margin: 10px 0 0;
        }
        .list-button {
          width: 100%;
          text-align: left;
          padding: 10px;
        }
        .result-topline,
        .recent-topline {
          display: flex;
          gap: 8px;
          align-items: baseline;
          justify-content: space-between;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 3px 8px;
          font-size: 11px;
          background: color-mix(in srgb, var(--vscode-badge-background) 75%, transparent);
          color: var(--vscode-badge-foreground);
        }
        .source-label {
          margin-top: 8px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
      </style>
    </head>
    <body>
      <div class="stack">
        <section class="card">
          <div class="section-header">
            <div>
              <h2>Semantic Search</h2>
              <p>Workspace modules and exported symbols.</p>
            </div>
            <button class="toolbar-button" data-refresh="true">Refresh</button>
          </div>
          <input
            id="search-input"
            class="search-input"
            type="search"
            placeholder="Search Codepol semantic targets"
            spellcheck="false"
          />
          <div id="search-status"></div>
          <ul id="search-results" class="list"></ul>
        </section>
        <section class="card">
          <div class="section-header">
            <div>
              <h2>Active Target</h2>
              <p>Semantic summary for the focused file.</p>
            </div>
          </div>
          <div id="active-target"></div>
        </section>
        <section class="card">
          <div class="section-header">
            <div>
              <h2>Index Status</h2>
              <p>Workspace readiness and semantic feature health.</p>
            </div>
          </div>
          <div id="index-status"></div>
        </section>
        <section class="card">
          <div class="section-header">
            <div>
              <h2>Recent Targets</h2>
              <p>Files and semantic targets touched by navigation.</p>
            </div>
          </div>
          <ul id="recent-targets" class="list"></ul>
        </section>
      </div>
      <script nonce="${input.nonce}">
        const vscode = acquireVsCodeApi();
        let currentState = ${initialState};
        let searchDebounce;

        const searchInput = document.getElementById('search-input');
        const searchStatus = document.getElementById('search-status');
        const searchResults = document.getElementById('search-results');
        const activeTarget = document.getElementById('active-target');
        const indexStatus = document.getElementById('index-status');
        const recentTargets = document.getElementById('recent-targets');

        function escapeHtml(value) {
          return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
        }

        function toneClass(tone) {
          if (tone === 'success') {
            return 'tone-success';
          }
          if (tone === 'warning') {
            return 'tone-warning';
          }
          if (tone === 'error') {
            return 'tone-error';
          }
          return '';
        }

        function helperHtml(message, tone) {
          if (!message) {
            return '';
          }
          return '<p class="helper ' + toneClass(tone) + '">' + escapeHtml(message) + '</p>';
        }

        function buttonHtml(item) {
          const detail = item.detail
            ? '<div class="result-meta">' + escapeHtml(item.detail) + '</div>'
            : '';
          const subtitle = item.subtitle
            ? '<div class="result-meta">' + escapeHtml(item.subtitle) + '</div>'
            : '';
          return '<li><button class="list-button" data-open-uri="' + escapeHtml(item.uri) + '" data-open-line="' + String(item.line) + '" data-open-character="' + String(item.character) + '" data-source-label="Search" data-title="' + escapeHtml(item.title) + '" data-subtitle="' + escapeHtml(item.subtitle || '') + '" data-detail="' + escapeHtml(item.detail || '') + '"><div class="result-topline"><span class="result-title">' + escapeHtml(item.title) + '</span><span class="badge">' + escapeHtml(item.scoreLabel) + '</span></div>' + subtitle + detail + '</button></li>';
        }

        function recentHtml(item) {
          const subtitle = item.subtitle
            ? '<div class="recent-subtitle">' + escapeHtml(item.subtitle) + '</div>'
            : '';
          const detail = item.detail
            ? '<div class="result-meta">' + escapeHtml(item.detail) + '</div>'
            : '';
          return '<li><button class="list-button" data-open-uri="' + escapeHtml(item.uri) + '" data-open-line="' + String(item.line) + '" data-open-character="' + String(item.character) + '" data-source-label="' + escapeHtml(item.sourceLabel) + '" data-title="' + escapeHtml(item.title) + '" data-subtitle="' + escapeHtml(item.subtitle || '') + '" data-detail="' + escapeHtml(item.detail || '') + '"><div class="recent-topline"><span class="recent-title">' + escapeHtml(item.title) + '</span><span class="badge">' + escapeHtml(item.sourceLabel) + '</span></div>' + subtitle + detail + '</button></li>';
        }

        function renderSearch() {
          if (searchInput instanceof HTMLInputElement && searchInput.value !== currentState.search.query) {
            searchInput.value = currentState.search.query;
          }
          if (searchInput instanceof HTMLInputElement) {
            searchInput.disabled = currentState.search.disabled;
            searchInput.title = currentState.search.disabledReason || '';
          }
          searchStatus.innerHTML = helperHtml(currentState.search.message, currentState.search.tone);
          if (currentState.search.results.length === 0) {
            searchResults.innerHTML = '';
            return;
          }
          searchResults.innerHTML = currentState.search.results.map(buttonHtml).join('');
        }

        function renderActiveTarget() {
          const target = currentState.activeTarget;
          const title = '<div class="target-title">' + escapeHtml(target.title) + '</div>';
          const subtitle = target.subtitle
            ? '<div class="target-subtitle">' + escapeHtml(target.subtitle) + '</div>'
            : '';
          const summary = target.summary
            ? '<div class="target-summary">' + escapeHtml(target.summary) + '</div>'
            : '';
          const status = target.statusText
            ? '<div class="target-status">' + escapeHtml(target.statusText) + '</div>'
            : '';
          const message = target.message
            ? '<div class="target-status ' + toneClass(target.tone) + '">' + escapeHtml(target.message) + '</div>'
            : '';
          const fields = target.fields.length === 0
            ? ''
            : '<ul class="field-list">' + target.fields.map(function(field) {
                return '<li class="field-item"><span class="meta-label">' + escapeHtml(field.label) + '</span><span>' + escapeHtml(field.value) + '</span></li>';
              }).join('') + '</ul>';
          const actions = !target.uri || target.actions.length === 0
            ? ''
            : '<div class="action-row">' + target.actions.map(function(action) {
                const disabled = action.disabled ? ' disabled' : '';
                const title = action.disabledReason
                  ? ' title="' + escapeHtml(action.disabledReason) + '"'
                  : '';
                return '<button class="action-button" data-action="' + escapeHtml(action.action) + '" data-uri="' + escapeHtml(target.uri) + '"' + disabled + title + '>' + escapeHtml(action.label) + '</button>';
              }).join('') + '</div>';
          activeTarget.innerHTML = title + subtitle + summary + status + message + fields + actions;
        }

        function renderIndexStatus() {
          const status = currentState.indexStatus;
          const title = '<div class="target-title ' + toneClass(status.tone) + '">' + escapeHtml(status.headline) + '</div>';
          const detail = '<div class="target-summary">' + escapeHtml(status.detail) + '</div>';
          const metrics = status.metrics.length === 0
            ? ''
            : '<div class="metric-grid">' + status.metrics.map(function(metric) {
                return '<div class="metric"><span class="metric-label">' + escapeHtml(metric.label) + '</span><span class="metric-value">' + escapeHtml(metric.value) + '</span></div>';
              }).join('') + '</div>';
          const features = status.features.length === 0
            ? ''
            : '<div class="feature-grid">' + status.features.map(function(feature) {
                const featureDetail = feature.detail
                  ? '<div class="feature-detail">' + escapeHtml(feature.detail) + '</div>'
                  : '';
                return '<div class="feature"><span class="feature-label">' + escapeHtml(feature.label) + '</span><span class="feature-readiness ' + toneClass(feature.tone) + '">' + escapeHtml(feature.readiness) + '</span>' + featureDetail + '</div>';
              }).join('') + '</div>';
          const lastError = status.lastError
            ? '<div class="target-status tone-error">' + escapeHtml(status.lastError) + '</div>'
            : '';
          indexStatus.innerHTML = title + detail + metrics + features + lastError;
        }

        function renderRecentTargets() {
          if (currentState.recentTargets.length === 0) {
            recentTargets.innerHTML = '<li class="empty">Recent semantic targets will appear here.</li>';
            return;
          }
          recentTargets.innerHTML = currentState.recentTargets.map(recentHtml).join('');
        }

        function render() {
          renderSearch();
          renderActiveTarget();
          renderIndexStatus();
          renderRecentTargets();
        }

        if (searchInput instanceof HTMLInputElement) {
          searchInput.addEventListener('input', function() {
            clearTimeout(searchDebounce);
            const query = searchInput.value;
            searchDebounce = setTimeout(function() {
              vscode.postMessage({
                type: 'search',
                query,
              });
            }, 180);
          });
        }

        document.addEventListener('click', function(event) {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return;
          }

          const refreshButton = target.closest('[data-refresh]');
          if (refreshButton instanceof HTMLElement) {
            vscode.postMessage({ type: 'refresh' });
            return;
          }

          const locationButton = target.closest('[data-open-uri]');
          if (locationButton instanceof HTMLElement) {
            vscode.postMessage({
              type: 'openLocation',
              uri: locationButton.dataset.openUri,
              line: Number(locationButton.dataset.openLine || 0),
              character: Number(locationButton.dataset.openCharacter || 0),
              sourceLabel: locationButton.dataset.sourceLabel,
              title: locationButton.dataset.title,
              subtitle: locationButton.dataset.subtitle,
              detail: locationButton.dataset.detail,
            });
            return;
          }

          const actionButton = target.closest('[data-action]');
          if (actionButton instanceof HTMLElement) {
            vscode.postMessage({
              type: 'hoverAction',
              action: actionButton.dataset.action,
              uri: actionButton.dataset.uri,
            });
          }
        });

        window.addEventListener('message', function(event) {
          const message = event.data;
          if (!message || message.type !== 'state') {
            return;
          }
          currentState = message.state;
          render();
        });

        vscode.postMessage({ type: 'ready' });
        render();
      </script>
    </body>
  </html>`;
}

export class CodepolSidebarViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly state = sidebarStateCreate();
  private refreshRequestId = 0;
  private searchRequestId = 0;
  private searchInitialized = false;
  private activeTargetHover: WorkspaceSemanticHoverResult | null = null;
  private activeTargetErrorMessage: string | undefined;
  private searchErrorMessage: string | undefined;
  private searchUnavailable = false;

  constructor(
    private readonly protocol: CodepolProtocolClient,
    private readonly readiness: CodepolReadinessSource,
    private readonly actions: CodepolSidebarActions,
    private readonly activeLocationGet: () => ActiveEditorLocation | undefined,
    private readonly initialSearchQueryGet: () => string | undefined,
  ) {
    this.state.indexStatus = sidebarIndexStatusCreate(this.readiness.snapshotGet());
    this.disposables.push(
      this.readiness.onDidChange((snapshot) => {
        this.readinessStateApply(snapshot);
      }),
    );
    this.readinessStateApply(this.readiness.snapshotGet());
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = sidebarHtmlCreate({
      nonce: randomBytes(16).toString('hex'),
      initialState: this.state,
    });

    this.disposables.push(
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          void this.refresh();
        }
      }),
      webviewView.webview.onDidReceiveMessage((message: SidebarViewMessage) => {
        void this.messageHandle(message);
      }),
    );

    if (webviewView.visible) {
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    this.searchSeedEnsure();

    const activeLocation = this.activeLocationGet();
    const requestId = ++this.refreshRequestId;
    this.activeTargetHover = null;
    this.activeTargetErrorMessage = undefined;
    this.state.activeTarget = sidebarActiveTargetCreate({
      activeUri: activeLocation?.uri,
      hover: null,
      disabledActionMessages: this.activeTargetDisabledActionMessagesResolve(),
    });
    this.state.indexStatus = sidebarIndexStatusCreate(this.readiness.snapshotGet());
    this.statePush();

    const hoverResult = await this.hoverQuery(activeLocation?.uri);
    if (requestId !== this.refreshRequestId) {
      return;
    }

    this.activeTargetHover = hoverResult.result;
    this.activeTargetErrorMessage = hoverResult.errorMessage;
    this.state.activeTarget = sidebarActiveTargetCreate({
      activeUri: activeLocation?.uri,
      hover: hoverResult.result,
      errorMessage: hoverResult.errorMessage,
      disabledActionMessages: this.activeTargetDisabledActionMessagesResolve(),
    });
    if (activeLocation?.uri) {
      this.recentTargetRecord(
        sidebarRecentTargetCreate({
          uri: activeLocation.uri,
          line: activeLocation.line,
          character: activeLocation.character,
          sourceLabel: 'Active file',
          hover: hoverResult.result,
        }),
      );
    }

    this.statePush();
  }

  async recordLocationVisit(input: {
    uri: string;
    line: number;
    character: number;
    sourceLabel?: string;
    fallbackTitle?: string;
    fallbackSubtitle?: string;
    fallbackDetail?: string;
  }): Promise<void> {
    const hoverResult = await this.hoverQuery(input.uri);
    this.recentTargetRecord(
      sidebarRecentTargetCreate({
        uri: input.uri,
        line: input.line,
        character: input.character,
        sourceLabel: input.sourceLabel ?? 'Opened',
        hover: hoverResult.result,
        fallbackTitle: input.fallbackTitle,
        fallbackSubtitle: input.fallbackSubtitle,
        fallbackDetail: input.fallbackDetail,
      }),
    );
    this.statePush();
  }

  private async messageHandle(message: SidebarViewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.statePush();
      return;
    }

    if (message.type === 'refresh') {
      await this.refresh();
      return;
    }

    if (message.type === 'search') {
      await this.searchRun(message.query ?? '');
      return;
    }

    if (message.type === 'openLocation' && message.uri) {
      this.recentTargetRecord(
        sidebarRecentTargetCreate({
          uri: message.uri,
          line: message.line ?? 0,
          character: message.character ?? 0,
          sourceLabel: message.sourceLabel ?? 'Opened',
          fallbackTitle: message.title,
          fallbackSubtitle: message.subtitle,
          fallbackDetail: message.detail,
        }),
      );
      this.statePush();
      await this.actions.openLocation({
        uri: message.uri,
        line: message.line ?? 0,
        character: message.character ?? 0,
      });
      return;
    }

    if (message.type === 'hoverAction' && message.uri) {
      if (message.action === 'go_to_definition') {
        await this.actions.executeCommand(
          CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
          message.uri,
        );
        return;
      }
      if (
        message.action === 'find_references' ||
        message.action === 'show_graph'
      ) {
        await this.actions.executeCommand(
          CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
          message.uri,
        );
      }
    }
  }

  private async searchRun(query: string): Promise<void> {
    this.searchSeedEnsure();
    const normalizedQuery = query.trim();
    const requestId = ++this.searchRequestId;
    const blockedMessage = codepolFeatureBlockedMessageResolve(
      this.readiness.snapshotGet(),
      'semanticSearch',
    );

    if (blockedMessage) {
      const presentation = searchPresentationCreate({
        query: normalizedQuery,
        busy: false,
        blockedMessage,
        results: [],
      });
      this.searchErrorMessage = undefined;
      this.searchUnavailable = false;
      this.state.search = {
        query: normalizedQuery,
        busy: false,
        disabled: true,
        disabledReason: blockedMessage,
        results: [],
        message: presentation.message,
        tone: presentation.tone,
      };
      this.statePush();
      return;
    }

    if (normalizedQuery.length === 0) {
      const presentation = searchPresentationCreate({
        query: normalizedQuery,
        busy: false,
        results: [],
      });
      this.searchErrorMessage = undefined;
      this.searchUnavailable = false;
      this.state.search = {
        query: '',
        busy: false,
        disabled: false,
        results: [],
        disabledReason: undefined,
        message: presentation.message,
        tone: presentation.tone,
      };
      this.statePush();
      return;
    }

    const busyPresentation = searchPresentationCreate({
      query: normalizedQuery,
      busy: true,
      results: this.state.search.results,
    });
    this.state.search = {
      query: normalizedQuery,
      busy: true,
      disabled: false,
      disabledReason: undefined,
      results: this.state.search.results,
      message: busyPresentation.message,
      tone: busyPresentation.tone,
    };
    this.statePush();

    let unavailable = false;
    let errorMessage: string | undefined;
    let results: SidebarSearchResultViewModel[] = [];

    try {
      const rawResults = await this.protocol.querySemanticSearch(normalizedQuery);
      if (requestId !== this.searchRequestId) {
        return;
      }
      if (rawResults === null) {
        unavailable = true;
      } else {
        results = sidebarSearchResultsCreate(rawResults, normalizedQuery);
      }
    } catch (error) {
      if (requestId !== this.searchRequestId) {
        return;
      }
      if (codepolConnectionDisposedErrorIs(error)) {
        this.searchErrorMessage = undefined;
        this.searchUnavailable = false;
        this.state.search = {
          query: normalizedQuery,
          busy: false,
          disabled: false,
          disabledReason: undefined,
          results: [],
          message: 'Reconnecting to Codepol semantic search…',
          tone: 'neutral',
        };
        this.statePush();
        return;
      }
      errorMessage = errorMessageResolve(error);
    }

    this.searchErrorMessage = errorMessage;
    this.searchUnavailable = unavailable;
    const presentation = searchPresentationCreate({
      query: normalizedQuery,
      busy: false,
      unavailable,
      errorMessage:
        errorMessage ??
        (unavailable
          ? this.semanticSearchUnavailableMessageResolve()
          : undefined),
      results,
    });
    this.state.search = {
      query: normalizedQuery,
      busy: false,
      disabled: false,
      disabledReason: undefined,
      results,
      message: presentation.message,
      tone: presentation.tone,
    };
    this.statePush();
  }

  private recentTargetRecord(next: SidebarRecentTargetViewModel): void {
    this.state.recentTargets = sidebarRecentTargetsNext(
      this.state.recentTargets,
      next,
    );
  }

  private searchSeedEnsure(): void {
    if (this.searchInitialized) {
      return;
    }
    this.searchInitialized = true;
    const initialQuery = this.initialSearchQueryGet()?.trim();
    if (!initialQuery) {
      return;
    }
    void this.searchRun(initialQuery);
  }

  private async hoverQuery(
    uri: string | undefined,
  ): Promise<{
    result: WorkspaceSemanticHoverResult | null;
    errorMessage?: string;
  }> {
    if (!uri) {
      return {
        result: null,
      };
    }

    try {
      return {
        result: await this.protocol.querySemanticHover(uri),
      };
    } catch (error) {
      if (codepolConnectionDisposedErrorIs(error)) {
        return {
          result: null,
        };
      }
      return {
        result: null,
        errorMessage: errorMessageResolve(error),
      };
    }
  }

  private semanticSearchUnavailableMessageResolve(): string {
    const snapshot = this.readiness.snapshotGet();
    return codepolFeatureUnavailableMessageResolve(snapshot, 'semanticSearch');
  }

  private activeTargetDisabledActionMessagesResolve(): Partial<
    Record<'go_to_definition' | 'find_references' | 'show_graph', string>
  > {
    const snapshot = this.readiness.snapshotGet();
    const referencesBlocked = codepolFeatureBlockedMessageResolve(
      snapshot,
      'architectureLinks',
    );
    const graphBlocked =
      codepolFeatureBlockedMessageResolve(snapshot, 'dependencyGraph') ??
      referencesBlocked;

    return {
      find_references: referencesBlocked,
      show_graph: graphBlocked,
    };
  }

  private readinessStateApply(snapshot: CodepolReadinessSnapshot): void {
    this.state.indexStatus = sidebarIndexStatusCreate(snapshot);

    const activeLocation = this.activeLocationGet();
    this.state.activeTarget = sidebarActiveTargetCreate({
      activeUri: activeLocation?.uri,
      hover: this.activeTargetHover,
      errorMessage: this.activeTargetErrorMessage,
      disabledActionMessages: this.activeTargetDisabledActionMessagesResolve(),
    });

    const searchBlockedMessage = codepolFeatureBlockedMessageResolve(
      snapshot,
      'semanticSearch',
    );
    const wasDisabled = this.state.search.disabled;
    this.state.search.disabled = searchBlockedMessage !== undefined;
    this.state.search.disabledReason = searchBlockedMessage;

    if (searchBlockedMessage) {
      const presentation = searchPresentationCreate({
        query: this.state.search.query,
        busy: false,
        blockedMessage: searchBlockedMessage,
        results: [],
      });
      this.searchErrorMessage = undefined;
      this.searchUnavailable = false;
      this.state.search.busy = false;
      this.state.search.results = [];
      this.state.search.message = presentation.message;
      this.state.search.tone = presentation.tone;
      this.statePush();
      return;
    }

    if (
      this.state.search.query.trim().length > 0 &&
      (wasDisabled || this.searchUnavailable)
    ) {
      void this.searchRun(this.state.search.query);
      return;
    }

    const presentation = searchPresentationCreate({
      query: this.state.search.query,
      busy: this.state.search.busy,
      unavailable: this.searchUnavailable,
      errorMessage:
        this.searchErrorMessage ??
        (this.searchUnavailable
          ? this.semanticSearchUnavailableMessageResolve()
          : undefined),
      results: this.state.search.results,
    });
    this.state.search.message = presentation.message;
    this.state.search.tone = presentation.tone;
    this.statePush();
  }

  private statePush(): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage({
      type: 'state',
      state: this.state,
    });
  }
}
