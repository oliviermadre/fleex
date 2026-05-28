import net from 'node:net';
import fs from 'node:fs';
import { die } from './colors.ts';
import { resolveInstance, type InstanceContext } from './instance.ts';

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

export async function allocatePorts(ctx: InstanceContext = resolveInstance()): Promise<Ports> {
  const gateway = await findFreePort();
  const server = await findFreePort();
  const web = await findFreePort();
  const ports: Ports = { gateway, server, web };
  fs.writeFileSync(ctx.portsFile, JSON.stringify(ports));
  return ports;
}

export function writePorts(ports: Ports, ctx: InstanceContext = resolveInstance()): void {
  fs.writeFileSync(ctx.portsFile, JSON.stringify(ports));
}

export function loadPorts(ctx: InstanceContext = resolveInstance()): Ports | null {
  if (!fs.existsSync(ctx.portsFile)) return null;
  try {
    const raw = fs.readFileSync(ctx.portsFile, 'utf8');
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

/** Throws (exits) if no ports file is found. */
export function requirePorts(ctx: InstanceContext = resolveInstance()): Ports {
  const p = loadPorts(ctx);
  if (!p) die('Stack not running. Start it with: fleex start');
  return p;
}
