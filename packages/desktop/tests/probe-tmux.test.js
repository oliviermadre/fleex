/**
 * Tests for probeTmux — the orchestrator-side detection of tmux availability.
 *
 * WHY: spec OQ-1 says we must warn the user if tmux is missing at boot
 * because some PTY features will silently break. If probeTmux ever returns
 * `available: true` when the server reports `tmux: false`, the warning is
 * suppressed and the user is stranded debugging silent failures. These tests
 * pin down that contract by spinning up real HTTP servers.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { probeTmux } = require('../src/lib/orchestrator.js');

function startServer(handler) {
  const srv = http.createServer(handler);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({ srv, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe('probeTmux', () => {
  it('returns available:true when /health reports tmux:true', async () => {
    const { srv, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tmux: true, uptime: 1 }));
    });
    try {
      const result = await probeTmux(url);
      expect(result.available).toBe(true);
    } finally {
      srv.close();
    }
  });

  it('returns available:false when /health reports tmux:false', async () => {
    const { srv, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tmux: false, uptime: 1 }));
    });
    try {
      const result = await probeTmux(url);
      expect(result.available).toBe(false);
    } finally {
      srv.close();
    }
  });

  it('returns available:false on network failure (server unreachable)', async () => {
    // Port 1 is reserved, connections refused fast.
    const result = await probeTmux('http://127.0.0.1:1');
    expect(result.available).toBe(false);
  });

  it('returns available:false on non-2xx response', async () => {
    const { srv, url } = await startServer((_req, res) => {
      res.writeHead(500);
      res.end('boom');
    });
    try {
      const result = await probeTmux(url);
      expect(result.available).toBe(false);
    } finally {
      srv.close();
    }
  });

  it('does not throw on invalid JSON body', async () => {
    const { srv, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('<not json>');
    });
    try {
      const result = await probeTmux(url);
      expect(result.available).toBe(false);
    } finally {
      srv.close();
    }
  });
});
