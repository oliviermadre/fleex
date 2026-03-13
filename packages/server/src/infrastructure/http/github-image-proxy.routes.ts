import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

/**
 * Proxy route for GitHub user-attachment images.
 * GitHub returns 404 for private-repo `user-attachments/assets/*` URLs
 * when the request lacks authentication cookies (cross-site, SameSite=Lax).
 * This route fetches the image server-side using the `gh` CLI token.
 */
export function githubImageProxyRoutes(container: Container) {
  let cachedToken: string | null = null;
  let tokenFetchedAt = 0;
  const TOKEN_TTL_MS = 5 * 60 * 1000; // cache token for 5 min

  async function getToken(): Promise<string> {
    if (cachedToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
      return cachedToken;
    }
    const { stdout } = await container.execFn('gh', ['auth', 'token'], { timeout: 5_000 });
    cachedToken = stdout.trim();
    tokenFetchedAt = Date.now();
    return cachedToken;
  }

  return async function (app: FastifyInstance) {
    app.get<{
      Params: { '*': string };
    }>('/api/github-image/*', async (req, reply) => {
      const path = (req.params as { '*': string })['*'];
      if (!path) {
        return reply.code(400).send({ error: 'Missing path' });
      }

      const url = `https://github.com/${path}`;

      // Only allow user-attachments URLs to prevent open-proxy abuse
      if (!path.startsWith('user-attachments/')) {
        return reply.code(403).send({ error: 'Only user-attachments URLs are allowed' });
      }

      try {
        const token = await getToken();
        const response = await fetch(url, {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'image/*',
          },
          redirect: 'follow',
        });

        if (!response.ok) {
          return reply.code(response.status).send({ error: `GitHub returned ${response.status}` });
        }

        const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
        const buffer = Buffer.from(await response.arrayBuffer());

        return reply
          .header('Content-Type', contentType)
          .header('Cache-Control', 'public, max-age=86400')
          .send(buffer);
      } catch (err) {
        container.logger.warn('GitHub image proxy failed', { url, error: String(err) });
        return reply.code(502).send({ error: 'Failed to fetch image' });
      }
    });
  };
}
