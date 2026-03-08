// ── Gateway Ed25519 Identity ──
//
// Generates or loads a persistent Ed25519 keypair from ~/.fleex/gateway-identity.json.
// Used to authenticate the gateway when connecting to the server tunnel.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logInfo } from './logger';

const FLEEX_DIR = join(homedir(), '.fleex');
const IDENTITY_FILE = join(FLEEX_DIR, 'gateway-identity.json');

export interface GatewayIdentity {
  readonly gatewayId: string;        // assigned by server after registration
  readonly publicKeyHex: string;     // Ed25519 public key (hex)
  readonly privateKeyHex: string;    // Ed25519 private key (hex)
  readonly serverUrl: string;        // URL of the fleex server to connect to
}

interface IdentityFile {
  gatewayId: string;
  publicKey: string;
  privateKey: string;
  serverUrl: string;
}

export function loadIdentity(): GatewayIdentity | null {
  if (!existsSync(IDENTITY_FILE)) {
    return null;
  }
  try {
    const raw = readFileSync(IDENTITY_FILE, 'utf-8');
    const data = JSON.parse(raw) as IdentityFile;
    if (!data.gatewayId || !data.publicKey || !data.privateKey || !data.serverUrl) {
      logInfo(`Identity file incomplete, ignoring: ${IDENTITY_FILE}`);
      return null;
    }
    return {
      gatewayId: data.gatewayId,
      publicKeyHex: data.publicKey,
      privateKeyHex: data.privateKey,
      serverUrl: data.serverUrl,
    };
  } catch (err) {
    logInfo(`Failed to load identity from ${IDENTITY_FILE}: ${err}`);
    return null;
  }
}

export function generateKeyPair(): { publicKeyHex: string; privateKeyHex: string } {
  // Ed25519 key generation using Node/Bun crypto
  const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  // Ed25519 raw public key is last 32 bytes of SPKI DER
  const pubRaw = (pubDer as Buffer).subarray(-32);
  // Ed25519 raw private key seed is last 32 bytes of PKCS8 DER
  const privRaw = (privDer as Buffer).subarray(-32);
  return {
    publicKeyHex: pubRaw.toString('hex'),
    privateKeyHex: privRaw.toString('hex'),
  };
}

export function saveIdentity(identity: GatewayIdentity): void {
  if (!existsSync(FLEEX_DIR)) {
    mkdirSync(FLEEX_DIR, { recursive: true });
  }
  const data: IdentityFile = {
    gatewayId: identity.gatewayId,
    publicKey: identity.publicKeyHex,
    privateKey: identity.privateKeyHex,
    serverUrl: identity.serverUrl,
  };
  writeFileSync(IDENTITY_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  logInfo(`Identity saved to ${IDENTITY_FILE}`);
}

export function signChallenge(privateKeyHex: string, challengeHex: string): string {
  const { sign, createPrivateKey } = require('node:crypto') as typeof import('node:crypto');
  const challenge = Buffer.from(challengeHex, 'hex');
  // Reconstruct DER-encoded PKCS8 for Ed25519 from raw 32-byte seed
  const seed = Buffer.from(privateKeyHex, 'hex');
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex'); // 16 bytes
  const pkcs8Der = Buffer.concat([pkcs8Prefix, seed]);
  const keyObject = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  const signature = sign(null, challenge, keyObject);
  return signature.toString('hex');
}
