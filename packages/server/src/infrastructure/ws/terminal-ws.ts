import type { FastifyInstance } from 'fastify';
import type { PtyHandle } from '@fleex/shared';
import { WS_TERMINAL_PATH, DEFAULT_COLS, DEFAULT_ROWS } from '@fleex/shared';
import type { Container } from '../container.js';

// Binary protocol constants (match shared ClientMessageType / ServerMessageType)
const CLIENT_ATTACH = 0x01;
const CLIENT_INPUT = 0x02;
const CLIENT_RESIZE = 0x03;
const CLIENT_DETACH = 0x04;

const SERVER_ATTACHED = 0x01;
const SERVER_OUTPUT = 0x02;
const SERVER_EXIT = 0x03;
const SERVER_ERROR = 0x04;

export function terminalWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    app.get(WS_TERMINAL_PATH, { websocket: true }, (socket) => {
      let ptyHandle: PtyHandle | null = null;
      container.logger.info('Terminal WebSocket connected');

      socket.on('message', async (raw: Buffer) => {
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);

        if (data.length === 0) return;

        const msgType = data[0];

        switch (msgType) {
          case CLIENT_ATTACH: {
            if (ptyHandle) {
              sendError(socket, 'Already attached to a session');
              return;
            }

            try {
              const payload = data.subarray(1);
              const { sessionId, cols, rows } = parseAttachPayload(payload);
              container.logger.info('Terminal ATTACH request', { sessionId, cols, rows });

              const session = await container.sessionStore.getById(sessionId);
              if (!session) {
                container.logger.warn('Session not found for attach', { sessionId });
                sendError(socket, `Session not found: ${sessionId}`);
                return;
              }

              session.markAttached();
              await container.sessionStore.save(session);

              container.logger.info('Spawning PTY for tmux attach', { tmuxName: session.tmuxName });
              const handle = container.pty.spawnAttach(session.tmuxName, { cols, rows });
              ptyHandle = handle;

              handle.onData((chunk: Buffer) => {
                // Guard: only the active PTY sends data
                if (ptyHandle !== handle) return;
                const msg = Buffer.allocUnsafe(1 + chunk.length);
                msg[0] = SERVER_OUTPUT;
                chunk.copy(msg, 1);
                socket.send(msg);
              });

              handle.onExit((exitCode: number) => {
                container.logger.info('PTY exited', { exitCode, tmuxName: session.tmuxName });
                // Guard: only the active PTY triggers exit notification.
                // A replaced PTY's onExit must NOT clobber the new ptyHandle.
                if (ptyHandle !== handle) return;
                const msg = Buffer.allocUnsafe(2);
                msg[0] = SERVER_EXIT;
                msg[1] = exitCode & 0xff;
                socket.send(msg);
                ptyHandle = null;
              });

              // Send ATTACHED confirmation
              socket.send(Buffer.from([SERVER_ATTACHED]));
              container.logger.info('Terminal ATTACHED confirmation sent', { sessionId });
            } catch (err) {
              container.logger.error('Terminal attach failed', { error: err instanceof Error ? err.message : String(err) });
              sendError(socket, err instanceof Error ? err.message : 'Attach failed');
            }
            break;
          }

          case CLIENT_INPUT: {
            if (ptyHandle?.isAlive) {
              ptyHandle.write(data.subarray(1).toString());
            }
            break;
          }

          case CLIENT_RESIZE: {
            if (ptyHandle?.isAlive && data.length >= 5) {
              const cols = data.readUInt16BE(1);
              const rows = data.readUInt16BE(3);
              ptyHandle.resize({ cols, rows });
            }
            break;
          }

          case CLIENT_DETACH: {
            if (ptyHandle) {
              ptyHandle.kill();
              ptyHandle = null;
            }
            break;
          }
        }
      });

      socket.on('close', () => {
        if (ptyHandle) {
          ptyHandle.kill();
          ptyHandle = null;
        }
      });
    });
  };
}

function parseAttachPayload(payload: Buffer): {
  sessionId: string;
  cols: number;
  rows: number;
} {
  // Format: <sessionId (null-terminated string)> <cols uint16 BE> <rows uint16 BE>
  const nullIdx = payload.indexOf(0x00);
  if (nullIdx === -1) {
    // Fallback: entire payload is sessionId, use defaults
    return {
      sessionId: payload.toString('utf-8'),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    };
  }

  const sessionId = payload.subarray(0, nullIdx).toString('utf-8');
  const rest = payload.subarray(nullIdx + 1);

  const cols = rest.length >= 2 ? rest.readUInt16BE(0) : DEFAULT_COLS;
  const rows = rest.length >= 4 ? rest.readUInt16BE(2) : DEFAULT_ROWS;

  return { sessionId, cols, rows };
}

function sendError(socket: { send(data: Buffer): void }, message: string): void {
  const msgBuf = Buffer.from(message, 'utf-8');
  const frame = Buffer.allocUnsafe(1 + msgBuf.length);
  frame[0] = SERVER_ERROR;
  msgBuf.copy(frame, 1);
  socket.send(frame);
}
