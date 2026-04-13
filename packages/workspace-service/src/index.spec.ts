import { describe, expect, it } from 'vitest';
import type { IndexStatusFeatureStatus } from '@codepol/core';
import {
  severityFromLintSeverity,
  workspaceAnalysisGenerationValidate,
  workspaceDocumentVersionValidate,
  workspaceFeatureStatusReadyOrDegraded,
  workspaceFeatureStatusesCreate,
  workspaceIndexBackedFeatureStatusCreate,
} from './index.js';

function featureStatusesCreate(
  readiness: 'cold' | 'warming' | 'ready' | 'degraded' | 'error',
  detail?: string,
): IndexStatusFeatureStatus {
  return {
    diagnostics: { readiness, detail },
    codeActions: { readiness, detail },
    editPlans: { readiness, detail },
    workspaceIndex: { readiness, detail },
    workspaceSymbols: { readiness, detail },
    semanticSearch: { readiness, detail },
    dependencyGraph: { readiness, detail },
    architectureSummary: { readiness, detail },
  };
}

describe('workspace service status normalization helpers', () => {
  it('maps lint severities onto workspace diagnostic severities', () => {
    expect(severityFromLintSeverity('warn')).toBe('warning');
    expect(severityFromLintSeverity('error')).toBe('error');
    expect(severityFromLintSeverity()).toBe('error');
  });

  it('returns ready detail when there are no analyzer issues and degrades when issues exist', () => {
    expect(
      workspaceFeatureStatusReadyOrDegraded([], {
        readyDetail: 'analysis complete',
      }),
    ).toEqual({
      readiness: 'ready',
      detail: 'analysis complete',
    });
    expect(
      workspaceFeatureStatusReadyOrDegraded([
        'native tree failed',
        'wrapped lint degraded',
      ]),
    ).toEqual({
      readiness: 'degraded',
      detail: 'native tree failed; wrapped lint degraded',
    });
  });

  it('normalizes index-backed feature readiness from index availability', () => {
    expect(
      workspaceIndexBackedFeatureStatusCreate({
        indexReady: true,
        indexRequired: true,
      }),
    ).toEqual({
      readiness: 'ready',
      detail: undefined,
    });
    expect(
      workspaceIndexBackedFeatureStatusCreate({
        indexReady: false,
        indexRequired: true,
      }),
    ).toEqual({
      readiness: 'degraded',
      detail: 'Workspace index required but unavailable',
    });
    expect(
      workspaceIndexBackedFeatureStatusCreate({
        indexReady: false,
        indexRequired: false,
      }),
    ).toEqual({
      readiness: 'cold',
      detail: 'Workspace index not built for this session',
    });
  });

  it('reuses the last analysis feature status once a session is ready', () => {
    const expected = featureStatusesCreate('ready', 'restored from analysis');
    expect(
      workspaceFeatureStatusesCreate({
        status: 'ready',
        lastAnalysis: {
          featureStatus: expected,
        },
        workspaceIndexRequired: true,
      }),
    ).toEqual(expected);
  });

  it('normalizes error status across all features using the last workspace error', () => {
    const result = workspaceFeatureStatusesCreate({
      status: 'error',
      lastError: 'Request cancelled',
      workspaceIndexRequired: true,
    });

    expect(result).toEqual(featureStatusesCreate('error', 'Request cancelled'));
  });

  it('keeps index-backed reads cold when the current policy does not require a workspace index', () => {
    expect(
      workspaceFeatureStatusesCreate({
        status: 'warming',
        workspaceIndexRequired: false,
      }),
    ).toEqual({
      diagnostics: { readiness: 'warming', detail: undefined },
      codeActions: { readiness: 'warming', detail: undefined },
      editPlans: { readiness: 'warming', detail: undefined },
      workspaceIndex: {
        readiness: 'ready',
        detail: 'Not required by current policy',
      },
      workspaceSymbols: {
        readiness: 'cold',
        detail: 'Workspace index not built for this session',
      },
      semanticSearch: {
        readiness: 'cold',
        detail: 'Workspace index not built for this session',
      },
      dependencyGraph: {
        readiness: 'cold',
        detail: 'Workspace index not built for this session',
      },
      architectureSummary: {
        readiness: 'cold',
        detail: 'Workspace index not built for this session',
      },
    });
  });
});

describe('workspace service freshness validators', () => {
  it('allows missing or matching overlay versions and rejects stale document versions', () => {
    const state = {
      documents: new Map([
        [
          'file:///workspace/app.ts',
          {
            version: 3,
          },
        ],
      ]),
    };

    expect(() =>
      workspaceDocumentVersionValidate(state, {
        uri: 'file:///workspace/app.ts',
      }),
    ).not.toThrow();
    expect(() =>
      workspaceDocumentVersionValidate(state, {
        uri: 'file:///workspace/app.ts',
        documentVersion: 3,
      }),
    ).not.toThrow();
    expect(() =>
      workspaceDocumentVersionValidate(state, {
        uri: 'file:///workspace/closed.ts',
        documentVersion: 1,
      }),
    ).not.toThrow();
    expect(() =>
      workspaceDocumentVersionValidate(state, {
        uri: 'file:///workspace/app.ts',
        documentVersion: 2,
      }),
    ).toThrow(
      'Document version mismatch for file:///workspace/app.ts: expected 3, received 2',
    );
  });

  it('allows missing or matching analysis generations and rejects stale generations', () => {
    const state = {
      analysisGeneration: 7,
    };

    expect(() =>
      workspaceAnalysisGenerationValidate(state, {}),
    ).not.toThrow();
    expect(() =>
      workspaceAnalysisGenerationValidate(state, {
        analysisGeneration: 7,
      }),
    ).not.toThrow();
    expect(() =>
      workspaceAnalysisGenerationValidate(state, {
        analysisGeneration: 6,
      }),
    ).toThrow('Analysis generation mismatch: expected 7, received 6');
  });
});
