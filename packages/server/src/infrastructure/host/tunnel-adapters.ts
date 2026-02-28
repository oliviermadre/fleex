/**
 * Exec and HostFs adapters that route through a GatewayTunnel
 * instead of making direct HTTP calls to the gateway.
 */

import type { ExecFn, ShellExecFn, HostFs } from './types.js';
import type { GatewayTunnel } from '../ws/gateway-tunnel-ws.js';

type TunnelGetter = () => GatewayTunnel | null;

function requireTunnel(getTunnel: TunnelGetter): GatewayTunnel {
  const tunnel = getTunnel();
  if (!tunnel) throw new Error('Gateway not connected');
  return tunnel;
}

export function tunnelExec(getTunnel: TunnelGetter): ExecFn {
  return async (command, args, options) => {
    const tunnel = requireTunnel(getTunnel);
    const res = await tunnel.send('POST', '/exec', {
      command,
      args,
      cwd: options?.cwd,
      timeout: options?.timeout,
      maxBuffer: options?.maxBuffer,
    });
    const body = res.body as { stdout: string; stderr: string; exitCode: number; error?: string };
    if (body?.error) throw new Error(body.error);
    if (body?.exitCode !== 0) {
      const err = new Error(body.stderr || `Command failed: ${command} ${args.join(' ')}`) as any;
      err.stdout = body.stdout;
      err.stderr = body.stderr;
      err.code = body.exitCode;
      throw err;
    }
    return { stdout: body.stdout, stderr: body.stderr };
  };
}

export function tunnelShellExec(getTunnel: TunnelGetter): ShellExecFn {
  return async (command, options) => {
    const tunnel = requireTunnel(getTunnel);
    const res = await tunnel.send('POST', '/exec', {
      command,
      args: [],
      shell: true,
      cwd: options?.cwd,
      timeout: options?.timeout,
    });
    const body = res.body as { stdout: string; stderr: string; exitCode: number; error?: string };
    if (body?.error) throw new Error(body.error);
    // Shell exec: don't throw on non-zero exit — callers handle stderr
    return { stdout: body.stdout, stderr: body.stderr };
  };
}

export class TunnelHostFs implements HostFs {
  constructor(private readonly getTunnel: TunnelGetter) {}

  private async call(body: Record<string, unknown>): Promise<any> {
    const tunnel = requireTunnel(this.getTunnel);
    const res = await tunnel.send('POST', '/fs', body);
    if (res.error) throw new Error(res.error);
    return res.body;
  }

  async readFile(path: string): Promise<string> {
    const data = await this.call({ op: 'read', path });
    return data.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.call({ op: 'write', path, content });
  }

  async readdir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    const data = await this.call({ op: 'readdir', path });
    return data.entries;
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    return this.call({ op: 'stat', path });
  }

  async exists(path: string): Promise<boolean> {
    const data = await this.call({ op: 'exists', path });
    return data.exists;
  }

  async mkdir(path: string): Promise<void> {
    await this.call({ op: 'mkdir', path });
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.call({ op: 'rm', path, recursive: options?.recursive ?? false });
  }

  async readTail(path: string, bytes: number): Promise<string> {
    const data = await this.call({ op: 'readTail', path, bytes });
    return data.content;
  }
}
