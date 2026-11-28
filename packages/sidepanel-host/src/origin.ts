/**
 * Who may open the companion's WebSocket.
 *
 * The Assistant runs in `bypassPermissions`: whoever can send it a message can
 * run Bash on this machine. Two layers keep it to the user's own surfaces:
 *
 * 1. The server listens on loopback only (`LISTEN_HOSTNAME`), so nothing on the
 *    LAN or the tailnet reaches it directly. The phone goes through the Vite
 *    proxy or `tailscale serve`, both of which connect from localhost.
 * 2. A browser lets any web page open a WebSocket to `localhost` (WebSockets are
 *    not covered by CORS), so the upgrade is refused unless the page's Origin is
 *    one of Fleex's own surfaces: a local page (web app, desktop, Vite dev
 *    server), THIS machine's tailnet name (the mobile app — never any
 *    `*.ts.net`: anyone can publish a public `*.ts.net` site with Funnel), or
 *    the Chrome extension.
 *
 * Non-browser clients send no Origin; layer 1 limits them to local processes,
 * which already run with the user's rights.
 *
 * `FLEEX_SIDEPANEL_ALLOWED_ORIGINS` (comma-separated origins) adds others. When
 * it lists at least one `chrome-extension://<id>`, only those extensions are
 * accepted; otherwise any extension is (the Fleex extension is loaded unpacked
 * and has no stable id yet).
 */
import { tailscaleBackend } from '@fleex/cli/tailscale';

export const LISTEN_HOSTNAME = '127.0.0.1';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isAllowedOrigin(
  origin: string | null,
  extra: string[] = envOrigins(),
  selfTailnetHost: () => string | null = tailnetSelfHost,
): boolean {
  if (!origin) return true;
  if (extra.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === 'chrome-extension:') {
    return !extra.some((o) => o.startsWith('chrome-extension://'));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (LOCAL_HOSTS.has(url.hostname)) return true;
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net')) return false;
  const self = selfTailnetHost();
  return self !== null && url.hostname === self.toLowerCase();
}

function envOrigins(): string[] {
  return (process.env.FLEEX_SIDEPANEL_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// `tailscale status --json` spawns a process: remember the answer, and retry a
// miss at most once a minute (tailscale may come up after the companion).
const RETRY_MS = 60_000;
let cached: { host: string | null; at: number } | null = null;

function tailnetSelfHost(): string | null {
  const now = Date.now();
  if (cached && (cached.host !== null || now - cached.at < RETRY_MS)) return cached.host;
  const backend = tailscaleBackend();
  cached = { host: backend.running ? backend.dnsName : null, at: now };
  return cached.host;
}
