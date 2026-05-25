/**
 * Port allocation + health-check helpers for the bundled DMG.
 * Pure Node stdlib (no Electron import) so they're testable from vitest.
 */

const net = require('node:net');

/**
 * Ask the kernel for a free port by binding to :0 and immediately releasing it.
 * Same trick the CLI's `core/ports.ts` uses. There is an unavoidable TOCTOU
 * window (another process could grab the port before our child binds it) —
 * callers should treat the spawn as best-effort and surface bind failures.
 *
 * @returns {Promise<number>}
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('Could not determine free port'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Poll a URL until it returns 2xx, or `timeoutMs` elapses, or `isAliveFn()`
 * returns false (child died).
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {() => boolean} [opts.isAliveFn] — used to short-circuit when child crashes
 * @param {number} [opts.intervalMs] — defaults to 500
 * @param {number} [opts.timeoutMs] — defaults to 30000
 * @param {AbortSignal} [opts.signal] — abort early (e.g. on app quit)
 * @returns {Promise<boolean>}
 */
async function waitForHealthy({
  url,
  isAliveFn,
  intervalMs = 500,
  timeoutMs = 30000,
  signal,
} = {}) {
  if (!url) throw new Error('waitForHealthy: url is required');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) return false;
    if (isAliveFn && !isAliveFn()) return false;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), Math.min(2000, intervalMs * 4));
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.status >= 200 && res.status < 300) return true;
    } catch {
      // not ready yet
    }
    await sleep(intervalMs, signal);
  }
  return false;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    }
  });
}

module.exports = { findFreePort, waitForHealthy };
