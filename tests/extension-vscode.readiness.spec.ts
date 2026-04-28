import { describe, expect, it } from 'vitest';
import type { IndexStatusResult } from '@codepol/core';
import {
  codepolFeatureBlockedMessageResolve,
  codepolFeatureUnavailableMessageResolve,
  codepolIndexBackedCommandsEnabledResolve,
  codepolReadinessStateResolve,
  codepolRequestSupersededErrorDataResolve,
  codepolRequestSupersededErrorIs,
  codepolStatusBarPresentationCreate,
  codepolWorkspacePackageRenameEnabledResolve,
} from '../extension-vscode/src/readiness';

function readinessStatusCreate(
  overrides: Partial<IndexStatusResult> = {},
): IndexStatusResult {
  return {
    workspaceId: 'workspace-1',
    workspaceInstanceId: 'instance-1',
    status: 'ready',
    replayState: 'applied',
    workspaceReady: true,
    indexedFileCount: 12,
    openDocumentCount: 1,
    overlayCount: 1,
    analysisGeneration: 3,
    ...overrides,
  };
}

function requestSupersededErrorCreate(): Error & {
  code: string;
  data: {
    kind: 'request_superseded';
    requestType: string;
    requestKey: string;
    requestId: string;
    replacedByRequestId: string;
  };
} {
  const error = new Error('Request superseded') as Error & {
    code: string;
    data: {
      kind: 'request_superseded';
      requestType: string;
      requestKey: string;
      requestId: string;
      replacedByRequestId: string;
    };
  };
  error.code = 'request_superseded';
  error.data = {
    kind: 'request_superseded',
    requestType: 'query_semantic_search',
    requestKey: 'query_semantic_search:client-1:workspace-1',
    requestId: 'semantic-search-request-1',
    replacedByRequestId: 'semantic-search-request-2',
  };
  return error;
}

describe('extension-vscode readiness helpers', () => {
  it('classifies readiness snapshots into blocking and error states', () => {
    expect(
      codepolReadinessStateResolve({
        status: readinessStatusCreate({ status: 'cold', workspaceReady: false }),
      }),
    ).toBe('cold');
    expect(
      codepolReadinessStateResolve({
        status: readinessStatusCreate({
          status: 'warming',
          replayState: 'applied',
          workspaceReady: false,
        }),
      }),
    ).toBe('warming');
    expect(
      codepolReadinessStateResolve({
        status: readinessStatusCreate({
          status: 'ready',
          replayState: 'pending',
          workspaceReady: false,
        }),
      }),
    ).toBe('replay_pending');
    expect(
      codepolReadinessStateResolve({
        status: readinessStatusCreate({ status: 'error', lastError: 'boom' }),
      }),
    ).toBe('error');
    expect(
      codepolReadinessStateResolve({
        status: null,
      }),
    ).toBe('unknown');
  });

  it('builds feature-specific blocked and failure copy', () => {
    const warmingSnapshot = {
      status: readinessStatusCreate({
        status: 'warming',
        replayState: 'applied',
        workspaceReady: false,
      }),
    };
    expect(
      codepolFeatureBlockedMessageResolve(warmingSnapshot, 'semanticSearch'),
    ).toBe('Codepol semantic search is blocked while the workspace index is warming.');
    expect(
      codepolFeatureBlockedMessageResolve(warmingSnapshot, 'workspacePackageRename'),
    ).toBe(
      'Codepol workspace package rename is blocked while the workspace index is warming.',
    );

    expect(
      codepolFeatureUnavailableMessageResolve(
        {
          status: readinessStatusCreate({
            status: 'error',
            lastError: 'Indexing failed',
          }),
        },
        'dependencyGraph',
      ),
    ).toBe(
      'Codepol dependency graph failed: Indexing failed. Open the Codepol view for workspace status.',
    );
  });

  it('maps readiness into command-enablement booleans', () => {
    expect(
      codepolIndexBackedCommandsEnabledResolve({
        status: readinessStatusCreate({ status: 'ready' }),
      }),
    ).toBe(true);
    expect(
      codepolWorkspacePackageRenameEnabledResolve({
        status: readinessStatusCreate({
          status: 'warming',
          workspaceReady: false,
        }),
      }),
    ).toBe(false);
  });

  it('formats the status bar with headline, detail, and feature health', () => {
    const presentation = codepolStatusBarPresentationCreate({
      status: readinessStatusCreate({
        status: 'warming',
        replayState: 'pending',
        workspaceReady: false,
        indexedFileCount: 42,
        featureStatus: {
          diagnostics: { readiness: 'ready' },
          codeActions: { readiness: 'ready' },
          editPlans: { readiness: 'warming', detail: 'Preparing rename previews.' },
          workspaceIndex: { readiness: 'warming', detail: 'Scanning manifests.' },
          workspaceSymbols: { readiness: 'warming' },
          semanticSearch: {
            readiness: 'warming',
            detail: 'Ranking exported symbols.',
          },
          dependencyGraph: { readiness: 'warming', detail: 'Building graph edges.' },
          architectureSummary: {
            readiness: 'degraded',
            detail: 'Graph view is waiting on a stale cache.',
          },
        },
        lastError: 'One background worker restarted.',
      }),
    });

    expect(presentation.text).toBe('$(sync~spin) Codepol Restoring');
    expect(presentation.tone).toBe('warning');
    expect(presentation.tooltip).toContain('Codepol: Warming');
    expect(presentation.tooltip).toContain(
      '42 indexed files • workspace not ready • replay pending',
    );
    expect(presentation.tooltip).toContain(
      'Semantic Search: Warming — Ranking exported symbols.',
    );
    expect(presentation.tooltip).toContain(
      'Architecture Summary: Degraded — Graph view is waiting on a stale cache.',
    );
    expect(presentation.tooltip).toContain(
      'Last error: One background worker restarted.',
    );
  });

  it('uses structured index progress in the status bar label and detail', () => {
    const presentation = codepolStatusBarPresentationCreate({
      status: readinessStatusCreate({
        status: 'warming',
        workspaceReady: false,
        progress: {
          phase: 'building_index_files',
          message: 'Building workspace index (12/48 files)',
          current: 12,
          total: 48,
        },
      }),
    });

    expect(presentation.text).toBe('$(sync~spin) Codepol Indexing');
    expect(presentation.tooltip).toContain(
      'Building workspace index (12/48 files) • workspace not ready • replay applied',
    );
  });

  it('recognizes structured superseded errors', () => {
    const error = requestSupersededErrorCreate();

    expect(codepolRequestSupersededErrorIs(error)).toBe(true);
    expect(codepolRequestSupersededErrorDataResolve(error)).toEqual(error.data);
  });

  it('falls back to the legacy superseded message check', () => {
    expect(codepolRequestSupersededErrorIs(new Error('Request superseded'))).toBe(true);
    expect(codepolRequestSupersededErrorDataResolve(new Error('Request superseded'))).toBeUndefined();
  });
});
