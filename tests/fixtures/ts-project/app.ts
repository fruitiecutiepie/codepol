import { User, createUser } from './models';
import { VERSION, LogLevel } from './config';
import type { Result } from './types';
import * as services from './services';
import sum from './utils/math';
import { groupBy } from './utils/collections';

export async function main(): Promise<void> {
  const user = createUser('Alice', 'alice@example.com');
  console.log(user.greet(), VERSION);

  const result: Result<User> = await services.auth.authenticate('token');
  if (result.ok) {
    console.log('authenticated:', result.value.name);
  }

  const { name, id } = user.toJSON() as { name: string; id: string };
  console.log(name, id);

  const nums = [1, 2, 3, 4, 5];
  const total = sum(...nums);

  const users = [
    createUser('Bob', 'bob@example.com'),
    createUser('Carol', 'carol@example.com'),
  ];
  const grouped = groupBy(users, u => u.name[0]);

  console.log(total, grouped, LogLevel.Info);
}
