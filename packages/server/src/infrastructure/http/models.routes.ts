import type { FastifyInstance } from 'fastify';
import type { ModelService } from '../../application/services/model.service.js';

export function modelsRoutes(modelService: ModelService) {
  return async function (app: FastifyInstance) {
    app.get('/api/models', async () => {
      const { models, fallback } = await modelService.getAvailableModels();
      return { models, fallback };
    });
  };
}
