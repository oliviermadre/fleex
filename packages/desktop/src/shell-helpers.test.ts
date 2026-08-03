import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain CommonJS helper module, no type declarations.
import { isExternalUrl, fallbackPage } from './shell-helpers.js';

describe('isExternalUrl', () => {
  // WHY: the shell must keep in-app navigation (workspace switching hops
  // between localhost instance ports) inside the window, while sending genuine
  // external links to the OS browser. Getting this wrong either traps external
  // links in the app or ejects workspace switches to Safari.
  it('treats any localhost / 127.0.0.1 origin as internal (any port)', () => {
    expect(isExternalUrl('http://localhost:3000')).toBe(false);
    expect(isExternalUrl('http://localhost:5599/tickets')).toBe(false);
    expect(isExternalUrl('http://127.0.0.1:8080')).toBe(false);
  });

  it('treats real http(s) hosts as external', () => {
    expect(isExternalUrl('https://github.com/oliviermadre/fleex')).toBe(true);
    expect(isExternalUrl('http://example.com')).toBe(true);
  });

  it('is not fooled by non-http protocols or garbage', () => {
    // file:// / javascript: are not http(s) → not "external browser" targets.
    expect(isExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalUrl('not a url')).toBe(false);
  });
});

describe('fallbackPage', () => {
  // WHY: this page is the difference between a friendly "Waiting for Fleex"
  // screen and a raw Chromium error when the .dmg is opened with no stack
  // running (US1 AC). It must be a self-contained data: URL and must send the
  // Retry action back to the real server URL.
  it('returns a self-contained data:text/html URL', () => {
    const page = fallbackPage('http://localhost:3000');
    expect(page.startsWith('data:text/html')).toBe(true);
  });

  it('embeds the retry URL so the Retry button reloads the stack', () => {
    const decoded = decodeURIComponent(fallbackPage('http://localhost:4321'));
    expect(decoded).toContain("location.href='http://localhost:4321'");
    expect(decoded).toContain('Waiting for Fleex');
  });

  it('neutralises quote/angle-bracket injection in the URL', () => {
    // A crafted URL must not be able to break out of the onclick string
    // attribute or inject markup into the page.
    const decoded = decodeURIComponent(fallbackPage('http://localhost:3000/"><script>x'));
    expect(decoded).not.toContain('"><script>');
  });
});
