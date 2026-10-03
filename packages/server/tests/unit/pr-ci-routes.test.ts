import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PrCiSummary } from '@fleex/shared';
import { prCiRoutes, type PrCiGithub } from '../../src/infrastructure/http/pr-ci.routes.js';
import type { PrMergedEvent } from '../../src/domain/events.js';

const SHA = 'b'.repeat(40);
const summary = (ref: string): PrCiSummary => ({ ref, state: 'OPEN', isDraft: false, ciStatus: 'running', counts: { running: 1 } });

describe('PR CI routes', () => {
  let app: FastifyInstance;
  let clock: number;
  let summaryCalls: string[][];
  let mergeCalls: unknown[];
  let mergeError: Error | null;
  let events: PrMergedEvent[];

  beforeEach(async () => {
    clock = 1_000_000;
    summaryCalls = [];
    mergeCalls = [];
    mergeError = null;
    events = [];
    const github: PrCiGithub = {
      fetchPRCiSummaries: async (prs) => {
        summaryCalls.push(prs.map((p) => `${p.org}/${p.name}#${p.number}`));
        return new Map(prs.map((p) => {
          const ref = `${p.org}/${p.name}#${p.number}`;
          return [ref, summary(ref)];
        }));
      },
      fetchPRCiDetail: async () => null,
      mergePR: async (input) => {
        mergeCalls.push(input);
        if (mergeError) throw mergeError;
      },
    };
    app = Fastify();
    await app.register(prCiRoutes({ github, emit: (e) => events.push(e), now: () => clock }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const summaries = (refs: unknown[]) => app.inject({ method: 'POST', url: '/api/pr-ci', payload: { refs } });
  const merge = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/prs/merge', payload });

  it('answers summaries keyed by lowercase ref, ignoring refs it cannot parse', async () => {
    const res = await summaries(['Org/Repo#1', 'garbage', 42]);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json())).toEqual(['org/repo#1']);
  });

  it('serves the same refs from its 15 s cache so several views do not hit GitHub twice', async () => {
    await summaries(['o/n#1']);
    clock += 10_000;
    await summaries(['o/n#1', 'o/n#2']);
    expect(summaryCalls).toEqual([['o/n#1'], ['o/n#2']]);

    clock += 6_000;
    await summaries(['o/n#1']);
    expect(summaryCalls).toHaveLength(3);
  });

  it('merges, emits pr.merged and drops the cached summary so the next read shows the merge', async () => {
    await summaries(['o/n#1']);
    const res = await merge({ ref: 'o/n#1', method: 'squash', headSha: SHA });
    expect(res.statusCode).toBe(200);
    expect(mergeCalls).toEqual([{ org: 'o', name: 'n', number: 1, method: 'squash', headSha: SHA }]);
    expect(events).toMatchObject([{ type: 'pr.merged', ref: 'o/n#1', method: 'squash' }]);

    await summaries(['o/n#1']);
    expect(summaryCalls).toHaveLength(2);
  });

  it('returns gh\'s refusal as a 422 the confirm dialog can show, and emits nothing', async () => {
    mergeError = new Error(`  Pull request is not mergeable: the base branch policy prohibits the merge.${' x'.repeat(400)}`);
    const res = await merge({ ref: 'o/n#1', method: 'merge', headSha: SHA });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/^Pull request is not mergeable/);
    expect(res.json().error.length).toBeLessThanOrEqual(300);
    expect(events).toEqual([]);
  });

  it.each([
    [{ ref: 'not-a-ref', method: 'merge', headSha: SHA }],
    [{ ref: 'o/n#1', method: 'admin', headSha: SHA }],
    [{ ref: 'o/n#1', method: 'merge', headSha: 'abc123' }],
    [{ ref: 'o/n#1', method: 'merge' }],
  ])('rejects %j with a 400 without calling gh', async (payload) => {
    const res = await merge(payload);
    expect(res.statusCode).toBe(400);
    expect(mergeCalls).toEqual([]);
  });

  it('answers 400 on an invalid detail ref and 404 when GitHub has no such PR', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/pr-ci/detail?ref=nope' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/pr-ci/detail?ref=${encodeURIComponent('o/n#1')}` })).statusCode).toBe(404);
  });
});
