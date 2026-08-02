import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentPersona, Skill } from '@fleex/shared';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedPersona } from '../../helpers/fixtures.js';

/**
 * Personas and skills share a file because a skill cannot exist without a
 * persona: `CreateSkillUseCase` resolves `personaId` before saving. Testing
 * them together keeps that dependency visible instead of hidden behind a
 * fixture.
 *
 * SCOPE — the happy paths of the CRUD trio, plus the domain-event each write
 * emits. `PATCH`, `/statuses`, `/:id/status` and `/:id/execute` are left out:
 * they route through `executeAgent`, which is a `vi.fn()` stub in the
 * integration container, so asserting on them would test the fixture.
 *
 * NOT REPEATED HERE — the unmapped-error-code bug. `AGENT_PERSONA_NOT_FOUND`,
 * `AGENT_PERSONA_NAME_CONFLICT`, `SKILL_NOT_FOUND` and
 * `SKILL_COMMAND_NAME_CONFLICT` are all missing from `CODE_TO_STATUS` and
 * therefore answer 500 instead of 404/409. The full mapping is locked, code by
 * code, in `error-handler.test.ts`; duplicating it per route would just make
 * the eventual fix noisier. The single exception is the POST conflict below,
 * which is locked at the ROUTE level for a reason spelled out in its comment.
 */

describe('persona + skill routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  describe('GET /api/personas', () => {
    it('answers 200 with an empty list on a fresh container', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/personas' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and lists a seeded persona', async () => {
      const persona = await seedPersona(h.container, { name: 'builder', displayName: 'Builder' });

      const res = await h.app.inject({ method: 'GET', url: '/api/personas' });

      expect(res.statusCode).toBe(200);
      const list = res.json<AgentPersona[]>();
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(persona.id);
      expect(list[0]?.name).toBe('builder');
    });
  });

  describe('GET /api/personas/:id', () => {
    it('answers 200 with the full persona DTO', async () => {
      const persona = await seedPersona(h.container, { name: 'reviewer', displayName: 'Reviewer' });

      const res = await h.app.inject({ method: 'GET', url: `/api/personas/${persona.id}` });

      expect(res.statusCode).toBe(200);
      expect(res.json<AgentPersona>()).toMatchObject({
        id: persona.id,
        name: 'reviewer',
        displayName: 'Reviewer',
      });
    });
  });

  describe('POST /api/personas', () => {
    it('answers 201, applies the entity defaults and emits persona.created', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/personas',
        payload: { name: 'builder', displayName: 'Builder' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json<AgentPersona>();
      expect(created.name).toBe('builder');
      // Defaults come from `AgentPersonaEntity.create`, not the route.
      expect(created.model).toBe('claude-sonnet-5');
      expect(created.executionMode).toBe('claude_code');
      expect(created.soulMd).toBe('');
      expect(created.humanMentionName).toBeNull();

      expect(h.events).toContainEqual(
        expect.objectContaining({ type: 'persona.created', personaId: created.id }),
      );
    });

    it('persists the persona — a follow-up GET returns it', async () => {
      const create = await h.app.inject({
        method: 'POST',
        url: '/api/personas',
        payload: { name: 'builder', displayName: 'Builder', soulMd: '# Soul' },
      });
      expect(create.statusCode).toBe(201);
      const id = create.json<AgentPersona>().id;

      const read = await h.app.inject({ method: 'GET', url: `/api/personas/${id}` });
      expect(read.statusCode).toBe(200);
      expect(read.json<AgentPersona>().soulMd).toBe('# Soul');
    });

    /**
     * ⚠️  KNOWN BUG, LOCKED ON PURPOSE — and locked HERE, not only in
     * `error-handler.test.ts`.
     *
     * A duplicate persona name is a plain client-side conflict. It SHOULD be
     * 409; `AGENT_PERSONA_NAME_CONFLICT` is absent from `CODE_TO_STATUS`, so it
     * falls through to 500.
     *
     * Why lock it at the route level too: `error-handler.test.ts` locks the
     * mapping table. If someone "fixes" this by pre-checking the name inside
     * the route and returning 409 directly, the table test stays green and the
     * status silently changes. This assertion is the one that would catch it.
     * The proper fix (map the code) is a separate ticket.
     */
    it('answers 500 on a duplicate name (known bug — should be 409, see comment)', async () => {
      const first = await h.app.inject({
        method: 'POST',
        url: '/api/personas',
        payload: { name: 'builder', displayName: 'Builder' },
      });
      expect(first.statusCode).toBe(201);

      const second = await h.app.inject({
        method: 'POST',
        url: '/api/personas',
        payload: { name: 'builder', displayName: 'Other Builder' },
      });

      expect(second.statusCode).toBe(500);
      expect(second.json()).toEqual({
        error: 'AGENT_PERSONA_NAME_CONFLICT',
        message: 'Agent persona name already exists: builder',
      });
    });
  });

  describe('DELETE /api/personas/:id', () => {
    it('answers 204 with an empty body, removes it and emits persona.deleted', async () => {
      const persona = await seedPersona(h.container, { name: 'temp' });

      const res = await h.app.inject({ method: 'DELETE', url: `/api/personas/${persona.id}` });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      const list = await h.app.inject({ method: 'GET', url: '/api/personas' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);

      expect(h.events).toContainEqual(
        expect.objectContaining({ type: 'persona.deleted', personaId: persona.id }),
      );
    });

    it('deletes only the targeted persona', async () => {
      const keep = await seedPersona(h.container, { name: 'keep' });
      const drop = await seedPersona(h.container, { name: 'drop' });

      const res = await h.app.inject({ method: 'DELETE', url: `/api/personas/${drop.id}` });
      expect(res.statusCode).toBe(204);

      const list = await h.app.inject({ method: 'GET', url: '/api/personas' });
      expect(list.statusCode).toBe(200);
      const remaining = list.json<AgentPersona[]>();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(keep.id);
    });
  });

  describe('GET /api/skills', () => {
    it('answers 200 with an empty list on a fresh container', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/skills' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and lists a created skill', async () => {
      const persona = await seedPersona(h.container, { name: 'builder' });
      const create = await h.app.inject({
        method: 'POST',
        url: '/api/skills',
        payload: {
          commandName: 'review',
          name: 'review',
          displayName: 'Review',
          personaId: persona.id,
        },
      });
      expect(create.statusCode).toBe(201);

      const res = await h.app.inject({ method: 'GET', url: '/api/skills' });

      expect(res.statusCode).toBe(200);
      const list = res.json<Skill[]>();
      expect(list).toHaveLength(1);
      expect(list[0]?.commandName).toBe('review');
      expect(list[0]?.personaId).toBe(persona.id);
    });
  });

  describe('GET /api/skills/enabled', () => {
    it('answers 200 and filters out disabled skills', async () => {
      const persona = await seedPersona(h.container, { name: 'builder' });
      for (const [commandName, enabled] of [['on', true], ['off', false]] as const) {
        const created = await h.app.inject({
          method: 'POST',
          url: '/api/skills',
          payload: {
            commandName,
            name: commandName,
            displayName: commandName,
            enabled,
            personaId: persona.id,
          },
        });
        expect(created.statusCode).toBe(201);
      }

      const all = await h.app.inject({ method: 'GET', url: '/api/skills' });
      expect(all.statusCode).toBe(200);
      expect(all.json<Skill[]>()).toHaveLength(2);

      const res = await h.app.inject({ method: 'GET', url: '/api/skills/enabled' });

      expect(res.statusCode).toBe(200);
      const enabled = res.json<Skill[]>();
      expect(enabled).toHaveLength(1);
      expect(enabled[0]?.commandName).toBe('on');
    });
  });

  describe('POST /api/skills', () => {
    it('answers 201, applies the entity defaults and emits skill.created', async () => {
      const persona = await seedPersona(h.container, { name: 'builder' });

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/skills',
        payload: {
          commandName: 'review',
          name: 'review',
          displayName: 'Review a PR',
          personaId: persona.id,
        },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json<Skill>();
      expect(created.commandName).toBe('review');
      expect(created.displayName).toBe('Review a PR');
      // Defaults from `SkillEntity.create`.
      expect(created.enabled).toBe(true);
      expect(created.markdownContent).toBe('');

      expect(h.events).toContainEqual(
        expect.objectContaining({ type: 'skill.created', skillId: created.id }),
      );
    });

    it('persists the skill — a follow-up GET /:id returns it', async () => {
      const persona = await seedPersona(h.container, { name: 'builder' });
      const create = await h.app.inject({
        method: 'POST',
        url: '/api/skills',
        payload: {
          commandName: 'review',
          name: 'review',
          displayName: 'Review',
          markdownContent: '# How to review',
          personaId: persona.id,
        },
      });
      expect(create.statusCode).toBe(201);
      const id = create.json<Skill>().id;

      const read = await h.app.inject({ method: 'GET', url: `/api/skills/${id}` });
      expect(read.statusCode).toBe(200);
      expect(read.json<Skill>().markdownContent).toBe('# How to review');
    });
  });

  describe('DELETE /api/skills/:id', () => {
    it('answers 204 with an empty body, removes it and emits skill.deleted', async () => {
      const persona = await seedPersona(h.container, { name: 'builder' });
      const create = await h.app.inject({
        method: 'POST',
        url: '/api/skills',
        payload: {
          commandName: 'review',
          name: 'review',
          displayName: 'Review',
          personaId: persona.id,
        },
      });
      expect(create.statusCode).toBe(201);
      const id = create.json<Skill>().id;

      const res = await h.app.inject({ method: 'DELETE', url: `/api/skills/${id}` });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      const list = await h.app.inject({ method: 'GET', url: '/api/skills' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);

      expect(h.events).toContainEqual(
        expect.objectContaining({ type: 'skill.deleted', skillId: id }),
      );
    });

    it('leaves the owning persona alone', async () => {
      const persona = await seedPersona(h.container, { name: 'builder' });
      const create = await h.app.inject({
        method: 'POST',
        url: '/api/skills',
        payload: {
          commandName: 'review',
          name: 'review',
          displayName: 'Review',
          personaId: persona.id,
        },
      });
      expect(create.statusCode).toBe(201);

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/skills/${create.json<Skill>().id}`,
      });
      expect(res.statusCode).toBe(204);

      const personas = await h.app.inject({ method: 'GET', url: '/api/personas' });
      expect(personas.statusCode).toBe(200);
      expect(personas.json<AgentPersona[]>()).toHaveLength(1);
    });
  });
});
