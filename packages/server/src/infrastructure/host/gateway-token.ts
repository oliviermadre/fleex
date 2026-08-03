import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolve the shared bearer token used to reach the host gateway.
 *
 * Deliberate copy of packages/host-gateway/src/auth.ts: this module imports
 * node:fs, and @fleex/shared is bundled for the browser, so the two cannot be
 * factored together. Same reasoning as the existing
 * event-hub/clients.ts ↔ cli/commands/hub/_state.ts pair.
 */

const TOKEN_RE = /^[0-9a-f]{64}$/;

function tokenFilePath(): string {
  const explicit = process.env['FLEEX_GATEWAY_TOKEN_FILE'];
  if (explicit) return explicit;
  const home = process.env['FLEEX_HOME'] ?? path.join(os.homedir(), '.fleex');
  return path.join(home, 'gateway.token');
}

function readTokenFile(file: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const token = raw.trim();
  if (!TOKEN_RE.test(token)) {
    throw new Error(
      `Gateway token file ${file} is malformed (expected 64 hex characters). ` +
        `Run 'fleex doctor --fix' to regenerate it.`,
    );
  }
  return token;
}

/**
 * GATEWAY_TOKEN, else the token file, else create it.
 *
 * `fleex start` injects GATEWAY_TOKEN into both processes. Under a bare
 * `bun run dev` the server and the gateway race to create the file; the 'wx'
 * flag makes the loser read back the winner's token instead of overwriting it.
 */
export function resolveGatewayToken(): string {
  const fromEnv = process.env['GATEWAY_TOKEN']?.trim();
  if (fromEnv) {
    if (!TOKEN_RE.test(fromEnv)) {
      throw new Error('GATEWAY_TOKEN is malformed (expected 64 hex characters).');
    }
    return fromEnv;
  }

  const file = tokenFilePath();
  const existing = readTokenFile(file);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
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
