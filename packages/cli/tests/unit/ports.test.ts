import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstanceContext } from '../../src/core/instance.ts';
import { allocatePorts, loadPorts, retirePortsFile } from '../../src/core/ports.ts';

// The web UI persists its preferences in localStorage, which is scoped to the
// origin (localhost:<port>). An instance must therefore come back on the same
// ports after a stop/start, or every persisted preference silently resets.
describe('allocatePorts — stable ports across restarts', () => {
  let runDir: string;
  let ctx: InstanceContext;

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-ports-'));
    ctx = { portsFile: path.join(runDir, 'ports.json') } as InstanceContext;
  });

  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('allocates three distinct ports on a first start', async () => {
    const ports = await allocatePorts(ctx);
    expect(new Set([ports.gateway, ports.server, ports.web]).size).toBe(3);
    expect(loadPorts(ctx)).toEqual(ports);
  });

  it('reuses the previous ports once the instance has been stopped', async () => {
    const first = await allocatePorts(ctx);
    retirePortsFile(ctx.portsFile);
    expect(loadPorts(ctx)).toBeNull();

    expect(await allocatePorts(ctx)).toEqual(first);
  });

  it('reuses the ports of a run that ended without a stop (reboot, crash)', async () => {
    const first = await allocatePorts(ctx);
    // `fleex start` only allocates once it has checked nothing is running, so
    // a ports.json still present at that point is a stale leftover.
    expect(await allocatePorts(ctx)).toEqual(first);
  });

  it('prefers a stale ports file over older retired ports', async () => {
    await allocatePorts(ctx);
    retirePortsFile(ctx.portsFile);
    const stale = { gateway: await freePort(), server: await freePort(), web: await freePort() };
    fs.writeFileSync(ctx.portsFile, JSON.stringify(stale));

    expect(await allocatePorts(ctx)).toEqual(stale);
  });

  it.each(['127.0.0.1', '::1'])('moves only the service whose previous port is now taken on %s', async (host) => {
    const first = await allocatePorts(ctx);
    retirePortsFile(ctx.portsFile);
    const blocker = await listen(first.web, host);
    try {
      const second = await allocatePorts(ctx);
      expect(second.web).not.toBe(first.web);
      expect(second.gateway).toBe(first.gateway);
      expect(second.server).toBe(first.server);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it('retiring a missing ports file is a no-op', () => {
    expect(() => retirePortsFile(ctx.portsFile)).not.toThrow();
  });
});

async function freePort(): Promise<number> {
  const srv = await listen(0, '127.0.0.1');
  const { port } = srv.address() as net.AddressInfo;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function listen(port: number, host: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, host, () => resolve(srv));
  });
}
