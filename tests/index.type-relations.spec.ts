import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type TypeRelation,
} from '@codepol/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('type relations', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-typerel-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Class extends class (same file)
  // ==========================================================================

  it('should detect class extends class in the same file', () => {
    const file = path.join(testDir, 'class_extends.ts');
    fs.writeFileSync(file, `
class Animal {
  name: string = '';
}

class Dog extends Animal {
  breed: string = '';
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const dogSymbols = index.symbolsGetByName('Dog');
    expect(dogSymbols).toHaveLength(1);
    const dog = dogSymbols[0];

    const rels = index.typeRelationsGet(dog.id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('Animal');
    expect(rels[0].relationKind).toBe('extends');
    expect(rels[0].resolvedTargetId).toBeDefined();

    // Verify the resolved target is the Animal symbol
    const animalSymbols = index.symbolsGetByName('Animal');
    expect(animalSymbols).toHaveLength(1);
    expect(rels[0].resolvedTargetId).toBe(animalSymbols[0].id);
  });

  // ==========================================================================
  // Class implements interface (same file)
  // ==========================================================================

  it('should detect class implements interface in the same file', () => {
    const file = path.join(testDir, 'class_implements.ts');
    fs.writeFileSync(file, `
interface IMovable {
  speed: number;
}

class Car implements IMovable {
  speed: number = 0;
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const carSymbols = index.symbolsGetByName('Car');
    expect(carSymbols).toHaveLength(1);
    const car = carSymbols[0];

    const rels = index.typeRelationsGet(car.id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('IMovable');
    expect(rels[0].relationKind).toBe('implements');
    expect(rels[0].resolvedTargetId).toBeDefined();

    const ifaceSymbols = index.symbolsGetByName('IMovable');
    expect(ifaceSymbols).toHaveLength(1);
    expect(rels[0].resolvedTargetId).toBe(ifaceSymbols[0].id);
  });

  // ==========================================================================
  // Class implements multiple interfaces
  // ==========================================================================

  it('should detect class implementing multiple interfaces', () => {
    const file = path.join(testDir, 'multi_implements.ts');
    fs.writeFileSync(file, `
interface ISerializable {
  serialize(): string;
}

interface ICloneable {
  clone(): unknown;
}

class Document implements ISerializable, ICloneable {
  serialize() { return ''; }
  clone() { return {}; }
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const docSymbols = index.symbolsGetByName('Document');
    expect(docSymbols).toHaveLength(1);
    const doc = docSymbols[0];

    const rels = index.typeRelationsGet(doc.id);
    expect(rels).toHaveLength(2);
    expect(rels.every(r => r.relationKind === 'implements')).toBe(true);
    const targetNames = rels.map(r => r.targetName).sort();
    expect(targetNames).toEqual(['ICloneable', 'ISerializable']);
  });

  // ==========================================================================
  // Interface extends interface
  // ==========================================================================

  it('should detect interface extends interface', () => {
    const file = path.join(testDir, 'interface_extends.ts');
    fs.writeFileSync(file, `
interface IAnimal {
  name: string;
}

interface IDog extends IAnimal {
  breed: string;
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const dogSymbols = index.symbolsGetByName('IDog');
    expect(dogSymbols).toHaveLength(1);
    const dog = dogSymbols[0];

    const rels = index.typeRelationsGet(dog.id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('IAnimal');
    expect(rels[0].relationKind).toBe('extends');
    expect(rels[0].resolvedTargetId).toBeDefined();

    const animalSymbols = index.symbolsGetByName('IAnimal');
    expect(animalSymbols).toHaveLength(1);
    expect(rels[0].resolvedTargetId).toBe(animalSymbols[0].id);
  });

  // ==========================================================================
  // Abstract class extends + implements
  // ==========================================================================

  it('should detect abstract class extends and implements', () => {
    const file = path.join(testDir, 'abstract_class.ts');
    fs.writeFileSync(file, `
interface IDrawable {
  draw(): void;
}

class Shape {
  color: string = 'black';
}

abstract class AbstractWidget extends Shape implements IDrawable {
  abstract draw(): void;
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const widgetSymbols = index.symbolsGetByName('AbstractWidget');
    expect(widgetSymbols).toHaveLength(1);
    const widget = widgetSymbols[0];

    const rels = index.typeRelationsGet(widget.id);
    expect(rels).toHaveLength(2);

    const extendsRel = rels.find(r => r.relationKind === 'extends');
    expect(extendsRel).toBeDefined();
    expect(extendsRel!.targetName).toBe('Shape');

    const implementsRel = rels.find(r => r.relationKind === 'implements');
    expect(implementsRel).toBeDefined();
    expect(implementsRel!.targetName).toBe('IDrawable');
  });

  // ==========================================================================
  // Class extends with generic type parameter
  // ==========================================================================

  it('should detect class extends with generic type parameter', () => {
    const file = path.join(testDir, 'generic_extends.ts');
    fs.writeFileSync(file, `
class TypedArray extends Array<string> {
  custom: boolean = true;
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const typedArraySymbols = index.symbolsGetByName('TypedArray');
    expect(typedArraySymbols).toHaveLength(1);
    const typedArray = typedArraySymbols[0];

    const rels = index.typeRelationsGet(typedArray.id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('Array');
    expect(rels[0].relationKind).toBe('extends');
    // Array is a built-in, so resolvedTargetId should be undefined
    expect(rels[0].resolvedTargetId).toBeUndefined();
  });

  // ==========================================================================
  // subTypesGet — reverse lookup
  // ==========================================================================

  it('should find sub-types via subTypesGet', () => {
    const file = path.join(testDir, 'subtypes.ts');
    fs.writeFileSync(file, `
class Vehicle {
  wheels: number = 4;
}

class Truck extends Vehicle {
  payload: number = 0;
}

class Sedan extends Vehicle {
  passengers: number = 5;
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const vehicleSymbols = index.symbolsGetByName('Vehicle');
    expect(vehicleSymbols).toHaveLength(1);
    const vehicle = vehicleSymbols[0];

    const subs = index.subTypesGet(vehicle.id);
    expect(subs).toHaveLength(2);
    const childNames = subs.map(r => {
      const sym = index.symbolGet(r.symbolId);
      return sym?.name;
    }).sort();
    expect(childNames).toEqual(['Sedan', 'Truck']);
  });

  // ==========================================================================
  // No type relations — empty results
  // ==========================================================================

  it('should return empty array for file with no type relations', () => {
    const file = path.join(testDir, 'no_rels.ts');
    fs.writeFileSync(file, `
function standalone() {
  return 42;
}

const x = standalone();
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const rels = index.typeRelationsInFileGet(file);
    expect(rels).toHaveLength(0);
  });

  it('should return empty array for symbol with no extends/implements', () => {
    const file = path.join(testDir, 'no_heritage.ts');
    fs.writeFileSync(file, `
class PlainClass {
  value: number = 0;
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const plainSymbols = index.symbolsGetByName('PlainClass');
    expect(plainSymbols).toHaveLength(1);
    const plain = plainSymbols[0];

    const rels = index.typeRelationsGet(plain.id);
    expect(rels).toHaveLength(0);
  });

  // ==========================================================================
  // Cross-file type relation
  // ==========================================================================

  it('should detect cross-file type relation with file-local resolution', () => {
    // In this test, the class extends a symbol imported from another file.
    // The targetName is the local alias. resolvedTargetId will be the local
    // import binding symbol, not the remote symbol (cross-file resolution of
    // type relations is not yet implemented).
    const fileBase = path.join(testDir, 'xfile_base.ts');
    fs.writeFileSync(fileBase, `
export class BaseService {
  start() {}
}
`);

    const fileDerived = path.join(testDir, 'xfile_derived.ts');
    fs.writeFileSync(fileDerived, `
import { BaseService } from './xfile_base';

class DerivedService extends BaseService {
  stop() {}
}
`);

    const { index } = projectIndexBuildSync({
      files: [fileBase, fileDerived],
      dir: testDir,
    });

    const derivedSymbols = index.symbolsGetByName('DerivedService');
    expect(derivedSymbols).toHaveLength(1);
    const derived = derivedSymbols[0];

    const rels = index.typeRelationsGet(derived.id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('BaseService');
    expect(rels[0].relationKind).toBe('extends');
    // File-local resolution finds the import binding symbol named 'BaseService'
    // in the derived file, so resolvedTargetId should be defined
    expect(rels[0].resolvedTargetId).toBeDefined();
  });

  // ==========================================================================
  // Interface extends multiple interfaces
  // ==========================================================================

  it('should detect interface extending multiple interfaces', () => {
    const file = path.join(testDir, 'multi_iface_extends.ts');
    fs.writeFileSync(file, `
interface IReadable {
  read(): string;
}

interface IWritable {
  write(data: string): void;
}

interface IStream extends IReadable, IWritable {
  close(): void;
}
`);

    const { index } = projectIndexBuildSync({
      files: [file],
      dir: testDir,
    });

    const streamSymbols = index.symbolsGetByName('IStream');
    expect(streamSymbols).toHaveLength(1);
    const stream = streamSymbols[0];

    const rels = index.typeRelationsGet(stream.id);
    expect(rels).toHaveLength(2);
    expect(rels.every(r => r.relationKind === 'extends')).toBe(true);
    const targetNames = rels.map(r => r.targetName).sort();
    expect(targetNames).toEqual(['IReadable', 'IWritable']);
  });
});
