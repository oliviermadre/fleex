// ── Tunnel-based adapters for ExecFn, ShellExecFn, HostFs ──
//
// These implement the same interfaces as remote.ts but route
// all operations through the gateway reverse-tunnel WebSocket.

import type { ExecFn, ShellExecFn, HostFs } from './types.js';
import type { GatewayTunnelManager } from './gateway-tunnel-manager.js';

export function tunnelExec(tunnel: GatewayTunnelManager, gatewayId: string | null = null): ExecFn {
  return async (command, args, options) => {
    const res = await tunnel.sendExecRequest(gatewayId, {
      command,
      args,
      cwd: options?.cwd,
      timeout: options?.timeout,
      maxBuffer: options?.maxBuffer,
    }, options?.timeout ?? 60_000);

    if (res.error) throw new Error(res.error);
    if (res.exitCode !== 0) {
      const err = new Error(res.stderr || `Command failed: ${command} ${args.join(' ')}`) as any;
      err.stdout = res.stdout;
      err.stderr = res.stderr;
      err.code = res.exitCode;
      throw err;
    }
    return { stdout: res.stdout, stderr: res.stderr };
  };
}

export function tunnelShellExec(tunnel: GatewayTunnelManager, gatewayId: string | null = null): ShellExecFn {
  return async (command, options) => {
    const res = await tunnel.sendExecRequest(gatewayId, {
      command,
      args: [],
      shell: true,
      cwd: options?.cwd,
      timeout: options?.timeout,
    }, options?.timeout ?? 60_000);

    if (res.error) throw new Error(res.error);
    return { stdout: res.stdout, stderr: res.stderr };
  };
}

export class TunnelHostFs implements HostFs {
  constructor(
    private readonly tunnel: GatewayTunnelManager,
    private readonly gatewayId: string | null = null,
  ) {}

  private async call(op: string, path: string, extra?: Record<string, unknown>): Promise<any> {
    const res = await this.tunnel.sendFsRequest(this.gatewayId, {
      op,
      path,
      ...extra,
    });
    if (res.error) throw new Error(res.error);
    return res.data;
  }

  async readFile(path: string): Promise<string> {
    const data = await this.call('read', path);
    return data.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.call('write', path, { content });
  }

  async appendFile(path: string, content: string): Promise<void> {
    await this.call('append', path, { content });
  }

  async readdir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    const data = await this.call('readdir', path);
    return data.entries;
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    return this.call('stat', path);
  }

  async exists(path: string): Promise<boolean> {
    const data = await this.call('exists', path);
    return data.exists;
  }

  async mkdir(path: string): Promise<void> {
    await this.call('mkdir', path);
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.call('rm', path, { recursive: options?.recursive ?? false });
  }

  async readTail(path: string, bytes: number): Promise<string> {
    const data = await this.call('readTail', path, { bytes });
    return data.content;
  }
}
