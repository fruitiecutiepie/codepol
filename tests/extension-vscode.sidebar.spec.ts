import { describe, expect, it } from 'vitest';
import type {
  IndexStatusResult,
  WorkspaceSearchResult,
  WorkspaceSemanticHoverResult,
} from '@codepol/core';
import {
  sidebarActiveTargetCreate,
  sidebarIndexStatusCreate,
  sidebarRecentTargetCreate,
  sidebarRecentTargetsNext,
  sidebarSearchResultsCreate,
} from '../extension-vscode/src/sidebarModels';

const exportedSymbolResult: WorkspaceSearchResult = {
  name: 'sharedValue',
  kind: 'exported_symbol',
  location: {
    uri: 'file:///workspace/packages/lib/src/index.ts',
    range: {
      start: { line: 1, character: 13 },
      end: { line: 1, character: 24 },
    },
  },
  detail: 'packages/lib/src/index.ts • const',
  source: 'codepol',
  semanticClass: 'exported_symbol',
  score: 183.2,
};

const semanticHover: WorkspaceSemanticHoverResult = {
  target: {
    uri: 'file:///workspace/packages/lib/src/index.ts',
    semanticClass: 'architecture_node',
  },
  title: 'sharedValue',
  subtitle: 'packages/lib/src/index.ts',
  summary: 'Shared value consumed by the web app.',
  statusText: 'Architecture node is indexed.',
  fields: [
    {
      label: 'Semantic class',
      value: 'exported_symbol',
    },
  ],
  actions: ['go_to_definition', 'find_references'],
  source: 'codepol',
  semanticClass: 'architecture_node',
};

describe('extension-vscode sidebar models', () => {
  it('formats sidebar search results with score and semantic detail', () => {
    expect(sidebarSearchResultsCreate([exportedSymbolResult], 'shared')).toEqual([
      {
        uri: 'file:///workspace/packages/lib/src/index.ts',
        line: 1,
        character: 13,
        title: 'sharedValue',
        subtitle: 'exported symbol',
        detail: 'packages/lib/src/index.ts • const • line 2',
        scoreLabel: 'score 183',
      },
    ]);
  });

  it('builds a semantic active-target card from hover data', () => {
    expect(
      sidebarActiveTargetCreate({
        activeUri: 'file:///workspace/packages/lib/src/index.ts',
        hover: semanticHover,
      }),
    ).toEqual({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      title: 'sharedValue',
      subtitle: 'packages/lib/src/index.ts',
      summary: 'Shared value consumed by the web app.',
      statusText: 'Architecture node is indexed.',
      fields: [
        {
          label: 'Semantic class',
          value: 'exported_symbol',
        },
      ],
      actions: [
        {
          action: 'go_to_definition',
          label: 'Go To Definition',
        },
        {
          action: 'find_references',
          label: 'Show Architecture Links',
        },
      ],
      tone: 'neutral',
    });
  });

  it('maps index status into sidebar metrics and feature pills', () => {
    const status: IndexStatusResult = {
      workspaceId: 'workspace-1',
      workspaceInstanceId: 'instance-1',
      status: 'warming',
      replayState: 'pending',
      workspaceReady: false,
      indexedFileCount: 42,
      openDocumentCount: 3,
      overlayCount: 1,
      analysisGeneration: 9,
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'warming', detail: 'Preparing rename previews.' },
        workspaceIndex: { readiness: 'warming', detail: 'Scanning manifests.' },
        workspaceSymbols: { readiness: 'ready' },
        semanticSearch: { readiness: 'warming', detail: 'Ranking exported symbols.' },
        dependencyGraph: { readiness: 'ready' },
        architectureSummary: {
          readiness: 'degraded',
          detail: 'Graph view is waiting on a stale cache.',
        },
      },
      lastError: 'One background worker restarted.',
    };

    expect(sidebarIndexStatusCreate({ status })).toEqual({
      headline: 'Warming',
      detail: '42 indexed files • workspace not ready • replay pending',
      tone: 'warning',
      metrics: [
        { label: 'Indexed files', value: '42' },
        { label: 'Open documents', value: '3' },
        { label: 'Overlays', value: '1' },
        { label: 'Analysis generation', value: '9' },
      ],
      features: [
        {
          label: 'Workspace Index',
          readiness: 'Warming',
          detail: 'Scanning manifests.',
          tone: 'warning',
        },
        {
          label: 'Semantic Search',
          readiness: 'Warming',
          detail: 'Ranking exported symbols.',
          tone: 'warning',
        },
        {
          label: 'Architecture Summary',
          readiness: 'Degraded',
          detail: 'Graph view is waiting on a stale cache.',
          tone: 'error',
        },
        {
          label: 'Edit Plans',
          readiness: 'Warming',
          detail: 'Preparing rename previews.',
          tone: 'warning',
        },
      ],
      lastError: 'One background worker restarted.',
    });
  });

  it('deduplicates and caps recent semantic targets', () => {
    const first = sidebarRecentTargetCreate({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      line: 1,
      character: 13,
      sourceLabel: 'Search',
      fallbackTitle: 'sharedValue',
    });
    const second = sidebarRecentTargetCreate({
      uri: 'file:///workspace/apps/web/src/app.ts',
      line: 0,
      character: 0,
      sourceLabel: 'Opened',
      fallbackTitle: 'app.ts',
    });

    const recent = sidebarRecentTargetsNext(
      [second, first],
      sidebarRecentTargetCreate({
        uri: 'file:///workspace/packages/lib/src/index.ts',
        line: 4,
        character: 2,
        sourceLabel: 'Active file',
        hover: semanticHover,
      }),
      2,
    );

    expect(recent).toEqual([
      {
        uri: 'file:///workspace/packages/lib/src/index.ts',
        line: 4,
        character: 2,
        title: 'sharedValue',
        subtitle: 'packages/lib/src/index.ts',
        detail: 'Shared value consumed by the web app.',
        sourceLabel: 'Active file',
      },
      second,
    ]);
  });
});
