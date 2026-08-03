import { ApiTokenEntity } from '../../domain/entities/api-token.entity.js';

import type { Container } from '../container.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Authentication middleware that supports three modes:
 * 1. No auth (DATABASE_URL not set) — all requests pass through.
 * 2. No SSO configured (DATABASE_URL set but no OAuth env vars) —
 *    uses default local user, no login required.
 * 3. Full auth (DATABASE_URL + OAuth) — requires session cookie or
 *    Bearer token.
 *
 * Injects `request.userId` for downstream use.
 */

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`));
  return match ? match[1]! : null;
}

export function createAuthMiddleware(container: Container) {
  const { sessionManager, agentTokenStore } = container;
  const defaultUserId = '00000000-0000-0000-0000-000000000000';

  // Check if any OAuth provider is configured
  const hasOAuth = !!(
    (process.env['GITHUB_CLIENT_ID'] && process.env['GITHUB_CLIENT_SECRET']) ||
    (process.env['GOOGLE_CLIENT_ID'] && process.env['GOOGLE_CLIENT_SECRET'])
  );

  return async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // Skip auth for auth routes, health, and internal gateway routes
    const url = request.url;
    if (url.startsWith('/auth/') || url.startsWith('/health') || url.startsWith('/internal/')) {
      return;
    }

    // Mode 1: No database — no auth, use default user
    if (!sessionManager) {
      request.userId = defaultUserId;
      return;
    }

    // Try Bearer token first (PAT or agent token)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const hash = ApiTokenEntity.hashToken(token);
      const tokenEntity = await agentTokenStore.getByHash(hash);
      if (tokenEntity) {
        tokenEntity.markUsed();
        await agentTokenStore.save(tokenEntity);
        request.userId = defaultUserId; // TODO: token.userId when multi-user tokens
        return;
      }
      return reply.code(401).send({ error: 'Invalid token' });
    }

    // Mode 2: Database but no OAuth — auto-assign default user
    if (!hasOAuth) {
      request.userId = defaultUserId;
      return;
    }

    // Mode 3: Full auth — require session cookie
    const sessionId = parseCookie(request.headers.cookie, 'fleex_session');
    if (!sessionId || !sessionManager) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const session = await sessionManager.get(sessionId);
    if (!session) {
      return reply.code(401).send({ error: 'Session expired' });
    }

    request.userId = session.userId;
  };
}
