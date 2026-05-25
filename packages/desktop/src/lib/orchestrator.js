/**
 * Bundled-mode orchestrator. In a packaged .app the user has no terminal and
 * no `fleex` CLI — the Electron main process is responsible for:
 *
 *   1. Picking free ports for gateway + server (kernel-assigned)
 *   2. Spawning the bundled gateway binary and the bundled server (run on
 *      Electron's embedded Node.js, see ELECTRON_RUN_AS_NODE)
 *   3. Waiting for both /health endpoints to become 2xx
 *   4. Streaming child stdio to log files under ~/Library/Logs/Fleex
 *   5. Tearing everything down on app quit
 *
 * Kept in plain CommonJS so it can be loaded by `main.js` without a build step.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const { findFreePort, waitForHealthy } = require('./ports.js');
const { readEnvFile } = require('./env-file.js');

const FLEEX_HOME = process.env.FLEEX_HOME || path.join(os.homedir(), '.fleex');
const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'Fleex');

/**
 * Resolve paths to the bundled artifacts inside `Contents/Resources/`.
 * In dev (not-yet-packaged), falls back to source paths so `bun run dev:desktop`
 * keeps working.
 *
 * @param {object} env
 * @param {boolean} env.isPackaged
 * @param {string} env.resourcesPath — usually `process.resourcesPath`
 * @param {string} env.appRoot — repo root in dev
 */
function resolveBundlePaths({ isPackaged, resourcesPath, appRoot }) {
  if (isPackaged) {
    return {
      gatewayBin: path.join(resourcesPath, 'gateway'),
      serverEntry: path.join(resourcesPath, 'server', 'dist', 'main.js'),
      webDist: path.join(resourcesPath, 'web', 'dist'),
    };
  }
  // Dev: source tree
  return {
    gatewayBin: null, // dev uses `bun run dev:gateway` separately
    serverEntry: path.join(appRoot, 'packages', 'server', 'dist', 'main.js'),
    webDist: path.join(appRoot, 'packages', 'web', 'dist'),
  };
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function openLogStream(name) {
  ensureLogDir();
  return fs.openSync(path.join(LOG_DIR, `${name}.log`), 'a');
}

/**
 * Spawn the gateway standalone binary on `port`. Returns the ChildProcess.
 */
function spawnGateway({ gatewayBin, port, env = {} }) {
  if (!gatewayBin || !fs.existsSync(gatewayBin)) {
    throw new Error(`Gateway binary not found at ${gatewayBin}. Did the bundle build run?`);
  }
  const out = openLogStream('gateway');
  const child = spawn(gatewayBin, [], {
    env: { ...process.env, ...env, GATEWAY_PORT: String(port) },
    stdio: ['ignore', out, out],
  });
  return child;
}

/**
 * Spawn the Fleex server using Electron's bundled Node.js (ELECTRON_RUN_AS_NODE).
 * That way we don't have to ship a separate Node runtime.
 *
 * @param {object} opts
 * @param {string} opts.serverEntry  — path to compiled dist/main.js
 * @param {string} opts.electronBin  — process.execPath (Electron binary)
 * @param {number} opts.serverPort
 * @param {number} opts.gatewayPort
 * @param {Record<string,string>} [opts.env] — extra env (e.g. FLEEX_STORAGE_DRIVER)
 */
function spawnServer({ serverEntry, electronBin, serverPort, gatewayPort, env = {} }) {
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Server entry not found at ${serverEntry}. Did packages/server build run?`,
    );
  }
  const out = openLogStream('server');
  const child = spawn(electronBin, [serverEntry], {
    env: {
      ...process.env,
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(serverPort),
      HOST_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
      // Default to sqlite if nothing is configured — zero external-DB requirement.
      FLEEX_STORAGE_DRIVER:
        env.FLEEX_STORAGE_DRIVER || process.env.FLEEX_STORAGE_DRIVER || 'sqlite',
    },
    stdio: ['ignore', out, out],
  });
  return child;
}

/**
 * Best-effort shutdown of a child process. Sends SIGTERM, then SIGKILL after
 * `graceMs`.
 */
function shutdownChild(child, graceMs = 3000) {
  if (!child || child.killed || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('exit', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
      return;
    }
    setTimeout(() => {
      if (done) return;
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish();
    }, graceMs);
  });
}

/**
 * Full boot sequence used by the packaged .app:
 *   gateway → wait healthy → server → wait healthy → return URLs
 *
 * On any failure the partial state is cleaned up before re-throwing.
 *
 * @param {object} opts
 * @param {string} opts.gatewayBin
 * @param {string} opts.serverEntry
 * @param {string} opts.electronBin
 * @param {Record<string,string>} [opts.extraEnv]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.bootTimeoutMs]
 * @returns {Promise<{
 *   gateway: import('node:child_process').ChildProcess,
 *   server:  import('node:child_process').ChildProcess,
 *   gatewayPort: number,
 *   serverPort: number,
 *   serverUrl: string,
 * }>}
 */
async function bootStack({
  gatewayBin,
  serverEntry,
  electronBin,
  extraEnv = {},
  signal,
  bootTimeoutMs = 30000,
}) {
  const gatewayPort = await findFreePort();
  const serverPort = await findFreePort();

  // Merge persisted credentials so the server picks them up. We load these
  // here so a user can edit ~/.fleex/.env, restart Fleex, and changes apply.
  const persisted = readEnvFile(path.join(FLEEX_HOME, '.env'));
  const env = { ...persisted, ...extraEnv };

  const gateway = spawnGateway({ gatewayBin, port: gatewayPort, env });

  try {
    const gwOk = await waitForHealthy({
      url: `http://127.0.0.1:${gatewayPort}/health`,
      isAliveFn: () => gateway.exitCode === null,
      timeoutMs: bootTimeoutMs,
      signal,
    });
    if (!gwOk) {
      throw new Error(
        `Gateway did not become healthy within ${bootTimeoutMs}ms. See ${path.join(LOG_DIR, 'gateway.log')}`,
      );
    }
  } catch (err) {
    await shutdownChild(gateway);
    throw err;
  }

  const server = spawnServer({
    serverEntry,
    electronBin,
    serverPort,
    gatewayPort,
    env,
  });

  try {
    const srvOk = await waitForHealthy({
      url: `http://127.0.0.1:${serverPort}/health`,
      isAliveFn: () => server.exitCode === null,
      timeoutMs: bootTimeoutMs,
      signal,
    });
    if (!srvOk) {
      throw new Error(
        `Server did not become healthy within ${bootTimeoutMs}ms. See ${path.join(LOG_DIR, 'server.log')}`,
      );
    }
  } catch (err) {
    await shutdownChild(server);
    await shutdownChild(gateway);
    throw err;
  }

  return {
    gateway,
    server,
    gatewayPort,
    serverPort,
    serverUrl: `http://127.0.0.1:${serverPort}`,
  };
}

/**
 * Probe the running server for tmux availability — the server already exposes
 * `tmux: boolean` on `/health` via TmuxCliAdapter.isAvailable(). The orchestrator
 * surfaces it once at boot so the user can see "tmux missing" in the log file
 * even before they open the UI. Non-blocking: tmux-dependent features fail
 * gracefully in the server, the .app still boots.
 *
 * Spec ref: OQ-1 — "Détecter tmux au démarrage, afficher un warning contextuel
 * si absent." This is the detection half.
 *
 * @param {string} serverUrl
 * @returns {Promise<{ available: boolean }>}
 */
async function probeTmux(serverUrl) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${serverUrl}/health`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return { available: false };
    const body = await res.json();
    return { available: Boolean(body && body.tmux) };
  } catch {
    return { available: false };
  }
}

/**
 * Append a one-line message to the orchestrator log under LOG_DIR. Used to
 * record boot-time facts (tmux missing, ports chosen, etc.) without polluting
 * gateway.log / server.log.
 * @param {string} line
 */
function logOrchestrator(line) {
  try {
    ensureLogDir();
    fs.appendFileSync(
      path.join(LOG_DIR, 'orchestrator.log'),
      `[${new Date().toISOString()}] ${line}\n`,
    );
  } catch {
    // best-effort logging — never block boot on a logging failure
  }
}

module.exports = {
  resolveBundlePaths,
  spawnGateway,
  spawnServer,
  shutdownChild,
  bootStack,
  probeTmux,
  logOrchestrator,
  LOG_DIR,
  FLEEX_HOME,
};
