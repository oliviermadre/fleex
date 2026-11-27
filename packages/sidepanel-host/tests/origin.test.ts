import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAllowedOrigin, LISTEN_HOSTNAME } from '../src/origin.ts';

const SELF = 'laptop.tail1234.ts.net';
const self = () => SELF;
const noTailscale = () => null;

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
    expect(isAllowedOrigin(origin, [], self)).toBe(ok);
  });

  // Anyone can publish a public https://<machine>.<their-tailnet>.ts.net site with
  // Tailscale Funnel; such a page could open ws://localhost:4399 from the user's browser.
  it.each(['https://evil.tail1234.ts.net', 'https://laptop.other-tailnet.ts.net', 'https://ts.net'])(
    'refuses %s, a tailnet name that is not this machine',
    (origin) => {
      expect(isAllowedOrigin(origin, [], self)).toBe(false);
    },
  );

  it('refuses every *.ts.net origin when tailscale is not running', () => {
    expect(isAllowedOrigin('https://laptop.tail1234.ts.net', [], noTailscale)).toBe(false);
  });

  it('accepts origins added by configuration', () => {
    expect(isAllowedOrigin('https://fleex.internal', ['https://fleex.internal'], noTailscale)).toBe(true);
  });

  it('pins the extension once one chrome-extension origin is configured', () => {
    const extra = ['chrome-extension://fleexid'];
    expect(isAllowedOrigin('chrome-extension://fleexid', extra, noTailscale)).toBe(true);
    expect(isAllowedOrigin('chrome-extension://otherextension', extra, noTailscale)).toBe(false);
  });
});

// Without this, anything on the same Wi-Fi or tailnet could open /chat directly
// (no Origin header) and run Bash on the machine.
describe('listen address', () => {
  it('is IPv4 loopback', () => {
    expect(LISTEN_HOSTNAME).toBe('127.0.0.1');
  });

  it('is what the server binds to', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/server.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/Bun\.serve<WsData>\(\{[^}]*hostname: LISTEN_HOSTNAME,/);
  });
});
