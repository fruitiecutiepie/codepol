/**
 * Shared test helpers for building IndexStore and ProjectIndex test data.
 *
 * These helpers create valid SymbolRecord, ScopeRecord, and FileIndexDelta
 * objects without depending on tree-sitter. Used by indexStore.spec.ts and
 * indexQuery.spec.ts to avoid duplicating construction logic.
 *
 * NOT exported from the package — only used by co-located specs.
 */

import type {
  ByteRange,
  SymbolRecord,
  ScopeRecord,
} from './indexTypes';
import { SymbolFlags } from './indexTypes';
import type { FileIndexDelta } from './indexStore';

// ============================================================================
// Primitives
// ============================================================================

/** Create a ByteRange from start/end offsets. */
export function byteRangeGet(start: number, end: number): ByteRange {
  return { start, end };
}

// ============================================================================
// Record builders
// ============================================================================

/**
 * Create a ScopeRecord with sensible defaults.
 * @param scopeRange - Optional range; defaults to `range(0, 100)`.
 */
export function scopeRecordNew(
  id: string,
  file: string,
  kind: ScopeRecord['kind'] = 'file',
  parent?: string,
  scopeRange?: ByteRange,
): ScopeRecord {
  return { id, kind, file, byteRange: scopeRange ?? byteRangeGet(0, 100), parent };
}

/**
 * Create a SymbolRecord with sensible defaults.
 * @param symbolRange - Optional range; defaults to `range(0, 50)`.
 */
export function symbolRecordNew(
  id: string,
  name: string,
  file: string,
  scopeId: string,
  kind: SymbolRecord['kind'] = 'function',
  flags: number = SymbolFlags.None,
  symbolRange?: ByteRange,
): SymbolRecord {
  return {
    id,
    kind,
    name,
    file,
    byteRange: symbolRange ?? byteRangeGet(0, 50),
    scopeId,
    qualName: name,
    flags,
  };
}

// ============================================================================
// Delta builder
// ============================================================================

/**
 * Create a FileIndexDelta with defaults for all optional fields.
 * Only `file` is required; everything else defaults to empty arrays.
 */
export function fileIndexDeltaNew(
  overrides: Partial<FileIndexDelta> & { file: string },
): FileIndexDelta {
  return {
    revision: 'rev1',
    symbols: [],
    scopes: [],
    relations: [],
    ...overrides,
  };
}
