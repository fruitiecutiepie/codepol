import { describe, expect, it } from 'vitest';
import {
  parserRuntimeStateForOwnerGet,
  parserRuntimeStateGet,
} from './parserRuntimeState';

describe('parserRuntimeStateForOwnerGet', () => {
  it('preserves registrations but invalidates live parser state when the owner changes', () => {
    const ownerA = { name: 'owner-a' };
    const ownerB = { name: 'owner-b' };

    const initial = parserRuntimeStateForOwnerGet(ownerA);
    initial.registeredLangs.set('typescript', {
      langId: 'typescript',
      wasmPath: '/tmp/tree-sitter-typescript.wasm',
      fileExtensions: ['.ts'],
    });
    initial.fileExtensionsToLangId.set('.ts', 'typescript');
    initial.parserInitialized = true;
    initial.parserInitPromise = Promise.resolve();
    initial.loadedLanguages.set('typescript', {} as never);

    const reloaded = parserRuntimeStateForOwnerGet(ownerB);

    expect(reloaded).toBe(parserRuntimeStateGet());
    expect(reloaded.registeredLangs.get('typescript')?.langId).toBe('typescript');
    expect(reloaded.fileExtensionsToLangId.get('.ts')).toBe('typescript');
    expect(reloaded.parserInitialized).toBe(false);
    expect(reloaded.parserInitPromise).toBeUndefined();
    expect(reloaded.loadedLanguages.size).toBe(0);
  });
});
