import { homedir, hostname } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { logAlways, getVerbosity } from './logger';
import { startTunnel } from './tunnel';
import { loadSecurityPolicy } from './security-policy';

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

// ── Local HTTP server (healthcheck only) ──

const BIND_HOST = process.env['GATEWAY_BIND_HOST'] ?? '127.0.0.1';

Bun.serve({
  port: PORT,
  hostname: BIND_HOST,

  fetch(req) {
    const url = new URL(req.url);

    // Health check (no auth required — only returns non-sensitive info)
    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({
        ok: true,
        gatewayId: identity.id,
        gatewayName: GATEWAY_NAME,
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

const verbLabel = getVerbosity() >= 2 ? ' (debug)' : getVerbosity() >= 1 ? ' (verbose)' : '';
logAlways(`Host gateway listening on http://${BIND_HOST}:${PORT}${verbLabel}`);
logAlways(`Gateway ID: ${identity.id}`);
logAlways(`Gateway name: ${GATEWAY_NAME}`);

// ── Start tunnel (single authenticated channel for all communication) ──

if (CENTRAL_SERVER_URL) {
  startTunnel(CENTRAL_SERVER_URL, identity.id, identity.secret, GATEWAY_NAME);
} else {
  logAlways('[gateway] ASM_CENTRAL_URL not set — running in standalone mode (no tunnel)');
}
