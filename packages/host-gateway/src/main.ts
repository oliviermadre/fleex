import { userInfo } from 'node:os';

import { TokenStore } from './auth';
import { logAlways, logError, getVerbosity } from './logger';
import { createGatewayServer } from './server';

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '3001', 10);
const HOSTNAME = process.env['GATEWAY_BIND'] ?? '127.0.0.1';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];

/** Fail closed: no token means no gateway, never an unauthenticated one. */
function createTokenStore(): TokenStore {
  try {
    return new TokenStore({ envToken: process.env['GATEWAY_TOKEN'] });
  } catch (err) {
    logError(
      `Host gateway refusing to start — cannot provision the shared token: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

const tokenStore = createTokenStore();

if (!LOOPBACK.includes(HOSTNAME)) {
  logAlways(
    `⚠  GATEWAY_BIND=${HOSTNAME} — the gateway is reachable beyond loopback. ` +
      `/exec runs arbitrary shell commands as ${userInfo().username}.`,
  );
}

createGatewayServer({ port: PORT, hostname: HOSTNAME, tokenStore });

const verbLabel = getVerbosity() >= 2 ? ' (debug)' : getVerbosity() >= 1 ? ' (verbose)' : '';
logAlways(`Host gateway listening on http://${HOSTNAME}:${PORT}${verbLabel}`);
