/**
 * Security wiring — helmet, CORS and the cross-site request guard.
 *
 * Applied before any route so the guard also covers `/auth/*` and `/api/hook`,
 * which sit outside the auth `preHandler`.
 */
import cors, { type FastifyCorsOptions } from '@fastify/cors';
import helmet from '@fastify/helmet';

import { isOriginAllowed, parseAllowlist } from './origin-policy.js';
import { evaluateRequest, hasBearerToken, isWebSocketUpgrade } from './request-guard.js';

import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Applies helmet, CORS and the guard to `app` itself.
 *
 * Takes the instance rather than being registered via `app.register(...)`: that
 * would put the hook in a child encapsulation context, where it would not see
 * routes declared on the parent — i.e. it would silently protect nothing.
 */
export async function registerSecurity(app: FastifyInstance, logger: LoggerPort): Promise<void> {
  const allowlist = parseAllowlist(process.env['FLEEX_ALLOWED_ORIGINS']);
  if (allowlist.length > 0) {
    logger.info('Extra allowed origins configured', { origins: allowlist });
  }

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        // xterm.js and framer-motion write inline style attributes.
        'style-src': ["'self'", "'unsafe-inline'"],
        // GitHub/Google avatars, plus the image proxy.
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'font-src': ["'self'", 'data:'],
        'media-src': ["'self'", 'blob:', 'data:'],
        'worker-src': ["'self'", 'blob:'],
        'connect-src': [
          "'self'",
          // Derive the WS origin from the request, so the Tailscale hostname
          // needs no configuration.
          (req) => `ws://${req.headers.host}`,
          (req) => `wss://${req.headers.host}`,
        ],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
        // MUST stay null: helmet adds it by default and it would rewrite every
        // http://localhost request to https://.
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts:
      process.env['FLEEX_ENABLE_HSTS'] === '1'
        ? { maxAge: 15552000, includeSubDomains: true }
        : false,
    referrerPolicy: { policy: 'no-referrer' },
    // Helmet defaults to SAMEORIGIN; nothing here is meant to be framed.
    xFrameOptions: { action: 'deny' },
  });

  // Delegator form: the decision depends on the request's own Origin/Host.
  await app.register(
    cors,
    () => (req: FastifyRequest, cb: (err: Error | null, opts: FastifyCorsOptions) => void) => {
      cb(null, {
        origin: isOriginAllowed({
          origin: req.headers.origin,
          host: req.headers.host,
          allowlist,
        }),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 600,
      });
    },
  );

  app.addHook('onRequest', async (request, reply) => {
    const verdict = evaluateRequest({
      method: request.method,
      origin: request.headers.origin,
      host: request.headers.host,
      secFetchSite: request.headers['sec-fetch-site'] as string | undefined,
      isWebSocketUpgrade: isWebSocketUpgrade({
        upgrade: request.headers.upgrade,
        connection: request.headers.connection,
      }),
      hasBearerToken: hasBearerToken(request.headers.authorization),
      allowlist,
    });

    if (!verdict.allow) {
      logger.warn('Cross-site request blocked', {
        method: request.method,
        url: request.url,
        origin: request.headers.origin,
        secFetchSite: request.headers['sec-fetch-site'],
        reason: verdict.reason,
      });
      return reply.code(403).send({ error: 'Cross-site request blocked' });
    }
  });
}
