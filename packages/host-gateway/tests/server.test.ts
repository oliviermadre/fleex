import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { Server } from 'bun';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TokenStore, ensureGatewayToken, generateGatewayToken } from '../src/auth';
import { createGatewayServer } from '../src/server';
import type { PtyWsData } from '../src/pty';

let dir: string;
let tokenFile: string;
let token: string;
let store: TokenStore;
let server: Server<PtyWsData>;
let base: string;

const EVIL_ORIGIN = 'https://evil.example';

function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function start(opts: { hostname?: string } = {}): void {
  server = createGatewayServer({
    port: 0,
    hostname: opts.hostname ?? '127.0.0.1',
    tokenStore: store,
  });
  base = `http://127.0.0.1:${server.port}`;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-gw-srv-'));
  tokenFile = path.join(dir, 'gateway.token');
  token = ensureGatewayToken(tokenFile);
  store = new TokenStore({ file: tokenFile });
});

afterEach(() => {
  server?.stop(true);
  store?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('bind address', () => {
  test('binds loopback by default — a shell endpoint must not face the LAN', () => {
    start();
    expect(server.hostname).toBe('127.0.0.1');
  });

  test('honours an explicit opt-out via GATEWAY_BIND', () => {
    start({ hostname: '0.0.0.0' });
    expect(server.hostname).toBe('0.0.0.0');
  });
});

describe('authentication', () => {
  test('POST /exec without a token is rejected before any command runs', async () => {
    start();
    const res = await fetch(`${base}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'id', args: [] }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  test('POST /exec with a wrong token is rejected', async () => {
    start();
    const res = await fetch(`${base}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: JSON.stringify({ command: 'id', args: [] }),
    });

    expect(res.status).toBe(401);
  });

  test('POST /exec with a valid token still executes', async () => {
    start();
    const res = await fetch(`${base}/exec`, {
      method: 'POST',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ command: 'echo', args: ['hello'] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { stdout: string; exitCode: number };
    expect(body.exitCode).toBe(0);
    expect(body.stdout.trim()).toBe('hello');
  });

  test('POST /fs without a token is rejected', async () => {
    start();
    const res = await fetch(`${base}/fs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'read', path: tokenFile }),
    });

    expect(res.status).toBe(401);
  });

  test('POST /fs with a valid token still works', async () => {
    start();
    const res = await fetch(`${base}/fs`, {
      method: 'POST',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ op: 'exists', path: dir }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: true });
  });

  test('an unknown route is denied by default, not 404-ed', async () => {
    // Default-deny: a route added later inherits authentication for free.
    start();
    const res = await fetch(`${base}/whatever`);
    expect(res.status).toBe(401);

    const authed = await fetch(`${base}/whatever`, { headers: auth() });
    expect(authed.status).toBe(404);
  });

  test('the Bearer scheme is matched case-insensitively', async () => {
    start();
    const res = await fetch(`${base}/fs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `bearer ${token}` },
      body: JSON.stringify({ op: 'exists', path: dir }),
    });

    expect(res.status).toBe(200);
  });
});

describe('origin filtering', () => {
  test('a request carrying Origin is refused even with a valid token', async () => {
    // Only a browser sends Origin. The legitimate client is a Node process.
    start();
    const res = await fetch(`${base}/exec`, {
      method: 'POST',
      headers: auth({ 'Content-Type': 'application/json', Origin: EVIL_ORIGIN }),
      body: JSON.stringify({ command: 'id', args: [] }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin' });
  });

  test('Origin is refused on /health too', async () => {
    start();
    const res = await fetch(`${base}/health`, { headers: { Origin: EVIL_ORIGIN } });
    expect(res.status).toBe(403);
  });

  test('Origin is refused on the /pty upgrade', async () => {
    // This is the vector that matters: a page cannot set Authorization on a
    // WebSocket, but the browser always stamps Origin on the handshake.
    start();
    const res = await fetch(`${base}/pty`, {
      headers: {
        Origin: EVIL_ORIGIN,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });

    expect(res.status).toBe(403);
  });
});

describe('GET /health', () => {
  test('answers unauthenticated but discloses nothing about the host', async () => {
    // `fleex start` and `fleex doctor` probe it before holding a token.
    start();
    const res = await fetch(`${base}/health`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty('homedir');
    expect(body).not.toHaveProperty('authenticated');
  });

  test('discloses host details once authenticated', async () => {
    start();
    const res = await fetch(`${base}/health`, { headers: auth() });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.authenticated).toBe(true);
    expect(body.homedir).toBe(os.homedir());
  });
});

describe('/pty upgrade', () => {
  test('is refused without a token, before the socket is upgraded', async () => {
    start();
    const res = await fetch(`${base}/pty`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });

    expect(res.status).toBe(401);
  });

  test('is refused with a wrong token', async () => {
    start();
    const opened = await tryOpenSocket(`Bearer ${generateGatewayToken()}`);
    expect(opened).toBe(false);
  });

  test('succeeds with a valid token', async () => {
    // Stop at the handshake — sending the init message would spawn a real
    // `tmux attach`.
    start();
    const opened = await tryOpenSocket(`Bearer ${token}`);
    expect(opened).toBe(true);
  });
});

describe('revocation', () => {
  test('deleting the token file closes live PTY sockets', async () => {
    start();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/pty`, {
      headers: { Authorization: `Bearer ${token}` },
    } as unknown as string[]);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('upgrade failed')), { once: true });
    });

    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (ev) => resolve(ev.code), { once: true });
    });
    fs.rmSync(tokenFile);

    expect(await closed).toBe(4401);
  }, 10_000);
});

/** Resolves true if the WebSocket handshake succeeds. */
function tryOpenSocket(authorization: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/pty`, {
      headers: { Authorization: authorization },
    } as unknown as string[]);
    ws.addEventListener(
      'open',
      () => {
        resolve(true);
        ws.close();
      },
      { once: true },
    );
    ws.addEventListener('error', () => resolve(false), { once: true });
    // Closed without ever opening — the upgrade was refused.
    ws.addEventListener('close', () => resolve(false), { once: true });
  });
}
