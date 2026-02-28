import { homedir, hostname } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { handleExec } from './exec';
import { handleFs } from './fs';
import { handlePtyMessage, handlePtyOpen, handlePtyClose } from './pty';
import { logAlways, getVerbosity } from './logger';
import { startTunnel } from './tunnel';
import { loadSecurityPolicy } from './security-policy';

// Disable TLS certificate verification in development
if (process.env['GATEWAY_TLS_VERIFY'] === 'false') {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
}

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '3001', 10);
const CENTRAL_SERVER_URL = process.env['ASM_CENTRAL_URL'];
const GATEWAY_NAME = process.env['GATEWAY_NAME'] || hostname();
const REGISTRATION_TOKEN = process.env['GATEWAY_REGISTRATION_TOKEN'] ?? null;

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

// ── Load security policy ──
const securityPolicy = loadSecurityPolicy();
logAlways(`[security] Shell mode: ${securityPolicy.allowShellMode ? 'allowed' : 'blocked'}`);
logAlways(`[security] Write ops: ${securityPolicy.allowWriteOps ? 'allowed' : 'blocked'}`);
logAlways(`[security] Audit logging: ${securityPolicy.auditLog ? 'enabled' : 'disabled'}`);
if (securityPolicy.blockedPaths.length > 0) {
  logAlways(`[security] Blocked paths: ${securityPolicy.blockedPaths.length} entries`);
}
if (securityPolicy.blockedCommandPatterns.length > 0) {
  logAlways(`[security] Blocked command patterns: ${securityPolicy.blockedCommandPatterns.length} entries`);
}

// ── Central server registration ──

async function registerWithCentral(): Promise<void> {
  if (!CENTRAL_SERVER_URL) return;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (REGISTRATION_TOKEN) {
      headers['x-gateway-registration-token'] = REGISTRATION_TOKEN;
    }
    const res = await fetch(`${CENTRAL_SERVER_URL}/internal/gateways/register`, {
      method: 'POST',
      headers,
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

/**
 * Verify that direct HTTP requests to the gateway carry a valid
 * Bearer token matching the gateway secret. This prevents unauthorized
 * access from other processes or hosts on the same network.
 *
 * When GATEWAY_REQUIRE_AUTH=false (dev mode), this check is skipped.
 */
const REQUIRE_LOCAL_AUTH = process.env['GATEWAY_REQUIRE_AUTH'] !== 'false';

function verifyLocalAuth(req: Request): Response | null {
  if (!REQUIRE_LOCAL_AUTH) return null;

  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }
  const token = auth.slice(7);
  if (token !== identity.secret) {
    return Response.json({ error: 'Invalid credentials' }, { status: 403 });
  }
  return null; // Auth OK
}

interface PtyWsData {
  initialized: boolean;
  proc: ReturnType<typeof Bun.spawn> | null;
  terminal: any;
}

const BIND_HOST = process.env['GATEWAY_BIND_HOST'] ?? '127.0.0.1';

Bun.serve<PtyWsData>({
  port: PORT,
  hostname: BIND_HOST,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for /pty
    if (url.pathname === '/pty') {
      // Verify auth for PTY connections via query param
      if (REQUIRE_LOCAL_AUTH) {
        const token = url.searchParams.get('token');
        if (token !== identity.secret) {
          return new Response('Authentication required', { status: 401 });
        }
      }
      const ok = server.upgrade(req, {
        data: { initialized: false, proc: null, terminal: null },
      });
      return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Health check (no auth required — only returns non-sensitive info)
    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({
        ok: true,
        gatewayId: identity.id,
        gatewayName: GATEWAY_NAME,
      });
    }

    // Command execution
    if (url.pathname === '/exec' && req.method === 'POST') {
      const authErr = verifyLocalAuth(req);
      if (authErr) return authErr;
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
      const authErr = verifyLocalAuth(req);
      if (authErr) return authErr;
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
logAlways(`Host gateway listening on http://${BIND_HOST}:${PORT}${verbLabel}`);
logAlways(`[security] Local auth: ${REQUIRE_LOCAL_AUTH ? 'required' : 'disabled (dev mode)'}`);
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
