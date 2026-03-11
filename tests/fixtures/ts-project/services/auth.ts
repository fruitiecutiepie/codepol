import { User } from '../models/user';
import { SECRET_KEY } from '../config';
import type { Result } from '../types';

export async function authenticate(token: string): Promise<Result<User>> {
  try {
    if (token === SECRET_KEY) {
      const user = new User('1', 'admin', 'admin@example.com');
      return { ok: true, value: user };
    }
    return { ok: false, error: new Error('invalid token') };
  } catch (err) {
    return { ok: false, error: err as Error };
  }
}

export async function refreshToken(oldToken: string): Promise<string> {
  if (!oldToken) {
    throw new Error('empty token');
  }
  return `refreshed_${oldToken}`;
}

export default function verifyUser(user: User): boolean {
  return user.validate();
}
