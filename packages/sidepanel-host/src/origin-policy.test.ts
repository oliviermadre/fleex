import { describe, it, expect } from 'vitest';
import { corsHeaders, isOriginAllowed, isRequestAllowed, parseAllowlist } from './origin-policy.ts';

function request(headers: Record<string, string>): Request {
  return new Request('http://127.0.0.1:4399/health', { headers });
}

describe('isOriginAllowed', () => {
  it('allows the Chrome side panel by scheme, because the unpacked extension id changes on every dev reload', () => {
    expect(isOriginAllowed('chrome-extension://abcdefghijklmnop', 'localhost:4399', [])).toBe(true);
    expect(isOriginAllowed('chrome-extension://a-totally-different-id', 'localhost:4399', [])).toBe(true);
  });

  it('allows an origin matching the Host, which is how the mobile assistant reaches the companion through the Vite proxy', () => {
    expect(isOriginAllowed('https://mac.tail1234.ts.net', 'mac.tail1234.ts.net', [])).toBe(true);
  });

  it('allows any loopback port, covering the web app on the Vite dev server', () => {
    expect(isOriginAllowed('http://localhost:5173', 'localhost:4399', [])).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:5173', 'localhost:4399', [])).toBe(true);
  });

  it('allows a request with no Origin — a non-browser client such as the CLI health probe', () => {
    expect(isOriginAllowed(null, 'localhost:4399', [])).toBe(true);
  });

  it('rejects a foreign origin: this is what stops evil.com from driving the assistant and self-approving its own tool confirmations', () => {
    expect(isOriginAllowed('https://evil.com', 'localhost:4399', [])).toBe(false);
  });

  it('rejects an unparsable Origin rather than failing open', () => {
    expect(isOriginAllowed('not a url', 'localhost:4399', [])).toBe(false);
  });

  it('honours the operator allowlist', () => {
    expect(isOriginAllowed('https://ok.example', 'localhost:4399', ['https://ok.example'])).toBe(true);
  });
});

describe('corsHeaders', () => {
  it('reflects an allowed origin with Vary, replacing the old blanket wildcard', () => {
    const headers = corsHeaders(request({ origin: 'chrome-extension://abc', host: 'localhost:4399' }), []);
    expect(headers['Access-Control-Allow-Origin']).toBe('chrome-extension://abc');
    expect(headers['Vary']).toBe('Origin');
  });

  it('returns no CORS headers at all for a refused origin, so the browser drops the response', () => {
    expect(corsHeaders(request({ origin: 'https://evil.com', host: 'localhost:4399' }), [])).toEqual({});
  });

  it('never emits Access-Control-Allow-Credentials: the companion uses no cookie, and pairing credentials with a reflected origin is what made the server exploitable', () => {
    const headers = corsHeaders(request({ origin: 'http://localhost:5173', host: 'localhost:4399' }), []);
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('emits nothing when there is no Origin — a non-browser client needs no CORS header', () => {
    expect(corsHeaders(request({ host: 'localhost:4399' }), [])).toEqual({});
  });
});

describe('isRequestAllowed — gates the /chat WebSocket upgrade', () => {
  it('refuses an upgrade from a foreign origin', () => {
    expect(isRequestAllowed(request({ origin: 'https://evil.com', host: 'localhost:4399' }), [])).toBe(false);
  });

  it('accepts the side panel', () => {
    expect(isRequestAllowed(request({ origin: 'chrome-extension://abc', host: 'localhost:4399' }), [])).toBe(true);
  });
});

describe('parseAllowlist', () => {
  it('normalises and drops junk', () => {
    expect(parseAllowlist('https://a.example/, ,nope')).toEqual(['https://a.example']);
  });

  it('is empty by default', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});
