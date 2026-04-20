/**
 * Unit tests for the per-export importer-count CodeLens view-model.
 *
 * Phase 5 follow-up — pins the deterministic title format (singular
 * vs plural, omit when zero), command argument shape, and tooltip
 * text. The provider's regex scanner and RPC chain are exercised
 * separately in
 * `tests/extension-vscode.export-code-lens-provider.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { exportCodeLensViewModelCreate } from '../extension-vscode/src/exportCodeLensViewModels';

describe('exportCodeLensViewModelCreate', () => {
  it('renders the singular form when there is exactly one importer', () => {
    const view = exportCodeLensViewModelCreate({
      importerCount: 1,
      declarationName: 'helper',
      declarationUri: 'file:///workspace/src/lib.ts',
      declarationLine: 0,
      declarationCharacter: 16,
    });
    expect(view).not.toBeNull();
    expect(view!.title).toBe('Codepol: 1 importer');
  });

  it('renders the plural form when there are multiple importers', () => {
    const view = exportCodeLensViewModelCreate({
      importerCount: 3,
      declarationName: 'helper',
      declarationUri: 'file:///workspace/src/lib.ts',
      declarationLine: 0,
      declarationCharacter: 16,
    });
    expect(view!.title).toBe('Codepol: 3 importers');
  });

  it('returns null when the importer count is zero so unimported exports stay quiet', () => {
    expect(
      exportCodeLensViewModelCreate({
        importerCount: 0,
        declarationName: 'unused',
        declarationUri: 'file:///workspace/src/lib.ts',
        declarationLine: 4,
        declarationCharacter: 13,
      }),
    ).toBeNull();
    expect(
      exportCodeLensViewModelCreate({
        importerCount: -1,
        declarationName: 'broken',
        declarationUri: 'file:///workspace/src/lib.ts',
        declarationLine: 4,
        declarationCharacter: 13,
      }),
    ).toBeNull();
  });

  it('emits a peek-architecture command argument anchored at the declaration position', () => {
    const view = exportCodeLensViewModelCreate({
      importerCount: 2,
      declarationName: 'Shape',
      declarationUri: 'file:///workspace/src/lib.ts',
      declarationLine: 7,
      declarationCharacter: 13,
    });
    expect(view!.line).toBe(7);
    expect(view!.character).toBe(13);
    expect(view!.commandArgument).toEqual({
      uri: 'file:///workspace/src/lib.ts',
      position: { line: 7, character: 13 },
    });
    expect(view!.tooltip).toBe('Peek Codepol architecture for Shape');
    expect(view!.importerCount).toBe(2);
  });
});
