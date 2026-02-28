/**
 * Per-user tunnel adapter factory.
 *
 * Each user owns their own gateway(s). This registry resolves the
 * correct tunnel for a given userId and returns bound exec/fs/pty
 * adapters that route exclusively through that user's tunnel.
 *
 * This is the sole entry point for user-scoped gateway access.
 */

import type { ExecFn, ShellExecFn, HostFs } from './types.js';
import type { PtyPort } from '../../application/ports/pty.port.js';
import type { GatewayTunnel } from '../ws/gateway-tunnel-ws.js';
import { getTunnelForUser } from '../ws/gateway-tunnel-ws.js';
import { tunnelExec, tunnelShellExec, TunnelHostFs } from './tunnel-adapters.js';
import { TunnelPtyAdapter } from './tunnel-pty.adapter.js';

export interface UserGateway {
  readonly execFn: ExecFn;
  readonly shellExecFn: ShellExecFn;
  readonly hostFs: HostFs;
  readonly pty: PtyPort;
}

export class TunnelRegistry {
  /**
   * Get gateway adapters bound to a specific user's tunnel.
   * Throws if the user has no connected gateway.
   */
  forUser(userId: string): UserGateway {
    const getter = (): GatewayTunnel | null => getTunnelForUser(userId);
    return {
      execFn: tunnelExec(getter),
      shellExecFn: tunnelShellExec(getter),
      hostFs: new TunnelHostFs(getter),
      pty: new TunnelPtyAdapter(getter),
    };
  }
}
