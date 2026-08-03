import type { ClientErrorReport } from '@fleex/shared';
import {
  CLIENT_ERROR_MAX_MESSAGE,
  CLIENT_ERROR_MAX_STACK,
  CLIENT_ERROR_MAX_COMPONENT_STACK,
} from '@fleex/shared';

import type { Container } from '../container.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * Client crash ingress.
 *
 * Public on purpose (see design D4): a crash must be reportable precisely when
 * the session is dead, which is when auth would reject it. The compensating
 * controls are the body limit, the schema, the truncation and the rate limit
 * below — not authentication.
 */

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateBucket {
  count: number;
  windowStart: number;
  /** One warn per window: logging every rejection would BE the flood. */
  warned: boolean;
}

const buckets = new Map<string, RateBucket>();

/** Exported for tests — module state would otherwise leak between cases. */
export function __resetClientErrorRateLimit(): void {
  buckets.clear();
}

/** @returns true when the report is within budget for this IP. */
function allow(ip: string, now: number): { allowed: boolean; shouldWarn: boolean } {
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now, warned: false });
    return { allowed: true, shouldWarn: false };
  }
  bucket.count += 1;
  if (bucket.count <= RATE_LIMIT_MAX) return { allowed: true, shouldWarn: false };
  const shouldWarn = !bucket.warned;
  bucket.warned = true;
  return { allowed: false, shouldWarn };
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

const CLIENT_ERROR_SOURCES = [
  'boundary',
  'window.onerror',
  'unhandledrejection',
  'react.uncaught',
] as const;

export function clientErrorRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.post<{ Body: ClientErrorReport }>(
      '/api/client-errors',
      {
        // 64 KB instead of Fastify's 1 MB: a report is a few KB of stack.
        bodyLimit: 64 * 1024,
        schema: {
          body: {
            type: 'object',
            required: ['errorId', 'message', 'source', 'url', 'occurredAt'],
            properties: {
              errorId: { type: 'string', minLength: 1, maxLength: 64 },
              message: { type: 'string' },
              stack: { type: 'string' },
              componentStack: { type: 'string' },
              source: { type: 'string', enum: CLIENT_ERROR_SOURCES as unknown as string[] },
              boundary: { type: 'string', maxLength: 128 },
              viewKey: { type: 'string', maxLength: 256 },
              url: { type: 'string', maxLength: 2048 },
              userAgent: { type: 'string', maxLength: 512 },
              occurredAt: { type: 'string', maxLength: 64 },
              seq: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      async (request: FastifyRequest<{ Body: ClientErrorReport }>, reply: FastifyReply) => {
        try {
          const ip = request.ip || request.socket?.remoteAddress || 'unknown';
          const { allowed, shouldWarn } = allow(ip, Date.now());
          if (!allowed) {
            if (shouldWarn) {
              container.logger.warn('client error reports rate-limited', {
                ip,
                limit: RATE_LIMIT_MAX,
                windowMs: RATE_LIMIT_WINDOW_MS,
              });
            }
            return reply.code(202).send({ accepted: false });
          }

          const report = request.body;
          // Defence in depth: the client truncates too, but it is untrusted.
          container.logger.error('client error', {
            errorId: report.errorId,
            message: truncate(report.message, CLIENT_ERROR_MAX_MESSAGE),
            source: report.source,
            boundary: report.boundary,
            viewKey: report.viewKey,
            url: report.url,
            userAgent: report.userAgent,
            occurredAt: report.occurredAt,
            seq: report.seq,
            stack: truncate(report.stack, CLIENT_ERROR_MAX_STACK),
            componentStack: truncate(report.componentStack, CLIENT_ERROR_MAX_COMPONENT_STACK),
          });

          return reply.code(202).send({ accepted: true });
        } catch {
          // An error-reporting endpoint that 500s is absurd: it would make the
          // client retry, or worse, report the failure to report.
          return reply.code(202).send({ accepted: false });
        }
      },
    );
  };
}
