/**
 * Python type-relations extraction tests.
 *
 * Mirrors the TypeScript matrix in
 * `tests/index.type-relations.spec.ts` for Python's positional
 * single-paren inheritance syntax. Pins the MVP scope decision:
 * bare-identifier superclasses are captured as `extends` relations;
 * `Generic[T]`, `module.Type`, and `metaclass=Meta` are silently
 * skipped because the structural extractor cannot resolve them
 * without type-system support.
 *
 * Cross-file resolution is exercised through `from .X import Y` so
 * any future regression in `crossFileResolve` (which is
 * language-agnostic) is caught here as well as in the TS suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type TypeRelation,
} from '@codepol/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let testDir: string;

beforeAll(async () => {
  langAdd({ langId: 'python', fileExtensions: ['.py'] });
  await parserInit();
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-py-typerel-'));
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function fileWrite(name: string, content: string): string {
  const file = path.join(testDir, name);
  fs.writeFileSync(file, content);
  return file;
}

describe('python type relations', () => {
  it('should detect single-parent class inheritance and resolve target locally', () => {
    const file = fileWrite('single_parent.py', `
class Animal:
    pass

class Dog(Animal):
    pass
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const dogSymbols = index.symbolsGetByName('Dog');
    expect(dogSymbols).toHaveLength(1);
    const rels = index.typeRelationsGet(dogSymbols[0].id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('Animal');
    // Python doesn't have separate 'implements' syntax — every parent
    // becomes an `extends` relation.
    expect(rels[0].relationKind).toBe('extends');

    const animalSymbols = index.symbolsGetByName('Animal');
    expect(animalSymbols).toHaveLength(1);
    expect(rels[0].resolvedTargetId).toBe(animalSymbols[0].id);
  });

  it('emits one extends relation per bare identifier when the class has multiple parents', () => {
    const file = fileWrite('multi_parent.py', `
class Animal:
    pass

class Trainable:
    pass

class Dog(Animal, Trainable):
    pass
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const dogSymbols = index.symbolsGetByName('Dog');
    const rels = index.typeRelationsGet(dogSymbols[0].id);
    expect(rels).toHaveLength(2);
    expect(rels.every((r: TypeRelation) => r.relationKind === 'extends')).toBe(true);

    const targetNames = rels.map((r) => r.targetName).sort();
    expect(targetNames).toEqual(['Animal', 'Trainable']);

    const animalId = index.symbolsGetByName('Animal')[0].id;
    const trainableId = index.symbolsGetByName('Trainable')[0].id;
    const resolvedIds = rels.map((r) => r.resolvedTargetId).sort();
    expect(resolvedIds).toEqual([animalId, trainableId].sort());
  });

  it('emits no relations for classes with no superclass list', () => {
    const file = fileWrite('no_parent.py', `
class Foo:
    pass

class Bar:
    x = 1
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const fooId = index.symbolsGetByName('Foo')[0].id;
    const barId = index.symbolsGetByName('Bar')[0].id;
    expect(index.typeRelationsGet(fooId)).toEqual([]);
    expect(index.typeRelationsGet(barId)).toEqual([]);
  });

  it('skips Generic[T] superclasses (subscript node, out of MVP scope)', () => {
    // The query captures bare identifiers under `(argument_list ...)`.
    // `Generic[T]` parses as a `subscript`, not a bare identifier, so
    // it produces no `typerel.extends_target` capture.
    const file = fileWrite('generic_parent.py', `
class Generic:
    pass

class Container(Generic[int]):
    pass
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const containerSymbols = index.symbolsGetByName('Container');
    expect(containerSymbols).toHaveLength(1);
    expect(index.typeRelationsGet(containerSymbols[0].id)).toEqual([]);
  });

  it('skips module-qualified parents (attribute node, out of MVP scope)', () => {
    // `typing.Protocol` parses as `(attribute object: identifier
    // attribute: identifier)`, not a bare identifier. The MVP query
    // skips it; resolving namespace-qualified parents is a follow-up
    // that needs cross-file member resolution.
    const file = fileWrite('attribute_parent.py', `
import typing

class MyProtocol(typing.Protocol):
    def do(self) -> None: ...
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const protoSymbols = index.symbolsGetByName('MyProtocol');
    expect(protoSymbols).toHaveLength(1);
    expect(index.typeRelationsGet(protoSymbols[0].id)).toEqual([]);
  });

  it('returns subtypes via subTypesGet for a parent class', () => {
    const file = fileWrite('subtypes_lookup.py', `
class Animal:
    pass

class Dog(Animal):
    pass

class Cat(Animal):
    pass
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const animalId = index.symbolsGetByName('Animal')[0].id;
    const subtypes = index.subTypesGet(animalId);
    expect(subtypes).toHaveLength(2);
    const subtypeNames = subtypes
      .map((rel) => index.symbolGet(rel.symbolId)?.name)
      .filter((name): name is string => name !== undefined)
      .sort();
    expect(subtypeNames).toEqual(['Cat', 'Dog']);
  });

  it('resolves cross-file extends through a from-import', () => {
    const fileBase = fileWrite('xfile_animal.py', `
class Animal:
    def speak(self) -> str:
        return ''
`);
    const fileDerived = fileWrite('xfile_dog.py', `
from .xfile_animal import Animal

class Dog(Animal):
    def bark(self) -> str:
        return 'woof'
`);
    const { index } = projectIndexBuildSync({
      files: [fileBase, fileDerived],
      dir: testDir,
    });

    const dogSymbols = index.symbolsGetByName('Dog');
    expect(dogSymbols).toHaveLength(1);
    const rels = index.typeRelationsGet(dogSymbols[0].id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('Animal');
    expect(rels[0].relationKind).toBe('extends');
    expect(rels[0].resolvedTargetId).toBeDefined();

    // Should resolve to the actual Animal in `xfile_animal.py`, not
    // the local import-binding symbol in `xfile_dog.py`.
    const exportedAnimal = index
      .symbolsGetByName('Animal')
      .find((s) => s.file === fileBase);
    expect(exportedAnimal).toBeDefined();
    expect(rels[0].resolvedTargetId).toBe(exportedAnimal!.id);
  });

  it('produces deterministic relations across re-runs', () => {
    const file = fileWrite('determinism.py', `
class A:
    pass

class B:
    pass

class C(A, B):
    pass

class D(B, A):
    pass
`);
    const first = projectIndexBuildSync({ files: [file], dir: testDir });
    const cId = first.index.symbolsGetByName('C')[0].id;
    const dId = first.index.symbolsGetByName('D')[0].id;
    const firstSnapshot = [
      ...first.index.typeRelationsGet(cId),
      ...first.index.typeRelationsGet(dId),
    ].map((r) => ({
      symbolId: r.symbolId,
      targetName: r.targetName,
      relationKind: r.relationKind,
    }));

    const second = projectIndexBuildSync({ files: [file], dir: testDir });
    const cIdSecond = second.index.symbolsGetByName('C')[0].id;
    const dIdSecond = second.index.symbolsGetByName('D')[0].id;
    const secondSnapshot = [
      ...second.index.typeRelationsGet(cIdSecond),
      ...second.index.typeRelationsGet(dIdSecond),
    ].map((r) => ({
      symbolId: r.symbolId,
      targetName: r.targetName,
      relationKind: r.relationKind,
    }));

    expect(secondSnapshot).toEqual(firstSnapshot);
  });
});
