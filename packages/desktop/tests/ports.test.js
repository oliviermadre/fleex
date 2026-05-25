/**
 * Tests for the port + health helpers used by the DMG orchestrator.
 * These guard the boot path: if findFreePort returns a busy port, or if
 * waitForHealthy never gives up, the .app will hang on the splash screen
 * forever. Each test pins down one such failure mode.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findFreePort, waitForHealthy } = require('../src/lib/ports.js');

describe('findFreePort', () => {
  it('returns a port that is bindable', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    // Bind to it ourselves to prove it's free
    const srv = net.createServer();
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', resolve);
    });
    srv.close();
  });

  it('returns different ports on successive calls', async () => {
    const a = await findFreePort();
    const b = await findFreePort();
    // Not strictly guaranteed, but extremely unlikely to collide
    expect(a).not.toBe(b);
  });
});

describe('waitForHealthy', () => {
  it('resolves true once the URL returns 2xx', async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;
    try {
      const ok = await waitForHealthy({
        url: `http://127.0.0.1:${port}/health`,
        intervalMs: 50,
        timeoutMs: 2000,
      });
      expect(ok).toBe(true);
    } finally {
      srv.close();
    }
  });

  it('returns false on timeout when the URL never becomes reachable', async () => {
    const ok = await waitForHealthy({
      // .254 is reserved; refused/timed-out fast
      url: 'http://127.0.0.1:1/health',
      intervalMs: 50,
      timeoutMs: 300,
    });
    expect(ok).toBe(false);
  });

  it('short-circuits to false if isAliveFn returns false (child crashed)', async () => {
    const start = Date.now();
    const ok = await waitForHealthy({
      url: 'http://127.0.0.1:1/health',
      isAliveFn: () => false,
      intervalMs: 50,
      timeoutMs: 5000,
    });
    expect(ok).toBe(false);
    // Should return long before timeoutMs since the child is dead
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('honours AbortSignal', async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    const start = Date.now();
    const ok = await waitForHealthy({
      url: 'http://127.0.0.1:1/health',
      signal: ctrl.signal,
      intervalMs: 50,
      timeoutMs: 5000,
    });
    expect(ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
