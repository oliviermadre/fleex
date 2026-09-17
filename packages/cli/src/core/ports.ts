import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { die } from './colors.ts';
import { resolveInstance, type InstanceContext } from './instance.ts';
import { defaultWorkspaceName } from './workspaces.ts';

export const SERVICES = ['gateway', 'server', 'web', 'desktop'] as const;
export type Service = (typeof SERVICES)[number];

export interface Ports {
  gateway: number;
  server: number;
  web: number;
}

/**
 * Bind to port 0 and let the kernel assign a free port, then close.
 * Mirrors the python socket trick used in the original bash script.
 *
 * Tries IPv6 first (dual-stack on most systems), falls back to IPv4 only
 * for environments without IPv6 (containers, CI sandboxes).
 */
export function findFreePort(): Promise<number> {
  const tryHost = (host: string | undefined) => new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    const cb = () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('Could not determine free port'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    };
    if (host === undefined) srv.listen(0, cb);
    else srv.listen(0, host, cb);
  });
  return tryHost(undefined).catch(() => tryHost('127.0.0.1'));
}

/**
 * Whether nothing listens on `port`. Every loopback flavour is probed: with
 * SO_REUSEADDR (set by Node on macOS) a wildcard bind still succeeds while
 * `::1` or `127.0.0.1` holds the port — and the web dev server binds `::1`.
 * A host the machine doesn't have (no IPv6) is skipped rather than failing.
 */
export async function isPortFree(port: number): Promise<boolean> {
  for (const host of [undefined, '127.0.0.1', '::1']) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.unref();
      srv.once('error', (err: NodeJS.ErrnoException) =>
        resolve(err.code !== 'EADDRINUSE' && err.code !== 'EACCES'),
      );
      srv.listen(port, host, () => srv.close(() => resolve(true)));
    });
    if (!free) return false;
  }
  return true;
}

/**
 * Pick the instance's ports, reusing the previous run's when still free. The
 * web UI keeps its preferences in localStorage, which is scoped to
 * `localhost:<port>` — a new web port on every start would reset them all.
 *
 * Callers allocate only once nothing is running, so a `ports.json` still present
 * is a leftover of a run that ended without `fleex stop` (reboot, crash) — the
 * most recent run, hence preferred over the retired ports.
 */
export async function allocatePorts(ctx: InstanceContext = resolveInstance()): Promise<Ports> {
  const previous = readPortsFile(ctx.portsFile) ?? readPortsFile(lastPortsFileFor(ctx.portsFile));
  const taken = new Set<number>();

  async function pick(last: number | undefined): Promise<number> {
    let port = last !== undefined && !taken.has(last) && (await isPortFree(last)) ? last : await findFreePort();
    // The kernel may hand back a port another service just reserved (not bound yet).
    while (taken.has(port)) port = await findFreePort();
    taken.add(port);
    return port;
  }

  const gateway = await pick(previous?.gateway);
  const server = await pick(previous?.server);
  const web = await pick(previous?.web);
  const ports: Ports = { gateway, server, web };
  fs.writeFileSync(ctx.portsFile, JSON.stringify(ports));
  return ports;
}

export function writePorts(ports: Ports, ctx: InstanceContext = resolveInstance()): void {
  fs.writeFileSync(ctx.portsFile, JSON.stringify(ports));
}

/** Where a stopped instance's ports are kept so the next start can reuse them. */
function lastPortsFileFor(portsFile: string): string {
  return path.join(path.dirname(portsFile), 'last-ports.json');
}

/**
 * On stop: `ports.json` must disappear (its presence means "running" to status,
 * desktop and hooks), but its ports are kept aside for the next start.
 */
export function retirePortsFile(portsFile: string): void {
  try {
    fs.renameSync(portsFile, lastPortsFileFor(portsFile));
  } catch {
    /* no ports file — nothing to keep */
  }
}

export function loadPorts(ctx: InstanceContext = resolveInstance()): Ports | null {
  return readPortsFile(ctx.portsFile);
}

function readPortsFile(file: string): Ports | null {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const j = JSON.parse(raw);
    if (
      typeof j.gateway === 'number' &&
      typeof j.server === 'number' &&
      typeof j.web === 'number'
    ) {
      return { gateway: j.gateway, server: j.server, web: j.web };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the "stack not running" error. It names the *exact* instance that was
 * looked up (workspace / branch / slug) so a mismatch is obvious, gives the
 * precise command to start that instance, and — when the workspace was picked
 * from an inherited `$FLEEX_WORKSPACE` rather than the configured default —
 * spells out how to target the default instead. This is what turns the old
 * opaque "Stack not running" into a self-explanatory diagnostic. Pure: returns
 * the string, the caller decides whether/how to print it.
 */
export function stackNotRunningMessage(ctx: InstanceContext = resolveInstance()): string {
  const { workspace, workspaceSource: source, branch, instanceSlug } = ctx;
  const lines: string[] = [];

  if (workspace) {
    lines.push(`Stack not running for workspace '${workspace}' (branch '${branch}', instance '${instanceSlug}').`);
  } else {
    lines.push(`Stack not running for branch '${branch}' (instance '${instanceSlug}').`);
  }

  const def = defaultWorkspaceName();
  // Plain `fleex start` resolves to the default workspace, so only add the flag
  // when the target isn't the default (otherwise the command would start a
  // *different* instance than the one reported missing).
  const startCmd =
    workspace && def !== workspace ? `fleex start --workspace ${workspace}` : 'fleex start';
  lines.push('', 'Start it with:', `  ${startCmd}`);

  // The likely footgun: a stale env var silently steered us to another instance.
  if (source === 'env' && def && def !== workspace) {
    lines.push(
      '',
      `Note: workspace '${workspace}' came from an inherited $FLEEX_WORKSPACE, not the default '${def}'.`,
      `To target the default instead: unset FLEEX_WORKSPACE   (or pass --workspace ${def})`,
    );
  }

  return lines.join('\n');
}

/** Throws (exits) if no ports file is found. */
export function requirePorts(ctx: InstanceContext = resolveInstance()): Ports {
  const p = loadPorts(ctx);
  if (!p) die(stackNotRunningMessage(ctx));
  return p;
}
