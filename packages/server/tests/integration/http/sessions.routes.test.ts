import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from '@fleex/shared';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * HOW MUCH OF `POST /api/sessions` IS REAL HERE
 * ────────────────────────────────────────────────────────────────────────────
 * All of it, which is worth stating because it is not obvious from the
 * container's "what is stubbed" table.
 *
 *  - `hostFs` is `NodeHostFs`, a REAL fs over the per-test temp `$HOME`. So
 *    `mkdir` inside `h.home` genuinely flips the `cwd` existence check, and the
 *    422 branch is exercised against real `fs.access`, not a fake's Set.
 *  - `createSession` is the REAL `CreateSessionUseCase`.
 *  - `tmux` is `FakeTmuxPort` — an in-memory map, but it implements the full
 *    `TmuxPort` contract, so nothing in the use case is short-circuited.
 *  - `sessionStore` is the REAL cached JSON store.
 *  - `git` is `FakeGitPort`, whose `getInfo` throws for an unregistered path.
 *    The use case catches that and logs at debug — so a session created in a
 *    non-git directory legitimately has null repository metadata. That is the
 *    production behaviour too, not a fixture artefact.
 *
 * A genuine 201 is therefore reachable, and it is asserted below together with
 * the `session.created` domain event. Nothing is faked to get there.
 *
 * NOT COVERED: `GET /api/sessions/groups`. `getSessionGroups` is a `vi.fn()`
 * stub in the integration container (the real use case is eagerly invoked by
 * the unified-WS plugin and drags in a dozen collaborators), so any assertion
 * on it would test the stub. See the container's header comment.
 */

describe('session routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  /** A real directory inside the test's temp `$HOME`, usable as a session cwd. */
  async function makeCwd(name = 'work'): Promise<string> {
    const dir = join(h.home, name);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /** Creates a session through HTTP and returns its DTO. */
  async function createSession(cwd: string, displayName?: string): Promise<Session> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { cwd, type: 'shell', ...(displayName ? { displayName } : {}) },
    });
    expect(res.statusCode).toBe(201);
    return res.json<Session>();
  }

  describe('GET /api/sessions', () => {
    it('answers 200 with an empty list on a fresh container', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/sessions' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and lists a created session', async () => {
      const cwd = await makeCwd();
      const created = await createSession(cwd);

      const res = await h.app.inject({ method: 'GET', url: '/api/sessions' });

      expect(res.statusCode).toBe(200);
      const list = res.json<Session[]>();
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(created.id);
      expect(list[0]?.cwd).toBe(cwd);
    });
  });

  describe('POST /api/sessions', () => {
    it('answers 422 CWD_NOT_FOUND when the cwd does not exist', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { cwd: '/definitely/not/a/real/directory', type: 'shell' },
      });

      expect(res.statusCode).toBe(422);
      // NOTE the shape: `{ code, message }`, not the error handler's
      // `{ error, message }`. This guard replies directly instead of throwing a
      // DomainError, so the payload keys differ from every other failure in the
      // API. Locked because the web branches on `code`.
      expect(res.json()).toEqual({
        code: 'CWD_NOT_FOUND',
        message: 'Directory not found: /definitely/not/a/real/directory',
      });
    });

    it('creates nothing when the cwd check fails', async () => {
      const bad = await h.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { cwd: '/nope', type: 'shell' },
      });
      expect(bad.statusCode).toBe(422);

      const list = await h.app.inject({ method: 'GET', url: '/api/sessions' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);
      // The guard runs BEFORE the use case: no tmux session was spawned either.
      expect(h.events.filter((e) => e.type === 'session.created')).toHaveLength(0);
    });

    it('answers 201 with the session DTO on an existing cwd', async () => {
      const cwd = await makeCwd();

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { cwd, type: 'shell' },
      });

      expect(res.statusCode).toBe(201);
      const session = res.json<Session>();
      expect(session.cwd).toBe(cwd);
      expect(session.type).toBe('shell');
      expect(session.status).toBe('running');
      expect(session.displayName).toBe('Shell');
      // `fleex_`-prefixed: this is what makes the session discoverable and what
      // `listManagedSessions` filters on.
      expect(session.tmuxName).toMatch(/^fleex_shell_/);
      // No git remote registered for this temp dir → the use case swallows the
      // GitPort failure and leaves the repository metadata null.
      expect(session.repositoryOrg).toBeNull();
      expect(session.worktreeBranch).toBeNull();
    });

    it('emits session.created carrying the new session id', async () => {
      const cwd = await makeCwd();

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { cwd, type: 'shell' },
      });

      expect(res.statusCode).toBe(201);
      const session = res.json<Session>();
      expect(h.events).toContainEqual(
        expect.objectContaining({
          type: 'session.created',
          sessionId: session.id,
          sessionType: 'shell',
          worktreeBranch: null,
        }),
      );
    });

    it('answers 201 twice for the same cwd, de-duplicating the display name', async () => {
      const cwd = await makeCwd();

      const first = await createSession(cwd);
      const second = await createSession(cwd);

      // `resolveUniqueName` appends `-1` rather than colliding or erroring.
      expect(first.displayName).toBe('Shell');
      expect(second.displayName).toBe('Shell-1');
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('answers 404 on an unknown id', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/sessions/unknown-id' });

      expect(res.statusCode).toBe(404);
      // Again a hand-rolled shape — `{ error: 'Session not found' }` — rather
      // than the DomainError envelope. Locked as-is.
      expect(res.json()).toEqual({ error: 'Session not found' });
    });

    it('answers 200 with the full DTO for an existing session', async () => {
      const cwd = await makeCwd();
      const created = await createSession(cwd);

      const res = await h.app.inject({ method: 'GET', url: `/api/sessions/${created.id}` });

      expect(res.statusCode).toBe(200);
      const session = res.json<Session>();
      expect(session.id).toBe(created.id);
      expect(session.tmuxName).toBe(created.tmuxName);
      expect(session.cwd).toBe(cwd);
    });
  });

  describe('PATCH /api/sessions/:id/rename', () => {
    it('answers 200 with the renamed session and emits session.renamed', async () => {
      const cwd = await makeCwd();
      const created = await createSession(cwd);

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/sessions/${created.id}/rename`,
        payload: { displayName: 'Deploy box' },
      });

      expect(res.statusCode).toBe(200);
      const session = res.json<Session>();
      expect(session.displayName).toBe('Deploy box');
      // The tmux name is re-derived from the display name, so it moves too.
      expect(session.tmuxName).not.toBe(created.tmuxName);
      expect(session.tmuxName).toBe('fleex_shell_deploy-box');

      expect(h.events).toContainEqual(
        expect.objectContaining({
          type: 'session.renamed',
          sessionId: created.id,
          displayName: 'Deploy box',
        }),
      );
    });

    it('answers 404 on an unknown id', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/sessions/unknown-id/rename',
        payload: { displayName: 'Nope' },
      });

      // Thrown as a DomainError, so this one DOES use the standard envelope.
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found: unknown-id',
      });
    });
  });

  describe('DELETE /api/sessions/:id', () => {
    it('answers 204 with an empty body, kills it and emits session.killed', async () => {
      const cwd = await makeCwd();
      const created = await createSession(cwd);

      const res = await h.app.inject({ method: 'DELETE', url: `/api/sessions/${created.id}` });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      const list = await h.app.inject({ method: 'GET', url: '/api/sessions' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);

      expect(h.events).toContainEqual(
        expect.objectContaining({ type: 'session.killed', sessionId: created.id }),
      );
    });

    it('answers 404 on an unknown id — unlike token revocation, this is not idempotent', async () => {
      const res = await h.app.inject({ method: 'DELETE', url: '/api/sessions/unknown-id' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found: unknown-id',
      });
    });

    it('kills only the targeted session', async () => {
      const keep = await createSession(await makeCwd('keep'), 'Keep');
      const drop = await createSession(await makeCwd('drop'), 'Drop');

      const res = await h.app.inject({ method: 'DELETE', url: `/api/sessions/${drop.id}` });
      expect(res.statusCode).toBe(204);

      const list = await h.app.inject({ method: 'GET', url: '/api/sessions' });
      expect(list.statusCode).toBe(200);
      const remaining = list.json<Session[]>();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(keep.id);
    });
  });
});
