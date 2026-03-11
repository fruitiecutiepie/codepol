import { BaseModel } from './base';
import type { Serializable } from '../types';

export class User extends BaseModel implements Serializable {
  name: string;
  private email: string;

  constructor(id: string, name: string, email: string) {
    super(id);
    this.name = name;
    this.email = email;
  }

  validate(): boolean {
    return this.name.length > 0 && this.email.includes('@');
  }

  toJSON(): Record<string, unknown> {
    return { id: this.id, name: this.name, email: this.email };
  }

  greet(): string {
    return `Hello, ${this.name}`;
  }
}

export function createUser(name: string, email: string): User {
  const id = BaseModel.generateId();
  return new User(id, name, email);
}
