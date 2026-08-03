import { describe, it, expect } from 'vitest';

import {
  isOriginAllowed,
  isLoopbackOrigin,
  isLoopbackHost,
  parseAllowlist,
} from '../../src/infrastructure/http/origin-policy.js';

const NO_ALLOWLIST: string[] = [];

describe('isOriginAllowed — no Origin header', () => {
  it('allows a request with no Origin: those are non-browser clients (CLI, MCP, hooks) that carry no ambient credentials', () => {
    expect(
      isOriginAllowed({ origin: undefined, host: 'localhost:3000', allowlist: NO_ALLOWLIST }),
    ).toBe(true);
  });
});

describe('isOriginAllowed — the Origin.host === Host rule', () => {
  it('allows the Tailscale hostname when the browser reached us through it — this is what keeps docs/mobile.md working with zero config', () => {
    expect(
      isOriginAllowed({
        origin: 'https://mac.tail1234.ts.net',
        host: 'mac.tail1234.ts.net',
        allowlist: NO_ALLOWLIST,
      }),
    ).toBe(true);
  });

  it('rejects a tailnet origin that does not match the Host we were reached on — an attacker owning evil.tailnet.ts.net must not inherit the victim access', () => {
    expect(
      isOriginAllowed({
        origin: 'https://evil.tailnet.ts.net',
        host: 'mac.tail1234.ts.net',
        allowlist: NO_ALLOWLIST,
      }),
    ).toBe(false);
  });

  it('compares host WITH the port, so a different port on the same name is not auto-trusted by this rule', () => {
    // Only rule 3 is under test here: use a non-loopback name so the loopback
    // rule cannot rescue the mismatch.
    expect(
      isOriginAllowed({
        origin: 'https://box.ts.net:8443',
        host: 'box.ts.net',
        allowlist: NO_ALLOWLIST,
      }),
    ).toBe(false);
  });

  it('ignores a forged X-Forwarded-Host: only the real Host header is ever passed in', () => {
    // The caller passes request.headers.host; this asserts the shape of the
    // contract — an attacker-controlled value can never stand in for it.
    expect(
      isOriginAllowed({
        origin: 'https://evil.com',
        host: 'mac.tail1234.ts.net',
        allowlist: NO_ALLOWLIST,
      }),
    ).toBe(false);
  });
});

describe('isOriginAllowed — loopback', () => {
  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost',
    'https://localhost:3000',
    'http://[::1]:5173',
  ])('allows %s regardless of the port, so the Vite dev server can call the API', (origin) => {
    expect(isOriginAllowed({ origin, host: 'localhost:3000', allowlist: NO_ALLOWLIST })).toBe(true);
  });

  it('does not treat a non-http(s) scheme as loopback', () => {
    expect(isLoopbackOrigin(new URL('file://localhost/etc/passwd'))).toBe(false);
  });

  it('rejects a hostname that merely contains "localhost"', () => {
    expect(
      isOriginAllowed({
        origin: 'https://localhost.evil.com',
        host: 'localhost:3000',
        allowlist: NO_ALLOWLIST,
      }),
    ).toBe(false);
  });
});

describe('isOriginAllowed — malformed and null origins', () => {
  it('rejects the literal "null" origin sent by sandboxed iframes and data: documents', () => {
    expect(
      isOriginAllowed({ origin: 'null', host: 'localhost:3000', allowlist: NO_ALLOWLIST }),
    ).toBe(false);
  });

  it('rejects an unparsable Origin rather than failing open', () => {
    expect(
      isOriginAllowed({ origin: 'not a url', host: 'localhost:3000', allowlist: NO_ALLOWLIST }),
    ).toBe(false);
  });
});

describe('isOriginAllowed — explicit allowlist', () => {
  it('allows an origin the operator opted into via FLEEX_ALLOWED_ORIGINS', () => {
    expect(
      isOriginAllowed({
        origin: 'https://fleex.example.com',
        host: 'internal:3000',
        allowlist: ['https://fleex.example.com'],
      }),
    ).toBe(true);
  });

  it('matches the allowlist exactly — a subdomain of an allowed origin is not allowed', () => {
    expect(
      isOriginAllowed({
        origin: 'https://evil.fleex.example.com',
        host: 'internal:3000',
        allowlist: ['https://fleex.example.com'],
      }),
    ).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('splits on commas and trims', () => {
    expect(parseAllowlist('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('normalises to URL.origin so a trailing path or default port cannot cause a silent mismatch at compare time', () => {
    expect(parseAllowlist('https://a.example:443/dashboard')).toEqual(['https://a.example']);
  });

  it('drops unparsable entries instead of failing startup', () => {
    expect(parseAllowlist('https://a.example,,garbage,https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('returns an empty list when unset — the nominal case needs no configuration', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist('')).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(parseAllowlist('https://a.example,https://a.example/')).toEqual(['https://a.example']);
  });
});

describe('isLoopbackHost — decides whether startup warns about network exposure', () => {
  it.each(['127.0.0.1', 'localhost', '::1', '127.0.0.2'])('%s is loopback → no warning', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(['0.0.0.0', '::', '192.168.1.10'])('%s is network-facing → must warn', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
