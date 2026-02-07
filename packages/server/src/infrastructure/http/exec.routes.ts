import { exec } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

export function execRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.post<{ Body: { command: string } }>('/api/exec', async (request, reply) => {
      const { command } = request.body;
      if (!command || typeof command !== 'string') {
        return reply.code(400).send({ error: 'command is required' });
      }

      container.logger.info('Executing pinned action', { command });

      return new Promise((resolve) => {
        exec(command, { timeout: 10_000 }, (error, stdout, stderr) => {
          if (error) {
            resolve(reply.code(500).send({ error: error.message, stderr }));
          } else {
            resolve(reply.send({ stdout, stderr }));
          }
        });
      });
    });
  };
}
