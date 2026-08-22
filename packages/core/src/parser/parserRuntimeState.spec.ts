import { describe, expect, it } from 'vitest';
import {
  parserRuntimeStateForOwnerGet,
  parserRuntimeStateGet,
} from './parserRuntimeState';

describe('parserRuntimeStateForOwnerGet', () => {
  it('shares registrations across owners while isolating live parser state', () => {
    const ownerA = { name: 'owner-a' };
    const ownerB = { name: 'owner-b' };

    const stateA = parserRuntimeStateForOwnerGet(ownerA);
    stateA.registeredLangs.set('typescript', {
      langId: 'typescript',
      wasmPath: '/tmp/tree-sitter-typescript.wasm',
      fileExtensions: ['.ts'],
    });
    stateA.fileExtensionsToLangId.set('.ts', 'typescript');
    stateA.parserInitialized = true;
    stateA.parserInitPromise = Promise.resolve();
    stateA.loadedLanguages.set('typescript', {} as never);

    const stateB = parserRuntimeStateForOwnerGet(ownerB);

    // Each owner gets its own live parser state: one web-tree-sitter module
    // instance must never reuse another's parsers or loaded languages.
    expect(stateB).not.toBe(stateA);
    expect(stateB.parserOwner).toBe(ownerB);

    // Registrations are process-global, so a new owner still sees them.
    expect(stateB.registeredLangs.get('typescript')?.langId).toBe('typescript');
    expect(stateB.fileExtensionsToLangId.get('.ts')).toBe('typescript');
    expect(stateB.registeredLangs).toBe(stateA.registeredLangs);
    expect(stateB.fileExtensionsToLangId).toBe(stateA.fileExtensionsToLangId);
    expect(parserRuntimeStateGet().registeredLangs).toBe(stateA.registeredLangs);

    // A fresh owner starts uninitialized...
    expect(stateB.parserInitialized).toBe(false);
    expect(stateB.parserInitPromise).toBeUndefined();
    expect(stateB.loadedLanguages.size).toBe(0);

    // ...without invalidating the owner that was already initialized.
    expect(stateA.parserInitialized).toBe(true);
    expect(stateA.loadedLanguages.size).toBe(1);
  });

  it('returns a stable state object per owner', () => {
    const owner = { name: 'owner-stable' };

    const first = parserRuntimeStateForOwnerGet(owner);
    first.parserInitialized = true;

    expect(parserRuntimeStateForOwnerGet(owner)).toBe(first);
    expect(parserRuntimeStateForOwnerGet(owner).parserInitialized).toBe(true);
  });
});
