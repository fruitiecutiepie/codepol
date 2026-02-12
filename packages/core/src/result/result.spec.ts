import { describe, it, expect } from 'vitest';
import {
  Ok,
  Err,
  isOk,
  isErr,
  resultFrom,
  resultFromAsync,
} from './result';

describe('Result utilities', () => {
  describe('Ok', () => {
    it('should wrap a value and be recognized by isOk', () => {
      const result = Ok(42);

      expect(isOk(result)).toBe(true);
      expect(isErr(result)).toBe(false);
      expect(result.Ok).toBe(42);
    });
  });

  describe('Err', () => {
    it('should wrap an error and be recognized by isErr', () => {
      const result = Err('something went wrong');

      expect(isErr(result)).toBe(true);
      expect(isOk(result)).toBe(false);
      expect(result.Err).toBe('something went wrong');
    });
  });

  describe('isOk', () => {
    it('should narrow the type to Ok variant', () => {
      const result = Ok({ name: 'test' });

      if (isOk(result)) {
        // Type narrowing: result.Ok is accessible
        expect(result.Ok).toEqual({ name: 'test' });
      } else {
        // Should not reach here
        expect.unreachable('Expected Ok variant');
      }
    });
  });

  describe('isErr', () => {
    it('should narrow the type to Err variant', () => {
      const result = Err(new Error('fail'));

      if (isErr(result)) {
        // Type narrowing: result.Err is accessible
        expect(result.Err).toBeInstanceOf(Error);
        expect(result.Err.message).toBe('fail');
      } else {
        expect.unreachable('Expected Err variant');
      }
    });
  });

  describe('resultFrom', () => {
    it('should return Ok when function succeeds', () => {
      const result = resultFrom(() => 'hello');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.Ok).toBe('hello');
      }
    });

    it('should return Err when function throws', () => {
      const result = resultFrom<string, Error>(() => {
        throw new Error('boom');
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.Err).toBeInstanceOf(Error);
        expect(result.Err.message).toBe('boom');
      }
    });
  });

  describe('resultFromAsync', () => {
    it('should return Ok when promise resolves', async () => {
      const result = await resultFromAsync(async () => 99);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.Ok).toBe(99);
      }
    });

    it('should return Err when promise rejects', async () => {
      const result = await resultFromAsync<number, Error>(async () => {
        throw new Error('async boom');
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.Err).toBeInstanceOf(Error);
        expect(result.Err.message).toBe('async boom');
      }
    });
  });
});
