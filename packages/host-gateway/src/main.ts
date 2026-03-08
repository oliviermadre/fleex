import { logAlways } from './logger';
import { loadIdentity } from './identity';
import { TunnelClient } from './tunnel-client';

const identity = loadIdentity();

if (!identity) {
  logAlways('No gateway identity found.');
  logAlways('Run the register script first, or set FLEEX_SERVER_URL and run:');
  logAlways('  bun run src/register.ts');
  process.exit(1);
}

logAlways('Gateway identity found, starting in tunnel mode');
logAlways(`  Gateway ID: ${identity.gatewayId}`);
logAlways(`  Server URL: ${identity.serverUrl}`);

const client = new TunnelClient(identity);
client.start();

// Graceful shutdown
process.on('SIGINT', () => {
  logAlways('Shutting down tunnel client...');
  client.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  logAlways('Shutting down tunnel client...');
  client.stop();
  process.exit(0);
});
