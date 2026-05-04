import { describe, it, expect } from 'vitest';
import {
  Ok,
  Err,
  isOk,
  isErr,
  resultFrom,
  resultFromAsync,
  map,
  mapErr,
  andThen,
  unwrapOr,
  resultAll,
  resultMessageFromUnknown,
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
        expect(result.Ok).toEqual({ name: 'test' });
      } else {
        expect.unreachable('Expected Ok variant');
      }
    });
  });

  describe('isErr', () => {
    it('should narrow the type to Err variant', () => {
      const result = Err(new Error('fail'));

      if (isErr(result)) {
        expect(result.Err).toBeInstanceOf(Error);
        expect(result.Err.message).toBe('fail');
      } else {
        expect.unreachable('Expected Err variant');
      }
    });
  });

  describe('map', () => {
    it('maps Ok values', () => {
      const r = map(Ok(2), (n) => n * 3);
      expect(isOk(r) && r.Ok).toBe(6);
    });
    it('passes through Err', () => {
      const r = map(Err<number, string>('x'), (n) => n * 3);
      expect(isErr(r) && r.Err).toBe('x');
    });
  });

  describe('mapErr', () => {
    it('maps Err values', () => {
      const r = mapErr(Err('a'), (e) => `${e}!`);
      expect(isErr(r) && r.Err).toBe('a!');
    });
    it('passes through Ok', () => {
      const r = mapErr(Ok(1), (e: never) => e);
      expect(isOk(r) && r.Ok).toBe(1);
    });
  });

  describe('andThen', () => {
    it('chains Ok into Result', () => {
      const r = andThen(Ok(2), (n) => (n > 0 ? Ok(n + 1) : Err('bad')));
      expect(isOk(r) && r.Ok).toBe(3);
    });
    it('short-circuits on Err', () => {
      const r = andThen(Err<number, string>('e'), () => Ok(0));
      expect(isErr(r) && r.Err).toBe('e');
    });
  });

  describe('resultAll', () => {
    it('collects Ok values in order', () => {
      const r = resultAll([Ok(1), Ok(2), Ok(3)]);
      expect(isOk(r) && r.Ok).toEqual([1, 2, 3]);
    });
    it('short-circuits on first Err', () => {
      const r = resultAll([Ok(1), Err('x'), Ok(3)]);
      expect(isErr(r) && r.Err).toBe('x');
    });
  });

  describe('unwrapOr', () => {
    it('returns Ok value', () => {
      expect(unwrapOr(Ok(5), 0)).toBe(5);
    });
    it('returns default on Err', () => {
      expect(unwrapOr(Err('e'), 0)).toBe(0);
    });
  });

  describe('resultMessageFromUnknown', () => {
    it('reads message from Error-like objects', () => {
      expect(resultMessageFromUnknown(new Error('m'))).toBe('m');
    });
    it('stringifies primitives', () => {
      expect(resultMessageFromUnknown(404)).toBe('404');
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
      const result = resultFrom<never, SyntaxError>(() => {
        JSON.parse('not valid json');
        return undefined as never;
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.Err).toBeInstanceOf(SyntaxError);
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
      const result = await resultFromAsync<number, Error>(async () =>
        Promise.reject(new Error('async boom'))
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.Err).toBeInstanceOf(Error);
        expect(result.Err.message).toBe('async boom');
      }
    });
  });
});
