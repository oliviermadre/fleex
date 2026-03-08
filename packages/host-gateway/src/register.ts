// ── Gateway Registration Script ──
//
// Usage: bun run src/register.ts --server <url> --name <name>
//
// Generates an Ed25519 keypair, registers with the server,
// and saves the identity to ~/.fleex/gateway-identity.json.

import { generateKeyPair, saveIdentity, loadIdentity } from './identity';
import { logAlways, logError } from './logger';
import { hostname } from 'node:os';

async function main() {
  const args = process.argv.slice(2);
  let serverUrl = '';
  let name = hostname();

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--server' || args[i] === '-s') && args[i + 1]) {
      serverUrl = args[++i]!;
    } else if ((args[i] === '--name' || args[i] === '-n') && args[i + 1]) {
      name = args[++i]!;
    }
  }

  if (!serverUrl) {
    serverUrl = process.env['FLEEX_SERVER_URL'] ?? '';
  }

  if (!serverUrl) {
    logError('Usage: bun run src/register.ts --server <url> [--name <name>]');
    logError('  or set FLEEX_SERVER_URL env var');
    process.exit(1);
  }

  // Check for existing identity
  const existing = loadIdentity();
  if (existing) {
    logAlways(`Existing identity found: gateway=${existing.gatewayId}`);
    logAlways(`  Server: ${existing.serverUrl}`);
    logAlways(`  Public key: ${existing.publicKeyHex.substring(0, 16)}...`);
    logAlways('To re-register, remove ~/.fleex/gateway-identity.json first');
    process.exit(0);
  }

  // Generate keypair
  logAlways('Generating Ed25519 keypair...');
  const { publicKeyHex, privateKeyHex } = generateKeyPair();
  logAlways(`Public key: ${publicKeyHex.substring(0, 16)}...`);

  // Register with server
  const registerUrl = `${serverUrl.replace(/\/$/, '')}/api/gateways`;
  logAlways(`Registering with server: ${registerUrl}`);

  const res = await fetch(registerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      publicKey: publicKeyHex,
      hostname: hostname(),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logError(`Registration failed (${res.status}): ${body}`);
    process.exit(1);
  }

  const { id: gatewayId } = await res.json() as { id: string };
  logAlways(`Gateway registered: ${gatewayId}`);

  // Save identity
  saveIdentity({
    gatewayId,
    publicKeyHex,
    privateKeyHex,
    serverUrl: serverUrl.replace(/\/$/, ''),
  });

  logAlways('');
  logAlways('Registration complete! Start the gateway with: bun run src/main.ts');
  logAlways('The gateway will automatically connect to the server via tunnel.');
}

main().catch((err) => {
  logError('Registration failed:', err);
  process.exit(1);
});
