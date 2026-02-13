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

  it('should resolve cross-file extends to actual exported symbol', () => {
    // Class extends a symbol imported from another file.
    // resolvedTargetId should point to the actual exported BaseService symbol
    // in the source file, not the local import binding.
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
    expect(rels[0].resolvedTargetId).toBeDefined();

    // resolvedTargetId should point to the actual exported symbol in the base file,
    // not the local import binding in the derived file
    const baseSymbols = index.symbolsGetByName('BaseService');
    const exportedBase = baseSymbols.find(s => s.file === fileBase);
    expect(exportedBase).toBeDefined();
    expect(rels[0].resolvedTargetId).toBe(exportedBase!.id);
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

  // ==========================================================================
  // Cross-file: class implements imported interface
  // ==========================================================================

  it('should resolve cross-file implements to actual exported interface', () => {
    const fileInterface = path.join(testDir, 'xfile_iface.ts');
    fs.writeFileSync(fileInterface, `
export interface IRepository {
  findById(id: string): unknown;
}
`);

    const fileImpl = path.join(testDir, 'xfile_impl.ts');
    fs.writeFileSync(fileImpl, `
import { IRepository } from './xfile_iface';

export class UserRepository implements IRepository {
  findById(id: string) { return null; }
}
`);

    const { index } = projectIndexBuildSync({
      files: [fileInterface, fileImpl],
      dir: testDir,
    });

    const implSymbols = index.symbolsGetByName('UserRepository');
    expect(implSymbols).toHaveLength(1);

    const rels = index.typeRelationsGet(implSymbols[0].id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('IRepository');
    expect(rels[0].relationKind).toBe('implements');

    // resolvedTargetId should point to the exported interface in xfile_iface.ts
    const ifaceSymbols = index.symbolsGetByName('IRepository');
    const exportedIface = ifaceSymbols.find(s => s.file === fileInterface);
    expect(exportedIface).toBeDefined();
    expect(rels[0].resolvedTargetId).toBe(exportedIface!.id);
  });

  // ==========================================================================
  // Cross-file: extends through re-export chain
  // ==========================================================================

  it('should resolve cross-file extends through re-export chain', () => {
    const fileOrigin = path.join(testDir, 'xfile_origin.ts');
    fs.writeFileSync(fileOrigin, `
export class BaseEntity {
  id: string = '';
}
`);

    const fileProxy = path.join(testDir, 'xfile_proxy.ts');
    fs.writeFileSync(fileProxy, `
export { BaseEntity } from './xfile_origin';
`);

    const fileConsumer = path.join(testDir, 'xfile_consumer.ts');
    fs.writeFileSync(fileConsumer, `
import { BaseEntity } from './xfile_proxy';

export class UserEntity extends BaseEntity {
  name: string = '';
}
`);

    const { index } = projectIndexBuildSync({
      files: [fileOrigin, fileProxy, fileConsumer],
      dir: testDir,
    });

    const userSymbols = index.symbolsGetByName('UserEntity');
    expect(userSymbols).toHaveLength(1);

    const rels = index.typeRelationsGet(userSymbols[0].id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('BaseEntity');
    expect(rels[0].relationKind).toBe('extends');

    // resolvedTargetId should trace through the re-export to the origin symbol
    const originSymbols = index.symbolsGetByName('BaseEntity');
    const exportedOrigin = originSymbols.find(s => s.file === fileOrigin);
    expect(exportedOrigin).toBeDefined();
    expect(rels[0].resolvedTargetId).toBe(exportedOrigin!.id);
  });

  // ==========================================================================
  // Cross-file: extends with aliased import
  // ==========================================================================

  it('should resolve cross-file extends with aliased import', () => {
    const fileBase = path.join(testDir, 'xfile_aliased_base.ts');
    fs.writeFileSync(fileBase, `
export class HttpClient {
  request() { return null; }
}
`);

    const fileDerived = path.join(testDir, 'xfile_aliased_derived.ts');
    fs.writeFileSync(fileDerived, `
import { HttpClient as BaseClient } from './xfile_aliased_base';

export class ApiClient extends BaseClient {
  get() { return this.request(); }
}
`);

    const { index } = projectIndexBuildSync({
      files: [fileBase, fileDerived],
      dir: testDir,
    });

    const apiSymbols = index.symbolsGetByName('ApiClient');
    expect(apiSymbols).toHaveLength(1);

    const rels = index.typeRelationsGet(apiSymbols[0].id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('BaseClient');
    expect(rels[0].relationKind).toBe('extends');

    // resolvedTargetId should point to the actual HttpClient symbol in the base file
    const httpSymbols = index.symbolsGetByName('HttpClient');
    const exportedHttp = httpSymbols.find(s => s.file === fileBase);
    expect(exportedHttp).toBeDefined();
    expect(rels[0].resolvedTargetId).toBe(exportedHttp!.id);
  });

  // ==========================================================================
  // Cross-file: interface extends imported interface
  // ==========================================================================

  it('should resolve cross-file interface extends to actual exported interface', () => {
    const fileParent = path.join(testDir, 'xfile_parent_iface.ts');
    fs.writeFileSync(fileParent, `
export interface ILogger {
  log(message: string): void;
}
`);

    const fileChild = path.join(testDir, 'xfile_child_iface.ts');
    fs.writeFileSync(fileChild, `
import { ILogger } from './xfile_parent_iface';

export interface IStructuredLogger extends ILogger {
  logJson(data: Record<string, unknown>): void;
}
`);

    const { index } = projectIndexBuildSync({
      files: [fileParent, fileChild],
      dir: testDir,
    });

    const childSymbols = index.symbolsGetByName('IStructuredLogger');
    expect(childSymbols).toHaveLength(1);

    const rels = index.typeRelationsGet(childSymbols[0].id);
    expect(rels).toHaveLength(1);
    expect(rels[0].targetName).toBe('ILogger');
    expect(rels[0].relationKind).toBe('extends');

    // resolvedTargetId should point to the exported ILogger in the parent file
    const loggerSymbols = index.symbolsGetByName('ILogger');
    const exportedLogger = loggerSymbols.find(s => s.file === fileParent);
    expect(exportedLogger).toBeDefined();
    expect(rels[0].resolvedTargetId).toBe(exportedLogger!.id);
  });
});
