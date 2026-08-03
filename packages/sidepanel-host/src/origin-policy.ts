/**
 * Origin policy for the companion host.
 *
 * Same structuring rule as the server (`Origin.host === Host`), plus the Chrome
 * side panel, which speaks from a `chrome-extension://` origin whose id is not
 * stable across dev reloads.
 *
 * No `Access-Control-Allow-Credentials`: the companion uses no cookie.
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const origin = new URL(trimmed).origin;
      if (origin !== 'null' && !out.includes(origin)) out.push(origin);
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function isOriginAllowed(
  origin: string | null,
  host: string | null,
  allowlist: string[],
): boolean {
  // Non-browser client.
  if (!origin) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  // The Chrome side panel. Its extension id changes on every unpacked reload,
  // so we trust the scheme rather than a specific id.
  if (url.protocol === 'chrome-extension:') return true;

  if (host && url.host === host) return true;

  if (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    LOOPBACK_HOSTNAMES.has(url.hostname)
  ) {
    return true;
  }

  return allowlist.includes(url.origin);
}

/**
 * CORS headers for a request — empty when the origin is refused, which makes
 * the browser drop the response.
 */
export function corsHeaders(
  req: Request,
  allowlist: string[] = parseAllowlist(process.env['FLEEX_ALLOWED_ORIGINS']),
): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!isOriginAllowed(origin, req.headers.get('host'), allowlist)) return {};

  // No Origin → non-browser client; no CORS header is needed at all.
  if (!origin) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/** True when the request must be refused outright (WebSocket upgrade). */
export function isRequestAllowed(
  req: Request,
  allowlist: string[] = parseAllowlist(process.env['FLEEX_ALLOWED_ORIGINS']),
): boolean {
  return isOriginAllowed(req.headers.get('origin'), req.headers.get('host'), allowlist);
}
