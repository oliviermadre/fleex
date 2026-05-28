import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { FLEEX_HOME } from '../../core/instance.ts';

export interface HubState {
  pid: number;
  port: number;
  token: string;
  url: string;
  startedAt: number;
  logFile: string;
}

export const HUB_STATE_FILE = path.join(FLEEX_HOME, 'hub.json');
export const HUB_TOKEN_FILE = path.join(FLEEX_HOME, 'hub.token');
export const HUB_LOG_FILE = path.join(FLEEX_HOME, '.logs', 'event-hub.log');

export function readHubState(): HubState | null {
  if (!fs.existsSync(HUB_STATE_FILE)) return null;
  try {
    const raw = fs.readFileSync(HUB_STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (
      typeof j.pid === 'number' &&
      typeof j.port === 'number' &&
      typeof j.token === 'string' &&
      typeof j.url === 'string' &&
      typeof j.startedAt === 'number' &&
      typeof j.logFile === 'string'
    ) {
      return j as HubState;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeHubState(state: HubState): void {
  fs.mkdirSync(path.dirname(HUB_STATE_FILE), { recursive: true });
  fs.writeFileSync(HUB_STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearHubState(): void {
  try { fs.unlinkSync(HUB_STATE_FILE); } catch { /* ignore */ }
}

/**
 * Persistent token: generated once and reused across hub restarts so already-running
 * Fleex servers (which hold the token in their env) don't get 401'd on reconnect.
 *
 * Lookup order:
 *   1. explicit override (e.g. --token CLI flag)
 *   2. ~/.fleex/hub.token (created on first run, 0600 permissions)
 *   3. generate a fresh one and persist it
 */
export function resolveHubToken(opts: { override?: string; rotate?: boolean } = {}): string {
  if (opts.override) {
    persistHubToken(opts.override);
    return opts.override;
  }
  if (!opts.rotate && fs.existsSync(HUB_TOKEN_FILE)) {
    try {
      const t = fs.readFileSync(HUB_TOKEN_FILE, 'utf8').trim();
      if (t.length > 0) return t;
    } catch { /* fall through to regenerate */ }
  }
  const fresh = randomBytes(16).toString('hex');
  persistHubToken(fresh);
  return fresh;
}

function persistHubToken(token: string): void {
  fs.mkdirSync(path.dirname(HUB_TOKEN_FILE), { recursive: true });
  fs.writeFileSync(HUB_TOKEN_FILE, token, { mode: 0o600 });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
