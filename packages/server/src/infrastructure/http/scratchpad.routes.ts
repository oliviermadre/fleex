import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

const SCRATCHPAD_DIR = '.asm';
const SCRATCHPAD_FILE = 'scratchpad.md';

export function scratchpadRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { hostFs, hostHomedir } = container;
    const dirPath = join(hostHomedir, SCRATCHPAD_DIR);
    const filePath = join(dirPath, SCRATCHPAD_FILE);

    /**
     * GET /api/scratchpad
     * Returns the markdown content of the scratchpad file.
     */
    app.get('/api/scratchpad', async (_request, reply) => {
      if (!(await hostFs.exists(filePath))) {
        return { content: '' };
      }
      const content = await hostFs.readFile(filePath);
      return { content };
    });

    /**
     * PUT /api/scratchpad
     * Saves markdown content to the scratchpad file.
     */
    app.put<{ Body: { content: string } }>('/api/scratchpad', async (request, reply) => {
      const { content } = request.body;

      if (!(await hostFs.exists(dirPath))) {
        await hostFs.mkdir(dirPath);
      }

      await hostFs.writeFile(filePath, content);
      return { ok: true };
    });
  };
}
