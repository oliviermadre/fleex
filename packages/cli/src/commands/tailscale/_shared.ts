import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FLEEX_HOME, resolveInstance } from '../../core/instance.ts';
import { loadPorts, stackNotRunningMessage } from '../../core/ports.ts';
import { c, die } from '../../core/colors.ts';

/** Ports Fleex exposes by default, matching the manual `tailscale serve` flow. */
export const DEFAULT_HTTPS_PORT = 443;
export const DEFAULT_HTTP_PORT = 80;

/** Result of shelling out to the `tailscale` binary. */
export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Exit code, or null when the binary could not be spawned at all. */
  code: number | null;
}

/** Run `tailscale <args>` and capture its output. Never throws. */
export function runTailscale(args: string[]): RunResult {
  const r = spawnSync('tailscale', args, { encoding: 'utf8' });
  if (r.error) {
    return { ok: false, stdout: '', stderr: (r.error as Error).message, code: null };
  }
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    code: r.status,
  };
}

/** True when the tailscale CLI is installed and callable. */
export function hasTailscale(): boolean {
  const r = spawnSync('tailscale', ['version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

/** High-level view of the local tailscaled backend. */
export interface TailscaleBackend {
  installed: boolean;
  /** Raw BackendState ("Running", "NeedsLogin", "Stopped", …). */
  state: string;
  running: boolean;
  /** This node's MagicDNS name (trailing dot stripped), or null. */
  dnsName: string | null;
  /** Tailnet display name, or null. */
  tailnet: string | null;
  /**
   * Whether HTTPS certificates look available for this tailnet (a MagicDNS
   * suffix is present). Best-effort: tailscale doesn't expose a definitive
   * "HTTPS enabled" flag in `status --json`.
   */
  httpsAvailable: boolean;
}

/** Inspect the local tailscaled backend via `tailscale status --json`. */
export function tailscaleBackend(): TailscaleBackend {
  if (!hasTailscale()) {
    return {
      installed: false,
      state: 'not-installed',
      running: false,
      dnsName: null,
      tailnet: null,
      httpsAvailable: false,
    };
  }
  const r = runTailscale(['status', '--json']);
  try {
    const j = JSON.parse(r.stdout) as {
      BackendState?: string;
      Self?: { DNSName?: string };
      CurrentTailnet?: { Name?: string; MagicDNSSuffix?: string };
      MagicDNSSuffix?: string;
    };
    const state = typeof j.BackendState === 'string' ? j.BackendState : 'unknown';
    const dnsRaw = j.Self?.DNSName ?? null;
    const dnsName = typeof dnsRaw === 'string' ? dnsRaw.replace(/\.$/, '') : null;
    const tailnet = j.CurrentTailnet?.Name ?? null;
    const magic = j.MagicDNSSuffix ?? j.CurrentTailnet?.MagicDNSSuffix ?? null;
    return {
      installed: true,
      state,
      running: state === 'Running',
      dnsName,
      tailnet,
      httpsAvailable: Boolean(magic),
    };
  } catch {
    return {
      installed: true,
      state: 'unknown',
      running: false,
      dnsName: null,
      tailnet: null,
      httpsAvailable: false,
    };
  }
}

/** A single port currently handled by `tailscale serve`. */
export interface ServeMapping {
  port: number;
  scheme: 'https' | 'http';
  /** Proxy backend, e.g. "http://127.0.0.1:12345", or null when unknown. */
  target: string | null;
}

/**
 * Parse the JSON emitted by `tailscale serve status --json` into mappings.
 *
 * Pure (no I/O) so the shape handling is unit-testable. Tolerant of empty
 * output, malformed JSON, and missing sections — always returns an array.
 */
export function parseServeStatus(raw: string): ServeMapping[] {
  if (!raw.trim()) return [];
  let j: {
    TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean }>;
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  };
  try {
    j = JSON.parse(raw);
  } catch {
    return [];
  }
  const tcp = j.TCP ?? {};
  const web = j.Web ?? {};
  const out: ServeMapping[] = [];
  for (const [hostPort, cfg] of Object.entries(web)) {
    const portStr = hostPort.split(':').pop();
    const port = Number(portStr);
    if (!Number.isFinite(port)) continue;
    const tcpCfg = tcp[String(port)];
    const scheme: 'https' | 'http' = tcpCfg?.HTTP && !tcpCfg?.HTTPS ? 'http' : 'https';
    const handlers = cfg.Handlers ?? {};
    const proxy = handlers['/']?.Proxy ?? Object.values(handlers)[0]?.Proxy ?? null;
    out.push({ port, scheme, target: typeof proxy === 'string' ? proxy : null });
  }
  return out.sort((a, b) => a.port - b.port);
}

/** Parse the current serve config from `tailscale serve status --json`. */
export function serveMappings(): ServeMapping[] {
  return parseServeStatus(runTailscale(['serve', 'status', '--json']).stdout);
}

/** A Fleex instance we can expose: its slug and web (Vite) port. */
export interface Target {
  slug: string;
  webPort: number;
  /** Proxy backend passed to `tailscale serve`. */
  proxyTarget: string;
}

/** Read the web port recorded for an instance slug under ~/.fleex/.run. */
function webPortForSlug(slug: string): number | null {
  const portsFile = path.join(FLEEX_HOME, '.run', slug, 'ports.json');
  if (!fs.existsSync(portsFile)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(portsFile, 'utf8')) as { web?: unknown };
    return typeof j.web === 'number' ? j.web : null;
  } catch {
    return null;
  }
}

/**
 * Resolve which instance to expose, or null when it can't be determined.
 *
 * With an explicit slug we read that instance's ports.json directly (so any
 * instance can be targeted regardless of the current git branch). Without one
 * we fall back to the workspace-resolved instance (honouring `--workspace` and
 * the default workspace), which for a typical checkout on `main` is
 * `default@main`.
 */
export function tryResolveTarget(slug?: string): Target | null {
  if (slug) {
    const webPort = webPortForSlug(slug);
    if (webPort === null) return null;
    return { slug, webPort, proxyTarget: `http://localhost:${webPort}` };
  }
  const ctx = resolveInstance();
  const ports = loadPorts(ctx);
  if (!ports) return null;
  return { slug: ctx.instanceSlug, webPort: ports.web, proxyTarget: `http://localhost:${ports.web}` };
}

/** Like {@link tryResolveTarget} but exits with a helpful message on failure. */
export function resolveTarget(slug?: string): Target {
  if (slug) {
    const target = tryResolveTarget(slug);
    if (!target) {
      die(
        `No web port recorded for instance '${slug}'.\n`
        + `It is either not running or unknown. List instances with:\n  fleex status`,
      );
    }
    return target;
  }
  const target = tryResolveTarget();
  if (!target) die(stackNotRunningMessage());
  return target;
}

/** Best-effort: is something LISTENING on this TCP port on the host? */
export function hostPortListeners(port: number): number[] {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  });
  if (r.status !== 0 || !r.stdout.trim()) return [];
  return r.stdout
    .split('\n')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/** Resolve when a TCP connection to localhost:port succeeds within `timeoutMs`. */
export function isLocalPortOpen(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

/** One line of a preflight report. */
export interface CheckItem {
  ok: boolean;
  /** true when this is a non-blocking warning rather than a hard failure. */
  warn: boolean;
  label: string;
  detail?: string;
}

export interface Preflight {
  backend: TailscaleBackend;
  target: Target;
  items: CheckItem[];
  /** True when a hard failure means `serve` cannot proceed (without --force). */
  blocked: boolean;
  existing: ServeMapping[];
}

/**
 * Verify that exposing `target` on the given ports is possible.
 *
 * Hard failures (block serving): tailscale not installed, backend not running,
 * the instance's web server not reachable. Everything else is a warning: no
 * HTTPS certs, a port already served (for our target = idempotent, for another
 * = would be replaced), or a host process already listening on the port.
 */
export async function preflight(
  target: Target,
  httpsPort: number | null,
  httpPort: number | null,
): Promise<Preflight> {
  const items: CheckItem[] = [];
  const backend = tailscaleBackend();
  let blocked = false;

  if (!backend.installed) {
    items.push({
      ok: false,
      warn: false,
      label: 'tailscale CLI installed',
      detail: 'not found in PATH — install it from https://tailscale.com/download',
    });
    // Nothing else is knowable without the binary.
    return { backend, target, items, blocked: true, existing: [] };
  }
  items.push({ ok: true, warn: false, label: 'tailscale CLI installed' });

  if (!backend.running) {
    blocked = true;
    items.push({
      ok: false,
      warn: false,
      label: 'tailscale backend running',
      detail: `state is '${backend.state}' — run: tailscale up`,
    });
  } else {
    items.push({
      ok: true,
      warn: false,
      label: 'tailscale backend running',
      detail: backend.dnsName ? `node: ${backend.dnsName}` : undefined,
    });
  }

  // Web server reachable — pointless to expose an instance that isn't up.
  const webOpen = await isLocalPortOpen(target.webPort);
  if (!webOpen) {
    blocked = true;
    items.push({
      ok: false,
      warn: false,
      label: `instance '${target.slug}' web server reachable`,
      detail: `nothing listening on localhost:${target.webPort} — start it with: fleex start`,
    });
  } else {
    items.push({
      ok: true,
      warn: false,
      label: `instance '${target.slug}' web server reachable`,
      detail: `localhost:${target.webPort}`,
    });
  }

  // HTTPS certificates (only relevant when we're asked to serve HTTPS).
  if (httpsPort !== null) {
    if (backend.running && !backend.httpsAvailable) {
      items.push({
        ok: false,
        warn: true,
        label: 'HTTPS certificates available',
        detail:
          'MagicDNS/HTTPS may be disabled — enable it in the admin console '
          + '(Tailscale → DNS → HTTPS Certificates)',
      });
    } else if (backend.running) {
      items.push({ ok: true, warn: false, label: 'HTTPS certificates available' });
    }
  }

  // Existing serve config + host listeners, per requested port.
  const existing = backend.running ? serveMappings() : [];
  const check = (port: number, scheme: 'https' | 'http') => {
    const mapped = existing.find((m) => m.port === port);
    if (mapped) {
      const mine = mapped.target === target.proxyTarget;
      items.push({
        ok: mine,
        warn: true,
        label: `port ${port} (${scheme}) free on tailscale serve`,
        detail: mine
          ? `already serving this instance (${mapped.target}) — serving is idempotent`
          : `already serving ${mapped.target ?? 'another target'} — serving will replace it`,
      });
    } else {
      items.push({ ok: true, warn: false, label: `port ${port} (${scheme}) free on tailscale serve` });
    }
    const listeners = hostPortListeners(port);
    if (listeners.length > 0) {
      items.push({
        ok: false,
        warn: true,
        label: `port ${port} free on host`,
        detail: `host process(es) listening: ${listeners.join(', ')} (informational — tailscale serve proxies via tailscaled)`,
      });
    } else {
      items.push({ ok: true, warn: false, label: `port ${port} free on host` });
    }
  };
  if (httpsPort !== null) check(httpsPort, 'https');
  if (httpPort !== null) check(httpPort, 'http');

  return { backend, target, items, blocked, existing };
}

/** Render preflight items as coloured ✓/✗/! lines to stdout. */
export function renderCheckItems(items: CheckItem[]): void {
  for (const it of items) {
    const mark = it.ok ? c.green('✓') : it.warn ? c.yellow('!') : c.red('✗');
    const label = it.ok ? it.label : it.warn ? c.yellow(it.label) : c.red(it.label);
    process.stdout.write(`  ${mark} ${label}\n`);
    if (it.detail) process.stdout.write(`      ${c.dim(it.detail)}\n`);
  }
}

/** Public URL for a served port, e.g. https://host.tailnet.ts.net (no :443). */
export function serveUrl(
  backend: TailscaleBackend,
  scheme: 'https' | 'http',
  port: number,
): string | null {
  if (!backend.dnsName) return null;
  const isDefault = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80);
  return `${scheme}://${backend.dnsName}${isDefault ? '' : `:${port}`}`;
}
