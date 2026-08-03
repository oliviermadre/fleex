import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import {
  TokenStore,
  ensureGatewayToken,
  generateGatewayToken,
  hashGatewayToken,
  TOKEN_RE,
} from '../src/auth';

let dir: string;
let tokenFile: string;
const stores: TokenStore[] = [];

/** Track a store so the watcher is always torn down, even on failure. */
function track(store: TokenStore): TokenStore {
  stores.push(store);
  return store;
}

/** Wait until `predicate` holds, or give up. Covers fs.watch + the 2s poll. */
async function eventually(predicate: () => boolean, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(50);
  }
  return predicate();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-gw-'));
  tokenFile = path.join(dir, 'gateway.token');
});

afterEach(() => {
  for (const store of stores.splice(0)) store.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ensureGatewayToken', () => {
  test('creates a 0600 file holding 64 hex characters', () => {
    const token = ensureGatewayToken(tokenFile);

    expect(token).toMatch(TOKEN_RE);
    expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(tokenFile, 'utf8').trim()).toBe(token);
  });

  test('reuses the existing token instead of rotating it', () => {
    // Rotating on every call would invalidate the token already handed to a
    // running server — `bun run dev` starts both processes independently.
    const first = ensureGatewayToken(tokenFile);
    const mtime = fs.statSync(tokenFile).mtimeMs;

    expect(ensureGatewayToken(tokenFile)).toBe(first);
    expect(fs.statSync(tokenFile).mtimeMs).toBe(mtime);
  });

  test('creates the parent directory when missing', () => {
    const nested = path.join(dir, 'nested', 'gateway.token');
    expect(ensureGatewayToken(nested)).toMatch(TOKEN_RE);
  });

  test('refuses a corrupted file rather than silently regenerating', () => {
    // Silently overwriting would mask a tampered or truncated file, and would
    // desync a server already holding the real token.
    fs.writeFileSync(tokenFile, 'nope\n');
    expect(() => ensureGatewayToken(tokenFile)).toThrow(/malformed/);
  });
});

describe('TokenStore.verify', () => {
  test('accepts the provisioned token and nothing else', () => {
    const token = ensureGatewayToken(tokenFile);
    const store = track(new TokenStore({ file: tokenFile }));

    expect(store.verify(token)).toBe(true);
    expect(store.isConfigured()).toBe(true);

    expect(store.verify('')).toBe(false);
    expect(store.verify(generateGatewayToken())).toBe(false);
    // A prefix must not pass: verification is on full sha256 hashes.
    expect(store.verify(token.slice(0, 32))).toBe(false);
    // The stored form is a hash — presenting it must not authenticate.
    expect(store.verify(hashGatewayToken(token))).toBe(false);
  });

  test('provisions the file when constructed without one', () => {
    const store = track(new TokenStore({ file: tokenFile }));
    const token = fs.readFileSync(tokenFile, 'utf8').trim();

    expect(store.verify(token)).toBe(true);
  });
});

describe('TokenStore in env mode', () => {
  test('verifies GATEWAY_TOKEN without ever touching the disk', () => {
    // A containerised gateway gets its token from the environment and may not
    // have a writable ~/.fleex at all.
    const token = generateGatewayToken();
    const store = track(new TokenStore({ envToken: token, file: tokenFile }));

    expect(store.verify(token)).toBe(true);
    expect(fs.existsSync(tokenFile)).toBe(false);
  });

  test('rejects a malformed GATEWAY_TOKEN at construction', () => {
    expect(() => new TokenStore({ envToken: 'not-a-token', file: tokenFile })).toThrow(
      /GATEWAY_TOKEN is malformed/,
    );
  });

  test('ignores file changes — nothing to hot reload', async () => {
    const token = generateGatewayToken();
    const store = track(new TokenStore({ envToken: token, file: tokenFile }));
    let reloaded = false;
    store.startWatch(() => {
      reloaded = true;
    });

    fs.writeFileSync(tokenFile, generateGatewayToken() + '\n', { mode: 0o600 });
    await Bun.sleep(2500);

    expect(reloaded).toBe(false);
    expect(store.verify(token)).toBe(true);
  });
});

describe('TokenStore hot reload', () => {
  test('rotation invalidates the previous token', async () => {
    const oldToken = ensureGatewayToken(tokenFile);
    const store = track(new TokenStore({ file: tokenFile }));
    let reloads = 0;
    store.startWatch(() => {
      reloads += 1;
    });

    const newToken = generateGatewayToken();
    fs.writeFileSync(tokenFile, newToken + '\n', { mode: 0o600 });

    expect(await eventually(() => store.verify(newToken))).toBe(true);
    expect(store.verify(oldToken)).toBe(false);
    expect(reloads).toBeGreaterThan(0);
  }, 10_000);

  test('deleting the file revokes every token', async () => {
    const token = ensureGatewayToken(tokenFile);
    const store = track(new TokenStore({ file: tokenFile }));
    store.startWatch(() => {});

    fs.rmSync(tokenFile);

    expect(await eventually(() => !store.isConfigured())).toBe(true);
    expect(store.verify(token)).toBe(false);
  }, 10_000);

  test('a corrupted file fails closed', async () => {
    const token = ensureGatewayToken(tokenFile);
    const store = track(new TokenStore({ file: tokenFile }));
    store.startWatch(() => {});

    fs.writeFileSync(tokenFile, 'garbage\n', { mode: 0o600 });

    expect(await eventually(() => !store.verify(token))).toBe(true);
    expect(store.isConfigured()).toBe(false);
  }, 10_000);
});
