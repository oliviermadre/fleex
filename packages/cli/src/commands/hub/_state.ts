import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { FLEEX_HOME } from '../../core/instance.ts';

export interface HubState {
  pid: number;
  port: number;
  url: string;
  startedAt: number;
  logFile: string;
}

export const HUB_STATE_FILE = path.join(FLEEX_HOME, 'hub.json');
export const HUB_CLIENTS_FILE = path.join(FLEEX_HOME, 'hub.clients.json');
export const HUB_LOG_FILE = path.join(FLEEX_HOME, '.logs', 'event-hub.log');

export interface ClientEntry {
  name: string;
  tokenHash: string;
  createdAt: string;
}

export interface ClientsFile {
  version: 1;
  clients: ClientEntry[];
}

export function hashHubToken(token: string): string {
  return 'sha256:' + createHash('sha256').update(token).digest('hex');
}

export function generateHubToken(): string {
  return randomBytes(32).toString('hex');
}

export function readClientsFile(): ClientsFile {
  if (!fs.existsSync(HUB_CLIENTS_FILE)) return { version: 1, clients: [] };
  try {
    const raw = fs.readFileSync(HUB_CLIENTS_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (j && j.version === 1 && Array.isArray(j.clients)) return j as ClientsFile;
  } catch {
    /* fall through */
  }
  return { version: 1, clients: [] };
}

export function writeClientsFile(file: ClientsFile): void {
  fs.mkdirSync(path.dirname(HUB_CLIENTS_FILE), { recursive: true });
  // Write atomically so the hub's fs.watch sees a single coherent change.
  const tmp = HUB_CLIENTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, HUB_CLIENTS_FILE);
}

export function readHubState(): HubState | null {
  if (!fs.existsSync(HUB_STATE_FILE)) return null;
  try {
    const raw = fs.readFileSync(HUB_STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (
      typeof j.pid === 'number' &&
      typeof j.port === 'number' &&
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
  try {
    fs.unlinkSync(HUB_STATE_FILE);
  } catch {
    /* ignore */
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
