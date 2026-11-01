import { describe, expect, it } from 'vitest';
import { isForeignLocalData } from '../src/lib/localData';

describe('isForeignLocalData', () => {
  it('is false without a cached session', () => {
    expect(isForeignLocalData(null, 'u1')).toBe(false);
  });
  it('is false for the same user', () => {
    expect(isForeignLocalData('{"user":{"id":"u1"}}', 'u1')).toBe(false);
  });
  it('is true for another user', () => {
    expect(isForeignLocalData('{"user":{"id":"u1"}}', 'u2')).toBe(true);
  });
  it('is false when the cache is unreadable or has no usable owner', () => {
    expect(isForeignLocalData('not json', 'u2')).toBe(false);
    expect(isForeignLocalData('{"workspace":{}}', 'u2')).toBe(false);
    expect(isForeignLocalData('{"user":{"id":5}}', 'u2')).toBe(false);
  });
});
