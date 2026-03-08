import type { PtyHandle, TerminalDimensions } from '@fleex/shared';
import type { PtyPort } from '../../application/ports/pty.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { GatewayTunnelManager } from './gateway-tunnel-manager.js';

export class TunnelPtyAdapter implements PtyPort {
  constructor(
    private readonly tunnel: GatewayTunnelManager,
    private readonly logger: LoggerPort,
    private readonly gatewayId: string | null = null,
  ) {}

  spawnAttach(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle {
    const channel = this.tunnel.openPtyChannel(
      this.gatewayId,
      tmuxSessionName,
      dims.cols,
      dims.rows,
    );

    let alive = true;
    const dataCallbacks: Array<(data: Buffer) => void> = [];
    const exitCallbacks: Array<(exitCode: number, signal: number) => void> = [];

    channel.onData((data) => {
      for (const cb of dataCallbacks) {
        cb(data);
      }
    });

    channel.onExit((exitCode) => {
      alive = false;
      for (const cb of exitCallbacks) {
        cb(exitCode, 0);
      }
    });

    // Fire-and-forget the open promise; errors handled via PTY_ERROR
    channel.openPromise.catch((err) => {
      this.logger.error('PTY open failed via tunnel', { error: String(err) });
      alive = false;
      for (const cb of exitCallbacks) {
        cb(1, 0);
      }
    });

    return {
      write(data: string) {
        channel.write(data);
      },
      resize(d: TerminalDimensions) {
        channel.resize(d.cols, d.rows);
      },
      onData(cb: (data: Buffer) => void) {
        dataCallbacks.push(cb);
      },
      onExit(cb: (exitCode: number, signal: number) => void) {
        exitCallbacks.push(cb);
      },
      kill() {
        if (alive) {
          alive = false;
          channel.close();
        }
      },
      get isAlive() {
        return alive;
      },
    };
  }
}
