import { homedir, hostname } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { handleExec } from './exec';
import { handleFs } from './fs';
import { handlePtyMessage, handlePtyOpen, handlePtyClose } from './pty';
import { logAlways, getVerbosity } from './logger';
import { startTunnel } from './tunnel';

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '3001', 10);
const CENTRAL_SERVER_URL = process.env['ASM_CENTRAL_URL'];
const GATEWAY_NAME = process.env['GATEWAY_NAME'] || hostname();

// ── Gateway identity (persisted in ~/.asm/gateway.json) ──

interface GatewayIdentity {
  id: string;
  secret: string;
}

const ASM_DIR = join(homedir(), '.asm');
const IDENTITY_FILE = join(ASM_DIR, 'gateway.json');

function loadOrCreateIdentity(): GatewayIdentity {
  if (existsSync(IDENTITY_FILE)) {
    try {
      return JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8'));
    } catch {
      // Corrupted — regenerate
    }
  }
  const identity: GatewayIdentity = {
    id: randomUUID(),
    secret: randomBytes(32).toString('hex'),
  };
  mkdirSync(ASM_DIR, { recursive: true });
  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
  console.log(`[gateway] Generated new identity: ${identity.id}`);
  return identity;
}

const identity = loadOrCreateIdentity();

// ── Central server registration ──

async function registerWithCentral(): Promise<void> {
  if (!CENTRAL_SERVER_URL) return;

  try {
    const res = await fetch(`${CENTRAL_SERVER_URL}/internal/gateways/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: identity.id,
        name: GATEWAY_NAME,
        hostname: hostname(),
        secret: identity.secret,
      }),
    });
    if (res.ok) {
      console.log(`[gateway] Registered with central server at ${CENTRAL_SERVER_URL}`);
    } else {
      console.error(`[gateway] Registration failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[gateway] Failed to reach central server: ${err}`);
  }
}

async function sendHeartbeat(): Promise<void> {
  if (!CENTRAL_SERVER_URL) return;

  try {
    await fetch(`${CENTRAL_SERVER_URL}/internal/gateways/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: identity.id,
        secret: identity.secret,
      }),
    });
  } catch {
    // Silent failure — central server may be temporarily unavailable
  }
}

// ── HTTP + WebSocket server ──

interface PtyWsData {
  initialized: boolean;
  proc: ReturnType<typeof Bun.spawn> | null;
  terminal: any;
}

Bun.serve<PtyWsData>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for /pty
    if (url.pathname === '/pty') {
      const ok = server.upgrade(req, {
        data: { initialized: false, proc: null, terminal: null },
      });
      return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({
        ok: true,
        homedir: homedir(),
        gatewayId: identity.id,
        gatewayName: GATEWAY_NAME,
      });
    }

    // Command execution
    if (url.pathname === '/exec' && req.method === 'POST') {
      try {
        const body = await req.json();
        const result = await handleExec(body);
        return Response.json(result);
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // Filesystem operations
    if (url.pathname === '/fs' && req.method === 'POST') {
      try {
        const body = await req.json();
        const result = await handleFs(body);
        return Response.json(result);
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      handlePtyOpen(ws);
    },
    message(ws, message) {
      handlePtyMessage(ws, message);
    },
    close(ws) {
      handlePtyClose(ws);
    },
  },
});

const verbLabel = getVerbosity() >= 2 ? ' (debug)' : getVerbosity() >= 1 ? ' (verbose)' : '';
logAlways(`Host gateway listening on http://localhost:${PORT}${verbLabel}`);
logAlways(`Gateway ID: ${identity.id}`);
logAlways(`Gateway name: ${GATEWAY_NAME}`);

// Register and start heartbeat + tunnel
registerWithCentral();
if (CENTRAL_SERVER_URL) {
  setInterval(sendHeartbeat, 30_000);

  // Start reverse tunnel for NAT traversal
  const enableTunnel = process.env['GATEWAY_TUNNEL'] !== 'false';
  if (enableTunnel) {
    startTunnel(CENTRAL_SERVER_URL, identity.id, identity.secret);
  }
}
