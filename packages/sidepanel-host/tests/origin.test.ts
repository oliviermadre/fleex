import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../src/origin.ts';

// The Assistant runs Bash without asking: a random web page must not be able to drive it.
describe('WebSocket origin', () => {
  it.each([
    [null, true],
    ['chrome-extension://abcdef', true],
    ['http://localhost:5173', true],
    ['http://127.0.0.1:3000', true],
    ['https://laptop.tail1234.ts.net', true],
    ['https://evil.example.com', false],
    ['http://localhost.evil.com', false],
    ['http://laptop.tail1234.ts.net', false],
    ['file://', false],
  ])('%s → %s', (origin, ok) => {
    expect(isAllowedOrigin(origin, [])).toBe(ok);
  });

  it('accepts origins added by configuration', () => {
    expect(isAllowedOrigin('https://fleex.internal', ['https://fleex.internal'])).toBe(true);
  });
});
