import fs from 'node:fs';
import path from 'node:path';
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

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
