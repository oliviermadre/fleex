import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Authorized clients file — one entry per Fleex server instance allowed to
 * connect to this hub. Modelled after SSH's authorized_keys: tokens are stored
 * as sha256 hashes (the raw token is only shown once at provisioning time).
 *
 * Edited via the `fleex hub client add|list|revoke` CLI commands. The hub
 * watches the file for changes and disconnects sockets whose client entry was
 * revoked.
 */
export interface ClientEntry {
  name: string;
  tokenHash: string;    // "sha256:<hex>"
  createdAt: string;    // ISO-8601
}

export interface ClientsFile {
  version: 1;
  clients: ClientEntry[];
}

const HUB_HOME = process.env['FLEEX_HOME'] ?? path.join(os.homedir(), '.fleex');
export const CLIENTS_FILE = process.env['FLEEX_HUB_CLIENTS_FILE'] ?? path.join(HUB_HOME, 'hub.clients.json');

function readFileSafe(): ClientsFile {
  if (!fs.existsSync(CLIENTS_FILE)) return { version: 1, clients: [] };
  try {
    const raw = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (j && j.version === 1 && Array.isArray(j.clients)) return j as ClientsFile;
  } catch { /* fall through */ }
  return { version: 1, clients: [] };
}

export function hashToken(token: string): string {
  return 'sha256:' + createHash('sha256').update(token).digest('hex');
}

/**
 * In-memory cache of the clients file with hot-reload via fs.watch.
 *
 * Verification is constant-time on the hash bytes to avoid leaking which
 * prefix of the stored hash matched.
 */
export class ClientsStore {
  private cache: ClientsFile;
  private watcher: fs.FSWatcher | null = null;
  private onReloadCb: (() => void) | null = null;

  constructor() {
    this.cache = readFileSafe();
  }

  /** Start watching the clients file. Calls `onReload` after each refresh. */
  startWatch(onReload: () => void): void {
    this.onReloadCb = onReload;
    try {
      // Watch the parent dir so file creation/deletion also triggers (atomic writes).
      const dir = path.dirname(CLIENTS_FILE);
      const base = path.basename(CLIENTS_FILE);
      fs.mkdirSync(dir, { recursive: true });
      this.watcher = fs.watch(dir, (_evt, filename) => {
        if (filename !== base) return;
        this.cache = readFileSafe();
        this.onReloadCb?.();
      });
    } catch {
      // fs.watch can fail on some filesystems; fall back to polling.
    }

    // Belt-and-braces: poll every 2s as a fallback for filesystems where fs.watch
    // misses events (some FUSE/overlay/bind-mount setups, especially in containers).
    // Cheap: tiny file, JSON parse, no-op if unchanged.
    const pollTimer = setInterval(() => {
      const fresh = readFileSafe();
      if (this.serializeForCompare(fresh) !== this.serializeForCompare(this.cache)) {
        this.cache = fresh;
        this.onReloadCb?.();
      }
    }, 2000);
    pollTimer.unref?.();
    this.pollTimer = pollTimer;
  }

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private serializeForCompare(file: ClientsFile): string {
    return file.clients.map((c) => c.name + ':' + c.tokenHash).sort().join('|');
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Returns the matching client name, or null if the token is unknown. */
  verify(rawToken: string): string | null {
    if (!rawToken) return null;
    const incomingHash = hashToken(rawToken);
    const incomingBuf = Buffer.from(incomingHash);
    for (const entry of this.cache.clients) {
      const storedBuf = Buffer.from(entry.tokenHash);
      if (storedBuf.length !== incomingBuf.length) continue;
      if (timingSafeEqual(storedBuf, incomingBuf)) return entry.name;
    }
    return null;
  }

  /** Returns true if the named client is currently authorized. */
  has(name: string): boolean {
    return this.cache.clients.some((c) => c.name === name);
  }

  count(): number {
    return this.cache.clients.length;
  }
}
