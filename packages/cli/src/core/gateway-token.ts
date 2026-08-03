import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { FLEEX_HOME } from './instance.ts';

/**
 * Shared bearer token for the host gateway.
 *
 * Machine-wide, not per instance: every gateway runs under the same UID with
 * the same powers (`/exec` is an unrestricted shell), so a token per instance
 * would add no isolation, only orphaned files.
 *
 * Stored raw rather than hashed (unlike hub.clients.json) because `fleex start`
 * must read it back to inject it into both the gateway and the server.
 */
export const GATEWAY_TOKEN_FILE =
  process.env.FLEEX_GATEWAY_TOKEN_FILE ?? path.join(FLEEX_HOME, 'gateway.token');

export const GATEWAY_TOKEN_RE = /^[0-9a-f]{64}$/;

export function generateGatewayToken(): string {
  return randomBytes(32).toString('hex');
}

export function writeGatewayToken(token: string): void {
  fs.mkdirSync(path.dirname(GATEWAY_TOKEN_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(GATEWAY_TOKEN_FILE, token + '\n', { mode: 0o600 });
  // writeFileSync only applies `mode` on creation — force it on rewrite too.
  fs.chmodSync(GATEWAY_TOKEN_FILE, 0o600);
}

/**
 * Read the token, creating it on first run.
 *
 * The 'wx' flag makes concurrent creators converge on a single token instead of
 * clobbering each other (`bun run dev` starts the gateway and the server at the
 * same time, and both provision).
 */
export function ensureGatewayToken(): string {
  const existing = readGatewayToken();
  if (existing) return existing;

  fs.mkdirSync(path.dirname(GATEWAY_TOKEN_FILE), { recursive: true, mode: 0o700 });
  const token = generateGatewayToken();
  try {
    fs.writeFileSync(GATEWAY_TOKEN_FILE, token + '\n', { flag: 'wx', mode: 0o600 });
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const raced = readGatewayToken();
      if (raced) return raced;
    }
    throw err;
  }
}

/** Returns the token, or null when the file is absent or unusable. */
export function readGatewayToken(): string | null {
  try {
    const token = fs.readFileSync(GATEWAY_TOKEN_FILE, 'utf8').trim();
    return GATEWAY_TOKEN_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

export type GatewayTokenState = 'ok' | 'missing' | 'malformed' | 'bad-perms';

export interface GatewayTokenReport {
  state: GatewayTokenState;
  /** Permission bits of the token file, when it exists. */
  mode?: number;
}

/** Diagnose the token file for `fleex doctor`. Never returns the token itself. */
export function inspectGatewayToken(): GatewayTokenReport {
  let raw: string;
  let mode: number;
  try {
    raw = fs.readFileSync(GATEWAY_TOKEN_FILE, 'utf8');
    mode = fs.statSync(GATEWAY_TOKEN_FILE).mode & 0o777;
  } catch {
    return { state: 'missing' };
  }
  if (!GATEWAY_TOKEN_RE.test(raw.trim())) return { state: 'malformed', mode };
  // Group/other must not be able to read a token worth a shell on this host.
  if (mode !== 0o600) return { state: 'bad-perms', mode };
  return { state: 'ok', mode };
}
