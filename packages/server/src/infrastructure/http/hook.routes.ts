import type { HookEventPayload } from '@fleex/shared';

import type { Container } from '../container.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/** Max age of a hook event before it is rejected (anti-replay). */
const MAX_AGE_MS = 30_000;

/** Localhost-only — hook POSTs are local curl invocations from Claude Code. */
const LOCAL_REMOTES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const HOOK_EVENT_VALUES = [
  'sessionStart',
  'sessionEnd',
  'userPromptSubmit',
  'notification',
  'stop',
  'stopFailure',
  'preToolUse',
] as const;

export function hookRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.post<{ Body: HookEventPayload }>(
      '/api/hook',
      {
        schema: {
          body: {
            type: 'object',
            required: ['event', 'cwd', 'timestamp'],
            properties: {
              event: { type: 'string', enum: HOOK_EVENT_VALUES as unknown as string[] },
              cwd: { type: 'string', minLength: 1 },
              timestamp: { type: 'number' },
              payload: { type: 'object', additionalProperties: true, default: {} },
            },
            additionalProperties: false,
          },
        },
      },
      async (request: FastifyRequest<{ Body: HookEventPayload }>, reply: FastifyReply) => {
        // ── Security: localhost only ──
        const remote = request.ip || request.socket?.remoteAddress || '';
        if (!LOCAL_REMOTES.has(remote)) {
          container.logger.warn('Hook POST from non-localhost rejected', { remote });
          return reply.code(403).send({ error: 'Forbidden' });
        }

        // ── Anti-replay: reject hooks older than 30s ──
        const event = request.body;
        const ageMs = Date.now() - event.timestamp;
        if (ageMs > MAX_AGE_MS) {
          container.logger.warn('Hook event too old, ignoring', { ageMs, event: event.event });
          return reply.code(200).send({ accepted: false, reason: 'stale' });
        }
        if (ageMs < -MAX_AGE_MS) {
          // Clock skew far in the future — also reject
          return reply.code(200).send({ accepted: false, reason: 'future' });
        }

        try {
          const result = await container.processHookEvent.execute(event);
          return reply.code(200).send({ accepted: true, ...result });
        } catch (err) {
          container.logger.error('processHookEvent failed', {
            error: err instanceof Error ? err.message : String(err),
            event: event.event,
            cwd: event.cwd,
          });
          // Never fail Claude's hook — always return 200 OK.
          return reply.code(200).send({ accepted: false, reason: 'error' });
        }
      },
    );
  };
}
