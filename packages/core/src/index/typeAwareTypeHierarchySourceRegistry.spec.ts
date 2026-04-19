/**
 * Phase 9.5 / Gap 3: registry round-trips for
 * {@link TypeAwareTypeHierarchySourceRegistry}.
 *
 * Mirrors the call-graph registry spec — same shape contract,
 * different language-server feature.
 */
import { describe, expect, it } from 'vitest';
import { typeAwareTypeHierarchySourceRegistryCreate } from './typeAwareTypeHierarchySourceRegistry';
import type { TypeAwareTypeHierarchySource } from './typeAwareTypeHierarchySource';

function fakeSourceCreate(label: string): TypeAwareTypeHierarchySource {
  return {
    typeAwareImplementersGet: async () => [
      {
        subtypeSymbolId: `subtype-${label}`,
        supertypeSymbolId: 'supertype',
        relationKind: 'implements' as const,
      },
    ],
    typeAwareSupertypesGet: async () => [],
  };
}

describe('typeAwareTypeHierarchySourceRegistry', () => {
  it('returns undefined for unregistered languages', () => {
    const registry = typeAwareTypeHierarchySourceRegistryCreate();
    expect(registry.typeAwareTypeHierarchySourceGet('typescript')).toBeUndefined();
  });

  it('round-trips a registered source by language id', () => {
    const registry = typeAwareTypeHierarchySourceRegistryCreate();
    const source = fakeSourceCreate('ts');
    registry.typeAwareTypeHierarchySourceRegister('typescript', source);
    expect(registry.typeAwareTypeHierarchySourceGet('typescript')).toBe(source);
  });

  it('overwrites the source when re-registered for the same language (last write wins)', () => {
    const registry = typeAwareTypeHierarchySourceRegistryCreate();
    const first = fakeSourceCreate('first');
    const second = fakeSourceCreate('second');
    registry.typeAwareTypeHierarchySourceRegister('typescript', first);
    registry.typeAwareTypeHierarchySourceRegister('typescript', second);
    expect(registry.typeAwareTypeHierarchySourceGet('typescript')).toBe(second);
  });

  it('isolates registrations across languages', () => {
    const registry = typeAwareTypeHierarchySourceRegistryCreate();
    const tsSource = fakeSourceCreate('ts');
    const pySource = fakeSourceCreate('py');
    registry.typeAwareTypeHierarchySourceRegister('typescript', tsSource);
    registry.typeAwareTypeHierarchySourceRegister('python', pySource);
    expect(registry.typeAwareTypeHierarchySourceGet('typescript')).toBe(tsSource);
    expect(registry.typeAwareTypeHierarchySourceGet('python')).toBe(pySource);
    expect(registry.typeAwareTypeHierarchySourceGet('rust')).toBeUndefined();
  });
});
