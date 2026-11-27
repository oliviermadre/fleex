/**
 * Who may open the companion's WebSocket.
 *
 * The Assistant now runs in `bypassPermissions`: whoever can send it a message
 * can run Bash on this machine. A browser lets any web page open a WebSocket to
 * `localhost` (WebSockets are not covered by CORS), so the upgrade is refused
 * unless the page's Origin is one of Fleex's own surfaces: the Chrome
 * extension, a local page (web app, desktop, Vite dev server) or the user's
 * tailnet (`*.ts.net`, the mobile app). Non-browser clients send no Origin.
 * `FLEEX_SIDEPANEL_ALLOWED_ORIGINS` (comma-separated origins) adds others.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isAllowedOrigin(origin: string | null, extra: string[] = envOrigins()): boolean {
  if (!origin) return true;
  if (extra.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === 'chrome-extension:') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (LOCAL_HOSTS.has(url.hostname)) return true;
  return url.protocol === 'https:' && url.hostname.endsWith('.ts.net');
}

function envOrigins(): string[] {
  return (process.env.FLEEX_SIDEPANEL_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
