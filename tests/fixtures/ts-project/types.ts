export interface Identifiable {
  id: string;
}

export interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}

export interface Serializable {
  toJSON(): Record<string, unknown>;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export type Nullable<T> = T | null;
