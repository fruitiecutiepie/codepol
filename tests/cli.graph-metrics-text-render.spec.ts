/**
 * Pure-function unit tests for the `codepol graph metrics --format text`
 * renderer.
 *
 * The e2e CLI spec exercises the JSON branch end-to-end; the text
 * branch needs unit-level pinning because:
 *
 * - Empty / absent sections must print `(none)` rather than disappear.
 *   CI scripts and dashboards grep for the section headers, so the
 *   rendered shape must stay stable across workspaces.
 * - `--top <n>` only affects the text branch. The JSON payload is
 *   passed through verbatim, so the text override is the only place
 *   the cap is observable.
 * - The longest-chain header carries the `length` value as the hop
 *   count. Off-by-one errors here would silently drift over time.
 *
 * The renderer is a pure function, so this spec stays free of any
 * subprocess, daemon, or vscode runtime.
 */

import { describe, expect, it } from 'vitest';
import type { WorkspaceArchitectureSummaryResult } from '@codepol/core';
import { graphMetricsTextRender } from '../apps/cli/src/graph/graphMetrics';

const richSummary: WorkspaceArchitectureSummaryResult = {
  summary: 'Indexed 4 files, 8 symbols, 1 entry points, 1 cycles.',
  indexedFileCount: 4,
  symbolCount: 8,
  scopeCount: 4,
  relationCount: 6,
  entryPointCount: 1,
  cycleCount: 1,
  hotspots: [],
  instability: [
    {
      uri: 'file:///workspace/src/entry.ts',
      workspaceRelativePath: 'src/entry.ts',
      value: 1,
      importerCount: 0,
      importeeCount: 2,
    },
    {
      uri: 'file:///workspace/src/lib/a.ts',
      workspaceRelativePath: 'src/lib/a.ts',
      value: 0.5,
      importerCount: 1,
      importeeCount: 1,
    },
  ],
  longestChain: {
    length: 3,
    uriPath: [
      'file:///workspace/src/entry.ts',
      'file:///workspace/src/lib/a.ts',
      'file:///workspace/src/lib/b.ts',
      'file:///workspace/src/lib/utils.ts',
    ],
    workspaceRelativePathPath: [
      'src/entry.ts',
      'src/lib/a.ts',
      'src/lib/b.ts',
      'src/lib/utils.ts',
    ],
  },
  sccSizeDistribution: { 2: 2, 4: 1 },
  complexityHotspots: [
    {
      uri: 'file:///workspace/src/utils.ts',
      workspaceRelativePath: 'src/utils.ts',
      aggregateCyclomaticComplexity: 14,
      importerCount: 2,
      score: 28,
    },
    {
      uri: 'file:///workspace/src/runner.ts',
      workspaceRelativePath: 'src/runner.ts',
      aggregateCyclomaticComplexity: 9,
      importerCount: 1,
      score: 9,
    },
  ],
};

const emptySummary: WorkspaceArchitectureSummaryResult = {
  summary: 'Indexed 1 files, 0 symbols, 0 entry points, 0 cycles.',
  indexedFileCount: 1,
  symbolCount: 0,
  scopeCount: 0,
  relationCount: 0,
  entryPointCount: 0,
  cycleCount: 0,
  hotspots: [],
};

describe('graphMetricsTextRender', () => {
  it('renders every section with structured rows when the summary carries Phase 8 data', () => {
    const text = graphMetricsTextRender(richSummary);
    // Header is always the first line, tab-separated for grep parity
    // with the other graph subcommands.
    const [header] = text.split('\n');
    expect(header).toBe('Indexed files: 4\tSymbols: 8\tCycles: 1');
    // Each Phase 8 section header is present.
    expect(text).toContain('Instability (top 10):');
    expect(text).toContain('Longest chain (3 hops):');
    expect(text).toContain('SCC size distribution:');
    expect(text).toContain('Complexity hotspots (top 5):');
    // Instability rows carry I=, Ce=, Ca= and the relative path.
    expect(text).toContain('I=1.00\tCe=2\tCa=0\tsrc/entry.ts');
    expect(text).toContain('I=0.50\tCe=1\tCa=1\tsrc/lib/a.ts');
    // Longest chain rows are 1-indexed.
    expect(text).toContain('1. src/entry.ts');
    expect(text).toContain('4. src/lib/utils.ts');
    // SCC distribution is sorted largest size first.
    const sccBlock = text
      .split('SCC size distribution:')[1]!
      .split('Complexity hotspots')[0]!
      .trim();
    expect(sccBlock.split('\n').map((line) => line.trim())).toEqual([
      'size=4\tcount=1',
      'size=2\tcount=2',
    ]);
    // Complexity hotspot rows include score / complexity / importers.
    expect(text).toContain(
      'score=28\tcomplexity=14\timporters=2\tsrc/utils.ts',
    );
  });

  it('emits "(none)" placeholders for every empty Phase 8 section so the rendered shape stays stable', () => {
    const text = graphMetricsTextRender(emptySummary);
    expect(text).toContain('Instability (top 10):\n  (none)');
    expect(text).toContain('Longest chain:\n  (none)');
    expect(text).toContain('SCC size distribution:\n  (none)');
    expect(text).toContain('Complexity hotspots (top 5):\n  (none)');
    // Header is still present even with no data.
    expect(text.split('\n')[0]).toBe('Indexed files: 1\tSymbols: 0\tCycles: 0');
  });

  it('honours --top to cap instability and complexity-hotspot rows in text output', () => {
    const text = graphMetricsTextRender(richSummary, 1);
    // Section headers reflect the override.
    expect(text).toContain('Instability (top 1):');
    expect(text).toContain('Complexity hotspots (top 1):');
    // Only the first instability row is rendered.
    expect(text).toContain('I=1.00');
    expect(text).not.toContain('I=0.50');
    // Only the first complexity hotspot is rendered.
    expect(text).toContain('score=28');
    expect(text).not.toContain('score=9');
  });

  it('prints the longest chain header with hop count `length` and (none) when chain is empty', () => {
    const noChain: WorkspaceArchitectureSummaryResult = {
      ...richSummary,
      longestChain: undefined,
    };
    const text = graphMetricsTextRender(noChain);
    expect(text).toContain('Longest chain:\n  (none)');
    expect(text).not.toContain('Longest chain (');
  });

  it('produces byte-identical output across runs (determinism)', () => {
    const first = graphMetricsTextRender(richSummary);
    const second = graphMetricsTextRender(richSummary);
    expect(first).toEqual(second);
  });
});
