import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Shared bearer token guarding every gateway route.
 *
 * The gateway is a remote shell: `/exec` runs arbitrary commands, `/fs` reads
 * and deletes arbitrary paths and `/pty` attaches live tmux sessions. Holding
 * this token is equivalent to a shell on the host, so it lives in a single
 * 0600 file under ~/.fleex, readable only by the user running Fleex.
 *
 * Unlike the hub's authorized-clients file (packages/event-hub/src/clients.ts)
 * the token is stored raw, not hashed: the CLI and the central server must be
 * able to read it back to authenticate. The security mechanics are otherwise
 * identical — sha256 + timingSafeEqual, fs.watch + poll fallback, hot
 * revocation. That duplication is deliberate: @fleex/shared is bundled for the
 * browser and cannot import node:fs.
 */

const FLEEX_HOME = process.env['FLEEX_HOME'] ?? path.join(os.homedir(), '.fleex');

export const GATEWAY_TOKEN_FILE =
  process.env['FLEEX_GATEWAY_TOKEN_FILE'] ?? path.join(FLEEX_HOME, 'gateway.token');

export const TOKEN_RE = /^[0-9a-f]{64}$/;

export function generateGatewayToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashGatewayToken(token: string): string {
  return 'sha256:' + createHash('sha256').update(token).digest('hex');
}

class MalformedTokenError extends Error {
  constructor(file: string) {
    super(
      `Gateway token file ${file} is malformed (expected 64 hex characters). ` +
        `Run 'fleex doctor --fix' to regenerate it.`,
    );
    this.name = 'MalformedTokenError';
  }
}

/** Read the token file. Returns null when absent, throws when unusable. */
function readTokenFile(file: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const token = raw.trim();
  if (!TOKEN_RE.test(token)) throw new MalformedTokenError(file);
  return token;
}

/**
 * Read the token file, creating it on first run.
 *
 * Written with flag 'wx' so two processes racing at boot (the gateway and the
 * server both starting under `bun run dev`) converge on a single token: the
 * loser gets EEXIST and reads back what the winner wrote.
 */
export function ensureGatewayToken(file: string = GATEWAY_TOKEN_FILE): string {
  const existing = readTokenFile(file);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const token = generateGatewayToken();
  try {
    fs.writeFileSync(file, token + '\n', { flag: 'wx', mode: 0o600 });
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const raced = readTokenFile(file);
      if (raced) return raced;
    }
    throw err;
  }
}

export interface TokenStoreOptions {
  /** GATEWAY_TOKEN. When set the store never touches the filesystem. */
  envToken?: string | undefined;
  /** Override the token file path (tests, containers). */
  file?: string;
}

/**
 * In-memory holder for the current token hash, with hot reload.
 *
 * Only the sha256 hash is kept, and comparison is constant-time on the hash
 * bytes — never on the raw tokens, whose differing lengths would both leak
 * information and make timingSafeEqual throw.
 */
export class TokenStore {
  private hash: string | null;
  private readonly envMode: boolean;
  private readonly file: string;
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onReloadCb: (() => void) | null = null;

  constructor(opts: TokenStoreOptions = {}) {
    this.file = opts.file ?? GATEWAY_TOKEN_FILE;
    const envToken = opts.envToken?.trim();
    if (envToken) {
      if (!TOKEN_RE.test(envToken)) {
        throw new Error('GATEWAY_TOKEN is malformed (expected 64 hex characters).');
      }
      this.envMode = true;
      this.hash = hashGatewayToken(envToken);
    } else {
      this.envMode = false;
      this.hash = hashGatewayToken(ensureGatewayToken(this.file));
    }
  }

  /**
   * Watch the token file and call `onReload` after every refresh. No-op when
   * the token came from the environment — there is nothing to watch.
   */
  startWatch(onReload: () => void): void {
    if (this.envMode) return;
    this.onReloadCb = onReload;

    try {
      // Watch the parent dir so creation/deletion also fires (atomic writes).
      const dir = path.dirname(this.file);
      const base = path.basename(this.file);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      this.watcher = fs.watch(dir, (_evt, filename) => {
        if (filename !== base) return;
        this.refresh();
      });
    } catch {
      // fs.watch can fail on some filesystems; the poll below covers it.
    }

    // Fallback for filesystems where fs.watch misses events (FUSE, overlay,
    // bind mounts in containers). Cheap: 64 bytes read + one sha256.
    const pollTimer = setInterval(() => this.refresh(), 2000);
    pollTimer.unref?.();
    this.pollTimer = pollTimer;
  }

  private refresh(): void {
    let fresh: string | null;
    try {
      const token = readTokenFile(this.file);
      fresh = token ? hashGatewayToken(token) : null;
    } catch {
      // Corrupted file: fail closed rather than keep honouring the old token.
      fresh = null;
    }
    if (fresh === this.hash) return;
    this.hash = fresh;
    this.onReloadCb?.();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Constant-time check of a raw bearer token against the current one. */
  verify(rawToken: string): boolean {
    if (!rawToken) return false;
    const reference = this.hash;
    if (!reference) return false;
    const incomingBuf = Buffer.from(hashGatewayToken(rawToken));
    const storedBuf = Buffer.from(reference);
    if (storedBuf.length !== incomingBuf.length) return false;
    return timingSafeEqual(storedBuf, incomingBuf);
  }

  /** True when a token is loaded. Diagnostics only — never exposes the value. */
  isConfigured(): boolean {
    return this.hash !== null;
  }
}
