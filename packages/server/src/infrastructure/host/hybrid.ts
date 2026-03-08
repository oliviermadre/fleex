// ── Hybrid adapters: tunnel-first with HTTP fallback ──
//
// These adapters check if a gateway tunnel is connected at call time.
// If yes, they route through the tunnel. Otherwise, they fall back
// to the legacy HTTP-based remote adapters.

import type { ExecFn, ShellExecFn, HostFs } from './types.js';
import type { PtyPort } from '../../application/ports/pty.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { PtyHandle, TerminalDimensions } from '@fleex/shared';
import type { GatewayTunnelManager } from './gateway-tunnel-manager.js';
import { tunnelExec, tunnelShellExec, TunnelHostFs } from './tunnel.js';
import { TunnelPtyAdapter } from './tunnel-pty.adapter.js';

export function hybridExec(
  tunnel: GatewayTunnelManager,
  fallbackExec: ExecFn,
): ExecFn {
  const tExec = tunnelExec(tunnel);
  return async (command, args, options) => {
    if (tunnel.hasConnectedGateway) {
      return tExec(command, args, options);
    }
    return fallbackExec(command, args, options);
  };
}

export function hybridShellExec(
  tunnel: GatewayTunnelManager,
  fallbackShellExec: ShellExecFn,
): ShellExecFn {
  const tShellExec = tunnelShellExec(tunnel);
  return async (command, options) => {
    if (tunnel.hasConnectedGateway) {
      return tShellExec(command, options);
    }
    return fallbackShellExec(command, options);
  };
}

export class HybridHostFs implements HostFs {
  private readonly tunnelFs: TunnelHostFs;

  constructor(
    private readonly tunnel: GatewayTunnelManager,
    private readonly fallbackFs: HostFs,
  ) {
    this.tunnelFs = new TunnelHostFs(tunnel);
  }

  private get fs(): HostFs {
    return this.tunnel.hasConnectedGateway ? this.tunnelFs : this.fallbackFs;
  }

  readFile(path: string) { return this.fs.readFile(path); }
  writeFile(path: string, content: string) { return this.fs.writeFile(path, content); }
  appendFile(path: string, content: string) { return this.fs.appendFile(path, content); }
  readdir(path: string) { return this.fs.readdir(path); }
  stat(path: string) { return this.fs.stat(path); }
  exists(path: string) { return this.fs.exists(path); }
  mkdir(path: string) { return this.fs.mkdir(path); }
  rm(path: string, options?: { recursive?: boolean }) { return this.fs.rm(path, options); }
  readTail(path: string, bytes: number) { return this.fs.readTail(path, bytes); }
}

export class HybridPtyAdapter implements PtyPort {
  private readonly tunnelPty: TunnelPtyAdapter;

  constructor(
    private readonly tunnel: GatewayTunnelManager,
    private readonly fallbackPty: PtyPort,
    logger: LoggerPort,
  ) {
    this.tunnelPty = new TunnelPtyAdapter(tunnel, logger);
  }

  spawnAttach(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle {
    if (this.tunnel.hasConnectedGateway) {
      return this.tunnelPty.spawnAttach(tmuxSessionName, dims);
    }
    return this.fallbackPty.spawnAttach(tmuxSessionName, dims);
  }
}
