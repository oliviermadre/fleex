import type { FastifyInstance } from 'fastify';
import { WS_GATEWAY_TUNNEL_PATH } from '@fleex/shared';
import type { Container } from '../container.js';

export function gatewayTunnelWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    app.get(WS_GATEWAY_TUNNEL_PATH, { websocket: true }, (socket) => {
      container.logger.info('Gateway tunnel WebSocket connection received');

      if (!container.tunnelManager) {
        container.logger.warn('Tunnel manager not available, closing connection');
        socket.close();
        return;
      }

      container.tunnelManager.handleNewConnection(socket as any).catch((err) => {
        container.logger.error('Failed to handle gateway tunnel connection', { error: String(err) });
        socket.close();
      });
    });
  };
}
