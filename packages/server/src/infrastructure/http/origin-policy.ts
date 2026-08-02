/**
 * Origin policy — decides which browser origins may talk to this server.
 *
 * The structuring rule is `Origin.host === Host`: a request is legitimate when
 * the origin it announces matches the host it reached us through. That is
 * self-configuring — localhost, a Tailscale MagicDNS name, or a custom reverse
 * proxy all work with zero configuration, while a page served from
 * `evil.tailnet.ts.net` is rejected (its Origin never matches the victim's Host).
 *
 * Pure functions, no Fastify dependency, so they can be unit-tested directly.
 */

/** Loopback hostnames, in every spelling a URL parser can hand us. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Origins we always accept: the local loopback, whatever the port. */
export function isLoopbackOrigin(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return LOOPBACK_HOSTNAMES.has(url.hostname);
}

/**
 * True when a bind address only accepts connections from this machine.
 * Used to decide whether startup should warn about network exposure.
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(host) || host.startsWith('127.');
}

/**
 * Parse `FLEEX_ALLOWED_ORIGINS="https://a.example,https://b.example"` into a
 * list of normalised exact origins. Unparsable entries are dropped.
 */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      // `new URL(...).origin` normalises case and drops default ports.
      const origin = new URL(trimmed).origin;
      if (origin !== 'null' && !out.includes(origin)) out.push(origin);
    } catch {
      /* not a URL — ignore rather than fail startup */
    }
  }
  return out;
}

export interface OriginCheck {
  /** The `Origin` request header, if any. */
  origin: string | undefined;
  /** The `Host` request header — NEVER `X-Forwarded-Host`, which is forgeable. */
  host: string | undefined;
  allowlist: string[];
}

export function isOriginAllowed({ origin, host, allowlist }: OriginCheck): boolean {
  // No Origin → non-browser client (CLI, MCP, hooks, agent SDK). Those carry no
  // ambient credentials, and no CORS header will be emitted for them anyway.
  if (!origin) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    // Includes the literal `null` origin (sandboxed iframe, `data:` document).
    return false;
  }

  // The structuring rule. `url.host` carries the port, so `localhost:5173`
  // reaching a server on `localhost:3000` falls through to the loopback rule
  // below rather than matching here.
  if (host && url.host === host) return true;

  if (isLoopbackOrigin(url)) return true;

  return allowlist.includes(url.origin);
}
