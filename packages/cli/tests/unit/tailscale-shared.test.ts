import { describe, it, expect } from 'vitest';
import { parseServeStatus, serveUrl } from '../../src/commands/tailscale/_shared.ts';
import type { TailscaleBackend } from '../../src/commands/tailscale/_shared.ts';

const backend: TailscaleBackend = {
  installed: true,
  state: 'Running',
  running: true,
  dnsName: 'fleexbox.tailnet-abc.ts.net',
  tailnet: 'tailnet-abc',
  httpsAvailable: true,
};

describe('parseServeStatus', () => {
  it('returns [] for empty or blank input', () => {
    expect(parseServeStatus('')).toEqual([]);
    expect(parseServeStatus('   ')).toEqual([]);
  });

  it('returns [] for malformed JSON', () => {
    expect(parseServeStatus('{not json')).toEqual([]);
  });

  it('returns [] when there is no Web section', () => {
    expect(parseServeStatus('{}')).toEqual([]);
  });

  it('parses an HTTPS mapping with its proxy target', () => {
    const raw = JSON.stringify({
      TCP: { '443': { HTTPS: true } },
      Web: { 'host.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:33333' } } } },
    });
    expect(parseServeStatus(raw)).toEqual([
      { port: 443, scheme: 'https', target: 'http://localhost:33333' },
    ]);
  });

  it('distinguishes an HTTP-only port from HTTPS and sorts by port', () => {
    const raw = JSON.stringify({
      TCP: { '443': { HTTPS: true }, '80': { HTTP: true } },
      Web: {
        'host.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:1' } } },
        'host.ts.net:80': { Handlers: { '/': { Proxy: 'http://localhost:2' } } },
      },
    });
    expect(parseServeStatus(raw)).toEqual([
      { port: 80, scheme: 'http', target: 'http://localhost:2' },
      { port: 443, scheme: 'https', target: 'http://localhost:1' },
    ]);
  });

  it('tolerates a handler without a "/" path', () => {
    const raw = JSON.stringify({
      TCP: { '8443': { HTTPS: true } },
      Web: { 'host.ts.net:8443': { Handlers: { '/api': { Proxy: 'http://localhost:9' } } } },
    });
    expect(parseServeStatus(raw)).toEqual([
      { port: 8443, scheme: 'https', target: 'http://localhost:9' },
    ]);
  });
});

describe('serveUrl', () => {
  it('omits the port for the default HTTPS port', () => {
    expect(serveUrl(backend, 'https', 443)).toBe('https://fleexbox.tailnet-abc.ts.net');
  });

  it('omits the port for the default HTTP port', () => {
    expect(serveUrl(backend, 'http', 80)).toBe('http://fleexbox.tailnet-abc.ts.net');
  });

  it('includes a non-default port', () => {
    expect(serveUrl(backend, 'https', 8443)).toBe('https://fleexbox.tailnet-abc.ts.net:8443');
  });

  it('returns null when the node has no DNS name', () => {
    expect(serveUrl({ ...backend, dnsName: null }, 'https', 443)).toBeNull();
  });
});
