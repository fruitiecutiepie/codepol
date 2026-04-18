import { describe, expect, it } from 'vitest';
import type { PolicyFile, WorkspaceDiagnostic } from '@codepol/core';
import {
  workspaceAnalysisRebuildFromCache,
  workspaceAnalyzerCacheRestoreFromSnapshot,
  workspaceAnalyzerCacheSerialize,
  workspaceWarmCacheFileDeltaCompute,
  type WorkspaceAnalyzerCache,
} from './index.js';
import type {
  WorkspaceWarmCacheAnalyzerEntry,
  WorkspaceWarmCacheFileFingerprint,
} from './warmCache.js';

function fingerprintCreate(
  filePath: string,
  size: number,
  mtimeMs: number,
): WorkspaceWarmCacheFileFingerprint {
  return { path: filePath, size, mtimeMs };
}

function diagnosticCreate(
  filePath: string,
  id: string,
  message: string,
): WorkspaceDiagnostic {
  return {
    id,
    uri: `file://${filePath}`,
    source: 'codepol',
    code: 'rule.x',
    severity: 'error',
    message,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
  };
}

function analyzerEntryCreate(input: {
  analyzer: 'tree' | 'eslint' | 'biome' | 'ruff';
  files: Array<{
    filePath: string;
    contentFingerprint?: string;
    configFingerprint?: string;
    pluginFingerprint?: string;
    toolFingerprintKey?: string;
    treeIndexFingerprint?: string;
    diagnosticMessage?: string;
  }>;
}): WorkspaceWarmCacheAnalyzerEntry {
  return {
    analyzer: input.analyzer,
    scorecardTemplate: {
      analyzerId: `analyzer/${input.analyzer}`,
      platform: input.analyzer === 'tree' ? 'codepol_tree' : (input.analyzer as 'eslint'),
      languages: ['typescript'],
      ownedRuleIds: ['rule.x'],
      skippedRuleIds: [],
      diagnosticCount: 0,
      violationCount: 0,
      issueCount: 0,
      fileCount: 0,
      fixMode: input.analyzer === 'tree' ? 'inline' : 'external',
      status: 'ran',
      latencyMs: 0,
      issues: [],
    },
    fileResults: input.files.map((file) => ({
      filePath: file.filePath,
      key: {
        contentFingerprint: file.contentFingerprint ?? 'disk:1:1:hash',
        configFingerprint: file.configFingerprint ?? 'cfg-1',
        pluginFingerprint: file.pluginFingerprint ?? 'plugin-1',
        toolFingerprintKey: file.toolFingerprintKey ?? 'tool-1',
        treeIndexFingerprint: file.treeIndexFingerprint ?? '',
      },
      violations: [],
      diagnostics: [
        diagnosticCreate(file.filePath, `${input.analyzer}-${file.filePath}-d1`, file.diagnosticMessage ?? 'msg'),
      ],
      treeViolations: [],
      fixableTreeViolationDiagnosticIds: [],
    })),
  };
}

describe('workspaceWarmCacheFileDeltaCompute', () => {
  it('classifies files as unchanged, changed, added, or removed', () => {
    const delta = workspaceWarmCacheFileDeltaCompute({
      snapshotFiles: ['/a.ts', '/b.ts', '/c.ts'],
      snapshotFileFingerprints: [
        fingerprintCreate('/a.ts', 10, 100),
        fingerprintCreate('/b.ts', 20, 200),
        fingerprintCreate('/c.ts', 30, 300),
      ],
      currentFiles: ['/a.ts', '/b.ts', '/d.ts'],
      currentFileFingerprints: [
        fingerprintCreate('/a.ts', 10, 100),
        fingerprintCreate('/b.ts', 20, 250),
        fingerprintCreate('/d.ts', 40, 400),
      ],
    });

    expect(delta.unchangedFiles).toEqual(['/a.ts']);
    expect(delta.changedFiles).toEqual(['/b.ts']);
    expect(delta.addedFiles).toEqual(['/d.ts']);
    expect(delta.removedFiles).toEqual(['/c.ts']);
  });

  it('treats divergent size with identical mtime as changed', () => {
    const delta = workspaceWarmCacheFileDeltaCompute({
      snapshotFiles: ['/a.ts'],
      snapshotFileFingerprints: [fingerprintCreate('/a.ts', 10, 100)],
      currentFiles: ['/a.ts'],
      currentFileFingerprints: [fingerprintCreate('/a.ts', 11, 100)],
    });
    expect(delta.changedFiles).toEqual(['/a.ts']);
    expect(delta.unchangedFiles).toEqual([]);
  });

  it('returns empty deltas when both inputs are empty', () => {
    expect(
      workspaceWarmCacheFileDeltaCompute({
        snapshotFiles: [],
        snapshotFileFingerprints: [],
        currentFiles: [],
        currentFileFingerprints: [],
      }),
    ).toEqual({
      unchangedFiles: [],
      changedFiles: [],
      addedFiles: [],
      removedFiles: [],
    });
  });

  it('treats a missing current fingerprint for a known path as changed', () => {
    const delta = workspaceWarmCacheFileDeltaCompute({
      snapshotFiles: ['/a.ts'],
      snapshotFileFingerprints: [fingerprintCreate('/a.ts', 10, 100)],
      currentFiles: ['/a.ts'],
      currentFileFingerprints: [],
    });
    expect(delta.unchangedFiles).toEqual([]);
    expect(delta.changedFiles).toEqual(['/a.ts']);
  });
});

describe('workspaceAnalyzerCacheRestoreFromSnapshot', () => {
  it('keeps entries for unchanged files whose key tuple matches every current invariant', () => {
    const snapshotEntries = [
      analyzerEntryCreate({
        analyzer: 'eslint',
        files: [{ filePath: '/a.ts' }, { filePath: '/b.ts' }],
      }),
    ];
    const restored = workspaceAnalyzerCacheRestoreFromSnapshot({
      snapshotEntries,
      unchangedFiles: new Set(['/a.ts']),
      currentConfigFingerprint: 'cfg-1',
      currentPluginFingerprint: 'plugin-1',
      currentToolFingerprintKey: 'tool-1',
      currentTreeIndexFingerprint: 'tree-1',
    });
    expect(restored.eslint?.fileResults.size).toBe(1);
    expect(restored.eslint?.fileResults.has('/a.ts')).toBe(true);
    expect(restored.eslint?.fileResults.has('/b.ts')).toBe(false);
  });

  it('drops every entry when the configFingerprint diverges', () => {
    const restored = workspaceAnalyzerCacheRestoreFromSnapshot({
      snapshotEntries: [
        analyzerEntryCreate({ analyzer: 'eslint', files: [{ filePath: '/a.ts' }] }),
      ],
      unchangedFiles: new Set(['/a.ts']),
      currentConfigFingerprint: 'cfg-DIFFERENT',
      currentPluginFingerprint: 'plugin-1',
      currentToolFingerprintKey: 'tool-1',
      currentTreeIndexFingerprint: 'tree-1',
    });
    expect(restored.eslint?.fileResults.size).toBe(0);
  });

  it('drops every entry when the pluginFingerprint diverges', () => {
    const restored = workspaceAnalyzerCacheRestoreFromSnapshot({
      snapshotEntries: [
        analyzerEntryCreate({ analyzer: 'eslint', files: [{ filePath: '/a.ts' }] }),
      ],
      unchangedFiles: new Set(['/a.ts']),
      currentConfigFingerprint: 'cfg-1',
      currentPluginFingerprint: 'plugin-DIFFERENT',
      currentToolFingerprintKey: 'tool-1',
      currentTreeIndexFingerprint: 'tree-1',
    });
    expect(restored.eslint?.fileResults.size).toBe(0);
  });

  it('drops every entry when the toolFingerprintKey diverges', () => {
    const restored = workspaceAnalyzerCacheRestoreFromSnapshot({
      snapshotEntries: [
        analyzerEntryCreate({ analyzer: 'eslint', files: [{ filePath: '/a.ts' }] }),
      ],
      unchangedFiles: new Set(['/a.ts']),
      currentConfigFingerprint: 'cfg-1',
      currentPluginFingerprint: 'plugin-1',
      currentToolFingerprintKey: 'tool-DIFFERENT',
      currentTreeIndexFingerprint: 'tree-1',
    });
    expect(restored.eslint?.fileResults.size).toBe(0);
  });

  it('drops tree entries when treeIndexFingerprint diverges but keeps non-tree entries', () => {
    const snapshotEntries = [
      analyzerEntryCreate({
        analyzer: 'tree',
        files: [{ filePath: '/a.ts', treeIndexFingerprint: 'tree-OLD' }],
      }),
      analyzerEntryCreate({
        analyzer: 'eslint',
        files: [{ filePath: '/a.ts', treeIndexFingerprint: '' }],
      }),
    ];
    const restored = workspaceAnalyzerCacheRestoreFromSnapshot({
      snapshotEntries,
      unchangedFiles: new Set(['/a.ts']),
      currentConfigFingerprint: 'cfg-1',
      currentPluginFingerprint: 'plugin-1',
      currentToolFingerprintKey: 'tool-1',
      currentTreeIndexFingerprint: 'tree-NEW',
    });
    expect(restored.tree?.fileResults.size).toBe(0);
    expect(restored.eslint?.fileResults.size).toBe(1);
  });

  it('returns an empty cache when snapshotEntries is undefined', () => {
    expect(
      workspaceAnalyzerCacheRestoreFromSnapshot({
        snapshotEntries: undefined,
        unchangedFiles: new Set(['/a.ts']),
        currentConfigFingerprint: 'cfg-1',
        currentPluginFingerprint: 'plugin-1',
        currentToolFingerprintKey: 'tool-1',
        currentTreeIndexFingerprint: 'tree-1',
      }),
    ).toEqual({});
  });
});

describe('workspaceAnalyzerCacheSerialize / round-trip', () => {
  it('produces stable, deterministic ordering across persist+restore', () => {
    const snapshotEntries = [
      analyzerEntryCreate({
        analyzer: 'eslint',
        files: [{ filePath: '/b.ts' }, { filePath: '/a.ts' }],
      }),
    ];
    const restored = workspaceAnalyzerCacheRestoreFromSnapshot({
      snapshotEntries,
      unchangedFiles: new Set(['/a.ts', '/b.ts']),
      currentConfigFingerprint: 'cfg-1',
      currentPluginFingerprint: 'plugin-1',
      currentToolFingerprintKey: 'tool-1',
      currentTreeIndexFingerprint: 'tree-1',
    });
    const reserialized = workspaceAnalyzerCacheSerialize(restored);
    const onceMore = workspaceAnalyzerCacheSerialize(
      workspaceAnalyzerCacheRestoreFromSnapshot({
        snapshotEntries: reserialized,
        unchangedFiles: new Set(['/a.ts', '/b.ts']),
        currentConfigFingerprint: 'cfg-1',
        currentPluginFingerprint: 'plugin-1',
        currentToolFingerprintKey: 'tool-1',
        currentTreeIndexFingerprint: 'tree-1',
      }),
    );
    expect(JSON.stringify(reserialized)).toBe(JSON.stringify(onceMore));
    expect(reserialized[0]?.fileResults.map((entry) => entry.filePath)).toEqual([
      '/a.ts',
      '/b.ts',
    ]);
  });
});

describe('workspaceAnalysisRebuildFromCache', () => {
  it('flattens cache slices into the recomposed analysis but skips files absent from the cache', () => {
    const cache: WorkspaceAnalyzerCache = {};
    const tree = analyzerEntryCreate({
      analyzer: 'tree',
      files: [{ filePath: '/a.ts', diagnosticMessage: 'tree-a' }],
    });
    const eslint = analyzerEntryCreate({
      analyzer: 'eslint',
      files: [
        { filePath: '/a.ts', diagnosticMessage: 'eslint-a' },
        { filePath: '/b.ts', diagnosticMessage: 'eslint-b' },
      ],
    });
    const restored = workspaceAnalyzerCacheRestoreFromSnapshot({
      snapshotEntries: [tree, eslint],
      unchangedFiles: new Set(['/a.ts', '/b.ts']),
      currentConfigFingerprint: 'cfg-1',
      currentPluginFingerprint: 'plugin-1',
      currentToolFingerprintKey: 'tool-1',
      currentTreeIndexFingerprint: '',
    });
    Object.assign(cache, restored);

    const policy: PolicyFile = { rules: [], plugins: [] } as unknown as PolicyFile;
    const analysis = workspaceAnalysisRebuildFromCache({
      policy,
      files: ['/a.ts', '/b.ts'],
      cache,
      scorecardTemplates: {},
      analyzerInventory: [],
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: { readiness: 'ready' },
        workspaceSymbols: { readiness: 'ready' },
        semanticSearch: { readiness: 'ready' },
        dependencyGraph: { readiness: 'ready' },
        architectureSummary: { readiness: 'ready' },
      },
    });

    expect(analysis.diagnostics.map((diagnostic) => diagnostic.message).sort()).toEqual([
      'eslint-a',
      'eslint-b',
      'tree-a',
    ]);
    expect(analysis.files).toEqual(['/a.ts', '/b.ts']);
    expect(analysis.analyzerScorecard).toHaveLength(4);
  });

  it('contributes nothing for analyzers with no cache entries', () => {
    const policy: PolicyFile = { rules: [], plugins: [] } as unknown as PolicyFile;
    const analysis = workspaceAnalysisRebuildFromCache({
      policy,
      files: [],
      cache: {},
      scorecardTemplates: {},
      analyzerInventory: [],
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: { readiness: 'ready' },
        workspaceSymbols: { readiness: 'ready' },
        semanticSearch: { readiness: 'ready' },
        dependencyGraph: { readiness: 'ready' },
        architectureSummary: { readiness: 'ready' },
      },
    });
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.violations).toEqual([]);
    expect(analysis.analyzerScorecard.every((entry) => entry.diagnosticCount === 0)).toBe(true);
  });
});
