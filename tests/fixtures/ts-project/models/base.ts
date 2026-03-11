import type { Identifiable, Timestamped } from '../types';

export abstract class BaseModel implements Identifiable, Timestamped {
  readonly id: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(id: string) {
    this.id = id;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  get age(): number {
    return Date.now() - this.createdAt.getTime();
  }

  static generateId(): string {
    return Math.random().toString(36).slice(2);
  }

  abstract validate(): boolean;
}
