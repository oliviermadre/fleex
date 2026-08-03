import { WebSocket } from 'ws';
import type { PtyHandle, TerminalDimensions } from '@fleex/shared';
import type { PtyPort } from '../../application/ports/pty.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export class RemotePtyAdapter implements PtyPort {
  constructor(
    private readonly gatewayUrl: string,
    private readonly token: string,
    private readonly logger: LoggerPort,
  ) {}

  spawnAttach(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle {
    const wsUrl = this.gatewayUrl.replace(/^http/, 'ws') + '/pty';
    // The gateway authenticates the upgrade itself. `ws` (Node) can carry the
    // header — a browser cannot, which is exactly the point.
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.token}` } });

    let alive = true;
    const dataCallbacks: Array<(data: Buffer) => void> = [];
    const exitCallbacks: Array<(exitCode: number, signal: number) => void> = [];

    ws.on('open', () => {
      // Send JSON init message
      ws.send(JSON.stringify({
        tmuxSessionName,
        cols: dims.cols,
        rows: dims.rows,
      }));
    });

    ws.on('message', (data: Buffer | string, isBinary: boolean) => {
      if (isBinary || Buffer.isBuffer(data)) {
        // Binary frame: terminal output
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        for (const cb of dataCallbacks) {
          cb(buf);
        }
      } else {
        // JSON event from server
        try {
          const event = JSON.parse(String(data));
          if (event.type === 'exit') {
            alive = false;
            for (const cb of exitCallbacks) {
              cb(event.exitCode ?? 0, 0);
            }
          }
        } catch {
          // Ignore unparseable
        }
      }
    });

    ws.on('close', () => {
      if (alive) {
        alive = false;
        for (const cb of exitCallbacks) {
          cb(0, 0);
        }
      }
    });

    // A refused upgrade never reaches 'open': surface the status explicitly,
    // otherwise a 401 looks like a generic socket error. Bun does not implement
    // this event and warns when it is registered, so skip it there — under Bun
    // the 'error' handler below is what fires.
    if (!process.versions.bun) {
      ws.on('unexpected-response', (_req, res) => {
        this.logger.error('Remote PTY upgrade refused by the gateway', {
          status: res.statusCode,
          hint:
            res.statusCode === 401
              ? "Gateway rejected the token. Run 'fleex doctor' then 'fleex restart'."
              : undefined,
        });
      });
    }

    ws.on('error', (err) => {
      this.logger.error('Remote PTY WebSocket error', { error: String(err) });
      if (alive) {
        alive = false;
        for (const cb of exitCallbacks) {
          cb(1, 0);
        }
      }
    });

    return {
      write(data: string) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(Buffer.from(data, 'utf-8'));
        }
      },
      resize(d: TerminalDimensions) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: d.cols, rows: d.rows }));
        }
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
          ws.close();
        }
      },
      get isAlive() {
        return alive;
      },
    };
  }
}
