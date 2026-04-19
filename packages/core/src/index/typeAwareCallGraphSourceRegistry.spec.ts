/**
 * Phase 9.2 / Gap 1: registry round-trips for
 * {@link TypeAwareCallGraphSourceRegistry}.
 *
 * One job: pin the trivial put/get/overwrite/per-language-isolation
 * contract so callers can rely on last-write-wins semantics and on
 * registrations not bleeding across languages.
 */
import { describe, expect, it } from 'vitest';
import { typeAwareCallGraphSourceRegistryCreate } from './typeAwareCallGraphSourceRegistry';
import type { TypeAwareCallGraphSource } from './typeAwareCallGraphSource';

function fakeSourceCreate(label: string): TypeAwareCallGraphSource {
  return {
    typeAwareCallersGet: async () => [
      { callerSymbolId: `caller-${label}`, calleeSymbolId: 'callee', callKind: 'direct' },
    ],
    typeAwareCalleesGet: async () => [],
  };
}

describe('typeAwareCallGraphSourceRegistry', () => {
  it('returns undefined for unregistered languages', () => {
    const registry = typeAwareCallGraphSourceRegistryCreate();
    expect(registry.typeAwareCallGraphSourceGet('typescript')).toBeUndefined();
  });

  it('round-trips a registered source by language id', () => {
    const registry = typeAwareCallGraphSourceRegistryCreate();
    const source = fakeSourceCreate('ts');
    registry.typeAwareCallGraphSourceRegister('typescript', source);
    expect(registry.typeAwareCallGraphSourceGet('typescript')).toBe(source);
  });

  it('overwrites the source when re-registered for the same language (last write wins)', () => {
    const registry = typeAwareCallGraphSourceRegistryCreate();
    const first = fakeSourceCreate('first');
    const second = fakeSourceCreate('second');
    registry.typeAwareCallGraphSourceRegister('typescript', first);
    registry.typeAwareCallGraphSourceRegister('typescript', second);
    expect(registry.typeAwareCallGraphSourceGet('typescript')).toBe(second);
  });

  it('isolates registrations across languages', () => {
    const registry = typeAwareCallGraphSourceRegistryCreate();
    const tsSource = fakeSourceCreate('ts');
    const pySource = fakeSourceCreate('py');
    registry.typeAwareCallGraphSourceRegister('typescript', tsSource);
    registry.typeAwareCallGraphSourceRegister('python', pySource);
    expect(registry.typeAwareCallGraphSourceGet('typescript')).toBe(tsSource);
    expect(registry.typeAwareCallGraphSourceGet('python')).toBe(pySource);
    expect(registry.typeAwareCallGraphSourceGet('rust')).toBeUndefined();
  });
});
