import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../../../src/infrastructure/http/error-handler.js';
import { DomainError } from '../../../src/domain/errors.js';
import * as errors from '../../../src/domain/errors.js';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';

/**
 * The status a `DomainError` produces is decided by ONE lookup table
 * (`CODE_TO_STATUS` in error-handler.ts) with a `?? 500` fallback. A code that
 * nobody added to the table therefore answers 500 — including for plainly
 * client-side mistakes such as "unknown persona id".
 *
 * This suite locks the full mapping, code by code. It is deliberately
 * exhaustive rather than sampled: the failure mode we are guarding against is
 * a NEW error class silently landing on 500, which a sampled test can never
 * catch.
 *
 * Every code below is now mapped: no `DomainError` falls through to 500. That
 * invariant is asserted explicitly at the end of this file, so the next code
 * added without a status decision fails here rather than in production.
 */

/** Every code the domain can raise → the status the HTTP layer answers today. */
const EXPECTED_STATUS_BY_CODE: Record<string, number> = {
  // --- mapped, sane -------------------------------------------------------
  SESSION_NOT_FOUND: 404,
  SESSION_ALREADY_EXISTS: 409,
  SESSION_NAME_CONFLICT: 409,
  TMUX_NOT_AVAILABLE: 503,
  WORKTREE_ERROR: 400,
  REPOSITORY_NOT_FOUND: 404,
  BOARD_NOT_FOUND: 404,
  TICKET_NOT_FOUND: 404,
  API_TOKEN_INVALID: 401,
  LAST_BOARD: 422,
  COMMENT_NOT_FOUND: 404,
  MENTION_NOT_FOUND: 404,
  DELIVERABLE_NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_DELIVERABLE_TYPE: 400,
  DELIVERABLE_TYPE_NOT_FOUND: 404,
  DELIVERABLE_TYPE_CONFLICT: 409,
  DELIVERABLE_TYPE_IN_USE: 409,
  SLACK_INVALID_URL: 422,
  SLACK_INTEGRATION_UNAVAILABLE: 422,
  SLACK_CONVERSATION_INACCESSIBLE: 422,
  SLACK_CONVERSATION_EMPTY: 422,

  // --- previously unmapped, now decided -----------------------------------
  AGENT_PERSONA_NOT_FOUND: 404,
  AGENT_PERSONA_NAME_CONFLICT: 409,
  SKILL_NOT_FOUND: 404,
  SKILL_COMMAND_NAME_CONFLICT: 409,
  PANEL_NOT_FOUND: 404,
  PANEL_NAME_CONFLICT: 409,
  WORKFLOW_RUN_ALREADY_ACTIVE: 409,
  WORKFLOW_TEMPLATE_NOT_FOUND: 404,
  WORKFLOW_RUN_NOT_FOUND: 404,
  STEP_RUN_NOT_FOUND: 404,
  // A user-requested termination, not a server fault. Callers are expected to
  // swallow it; 409 is the least wrong status should it ever reach the wire.
  EXECUTION_CANCELLED: 409,
  INVALID_GATE_OUTCOME: 400,
  // Was a bare `Error` with a `statusCode` field the handler never read, so
  // every unknown epic surfaced as 500. Now a real `DomainError`.
  TICKET_GROUP_NOT_FOUND: 404,
};

/**
 * `SlackImportError` is the one class whose code comes from a constructor
 * argument rather than being hard-coded, so it cannot be discovered by
 * instantiating it with placeholder arguments.
 */
const CODES_FROM_CONSTRUCTOR_ARG: Record<string, string[]> = {
  SlackImportError: [
    'SLACK_INVALID_URL',
    'SLACK_INTEGRATION_UNAVAILABLE',
    'SLACK_CONVERSATION_INACCESSIBLE',
    'SLACK_CONVERSATION_EMPTY',
  ],
};

type DomainErrorCtor = new (...args: never[]) => DomainError;

/** Every concrete `DomainError` subclass exported by the domain module. */
function domainErrorClasses(): Array<[string, DomainErrorCtor]> {
  return Object.entries(errors).filter(
    ([name, value]): value is [string, DomainErrorCtor][number] & DomainErrorCtor =>
      name !== 'DomainError' &&
      typeof value === 'function' &&
      value.prototype instanceof DomainError,
  ) as Array<[string, DomainErrorCtor]>;
}

/** Placeholder arguments are enough: every code is hard-coded in the body. */
function codesOf(name: string, Ctor: DomainErrorCtor): string[] {
  const fromArg = CODES_FROM_CONSTRUCTOR_ARG[name];
  if (fromArg) return fromArg;
  const instance = new Ctor(...([`x`, [`y`], 1] as unknown as never[]));
  return [instance.code];
}

describe('error handler', () => {
  /**
   * A throwaway app whose only route rethrows an arbitrary `DomainError`.
   * Going through real `inject()` rather than calling the handler directly is
   * what makes the assertion about HTTP status, not about a lookup table.
   */
  let boom: FastifyInstance;

  beforeAll(async () => {
    boom = Fastify({ logger: false });
    registerErrorHandler(boom);
    boom.get<{ Params: { code: string } }>('/boom/:code', async (request) => {
      throw new DomainError(`boom: ${request.params.code}`, request.params.code);
    });
    boom.get('/plain-throw', async () => {
      throw new Error('something unexpected');
    });
    boom.get('/non-error-throw', async () => {
      throw 'a bare string'; // eslint-disable-line no-throw-literal
    });
    boom.post(
      '/validated',
      { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
      async () => ({ ok: true }),
    );
    await boom.ready();
  });

  afterAll(async () => {
    await boom.close();
  });

  it('knows every DomainError subclass the domain exports', () => {
    const discovered = domainErrorClasses()
      .flatMap(([name, Ctor]) => codesOf(name, Ctor))
      .sort();

    // A new error class with no entry here fails this assertion, which forces
    // an explicit decision about its status instead of a silent 500.
    expect(discovered).toEqual(Object.keys(EXPECTED_STATUS_BY_CODE).sort());
  });

  it.each(Object.entries(EXPECTED_STATUS_BY_CODE))(
    '%s → %i',
    async (code, status) => {
      const res = await boom.inject({ method: 'GET', url: `/boom/${code}` });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: code, message: `boom: ${code}` });
    },
  );

  /**
   * The invariant that replaces the old "exactly 12 codes fall through to 500"
   * lock. A `DomainError` describes a condition the domain anticipated, so
   * answering 500 — "the server is broken" — is always wrong. Asserting the
   * empty set rather than a count means the assertion cannot be satisfied by
   * updating a number.
   */
  it('leaves no DomainError falling through to 500', () => {
    const unmapped = Object.entries(EXPECTED_STATUS_BY_CODE)
      .filter(([, status]) => status === 500)
      .map(([code]) => code);
    expect(unmapped).toEqual([]);
  });

  it('answers 500 INTERNAL_ERROR on a non-domain Error, echoing its message', async () => {
    const res = await boom.inject({ method: 'GET', url: '/plain-throw' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'something unexpected',
    });
  });

  /**
   * ⚠️  KNOWN BUG, LOCKED ON PURPOSE — the LAST one left in this suite, and
   * deliberately so. It is the only bug whose fix does not ship with this PR.
   *
   * Every other locked bug was fixed here because its blast radius was a route
   * or two, all of them covered. This one changes the status of every
   * non-`DomainError` on all 304 routes, of which only 57 are covered — the
   * remaining 247 would change behaviour with no test watching. It therefore
   * ships as its own PR, on top of this one, so the diff is reviewable on its
   * own terms. Its two downstream symptoms are pinned in `hook.routes.test.ts`
   * and `files.routes.test.ts`; one fix turns all three green.
   *
   * The handler reads `error.code` on `DomainError` and ignores `error.statusCode`
   * on everything else. Fastify's own errors DO carry a correct `statusCode`:
   * schema validation is 400, an oversized upload is 413. Both are rewritten
   * to 500.
   *
   * The blast radius is every route with a schema or a file upload — a client
   * sending a malformed body is told the server broke. Two consequences are
   * pinned elsewhere for the routes that suffer them
   * (`hook.routes.test.ts`, `files.routes.test.ts`); this is the root cause,
   * so it is pinned here too. One fix — honour `error.statusCode` — turns all
   * three green.
   */
  it('answers 500 on a Fastify validation error (should be 400 — see comment)', async () => {
    const res = await boom.inject({ method: 'POST', url: '/validated', payload: {} });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
  });

  it('answers 500 INTERNAL_ERROR on a thrown non-Error value', async () => {
    const res = await boom.inject({ method: 'GET', url: '/non-error-throw' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
  });

  describe('through the real app', () => {
    let h: TestAppHandle | undefined;

    afterEach(async () => {
      await h?.close();
      h = undefined;
    });

    it('answers 404 on GET /api/personas/:unknown — a formerly unmapped code', async () => {
      h = await createTestApp();
      const res = await h.app.inject({ method: 'GET', url: '/api/personas/inconnu' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: 'AGENT_PERSONA_NOT_FOUND',
        message: 'Agent persona not found: inconnu',
      });
    });

    it('answers 404 on GET /api/tickets/:unknown — a mapped code', async () => {
      h = await createTestApp();
      const res = await h.app.inject({ method: 'GET', url: '/api/tickets/inconnu' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });
});
