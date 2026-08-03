import { describe, it, expect, afterEach } from 'vitest';

import { buildCookie, isSecureRequest } from '../../src/infrastructure/http/cookies.js';

afterEach(() => {
  delete process.env['FLEEX_COOKIE_SECURE'];
});

describe('isSecureRequest', () => {
  it('is false on plain http://localhost — Safari drops Secure cookies there, which would break the nominal local login', () => {
    expect(isSecureRequest({ headers: {}, protocol: 'http' })).toBe(false);
  });

  it('is true behind a TLS-terminating proxy (X-Forwarded-Proto: https), which is the Tailscale serve case', () => {
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' }, protocol: 'http' })).toBe(
      true,
    );
  });

  it('reads only the first hop of a comma-joined X-Forwarded-Proto, the value the browser actually used', () => {
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https, http' } })).toBe(true);
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'http, https' } })).toBe(false);
  });

  it('handles the header arriving as an array', () => {
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': ['https'] } })).toBe(true);
  });

  it('is true on a directly served https request', () => {
    expect(isSecureRequest({ headers: {}, protocol: 'https' })).toBe(true);
  });

  it('lets FLEEX_COOKIE_SECURE=1 force Secure on, overriding the derived value', () => {
    process.env['FLEEX_COOKIE_SECURE'] = '1';
    expect(isSecureRequest({ headers: {}, protocol: 'http' })).toBe(true);
  });

  it('lets FLEEX_COOKIE_SECURE=0 force Secure off, overriding even X-Forwarded-Proto: https', () => {
    process.env['FLEEX_COOKIE_SECURE'] = '0';
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } })).toBe(false);
  });
});

describe('buildCookie', () => {
  it('emits the hardened session cookie: HttpOnly, SameSite=Strict and Secure behind HTTPS', () => {
    expect(
      buildCookie('fleex_session', 'abc', { maxAge: 2592000, sameSite: 'Strict', secure: true }),
    ).toBe('fleex_session=abc; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000');
  });

  it('omits Secure on plain HTTP so the cookie is not silently dropped', () => {
    expect(
      buildCookie('fleex_session', 'abc', { maxAge: 2592000, sameSite: 'Strict', secure: false }),
    ).toBe('fleex_session=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000');
  });

  it('keeps the OAuth state cookie on SameSite=Lax: under Strict it would not be sent on the cross-site callback from the provider and login would break', () => {
    expect(
      buildCookie('fleex_oauth_state', 'deadbeef', { maxAge: 600, sameSite: 'Lax', secure: false }),
    ).toBe('fleex_oauth_state=deadbeef; Path=/; HttpOnly; SameSite=Lax; Max-Age=600');
  });

  it('builds an erasure cookie with Max-Age=0', () => {
    expect(buildCookie('fleex_session', '', { maxAge: 0, sameSite: 'Strict', secure: false })).toBe(
      'fleex_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    );
  });
});
