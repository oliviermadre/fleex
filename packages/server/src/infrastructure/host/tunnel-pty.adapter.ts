/**
 * PtyPort adapter that routes PTY sessions through a GatewayTunnel.
 *
 * Uses the tunnel's multiplexed binary PTY protocol (0x02/0x03 frames)
 * instead of a separate direct WebSocket to the gateway.
 */

import type { PtyHandle, TerminalDimensions } from '@asm/shared';
import type { PtyPort } from '../../application/ports/pty.port.js';
import type { GatewayTunnel } from '../ws/gateway-tunnel-ws.js';

export class TunnelPtyAdapter implements PtyPort {
  constructor(private readonly getTunnel: () => GatewayTunnel | null) {}

  spawnAttach(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle {
    const tunnel = this.getTunnel();
    if (!tunnel) throw new Error('Gateway not connected');
    return tunnel.openPty(tmuxSessionName, dims);
  }
}
