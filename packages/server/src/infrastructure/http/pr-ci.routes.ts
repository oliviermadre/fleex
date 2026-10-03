import type { FastifyInstance } from 'fastify';
import type { PrCiDetail, PrCiSummary, PrMergeMethod } from '@fleex/shared';
import { PR_MERGE_METHODS } from '@fleex/shared';
import { parsePRRef, type ParsedPRRef } from '../../domain/services/pr-ref.js';
import type { PrMergedEvent } from '../../domain/events.js';

export interface PrCiGithub {
  fetchPRCiSummaries(prs: ParsedPRRef[]): Promise<Map<string, PrCiSummary>>;
  fetchPRCiDetail(pr: ParsedPRRef): Promise<PrCiDetail | null>;
  mergePR(input: ParsedPRRef & { method: PrMergeMethod; headSha: string }): Promise<void>;
}

export interface PrCiRouteDeps {
  github: PrCiGithub;
  emit: (event: PrMergedEvent) => void;
  /** Injectable clock, for the cache TTL in tests. */
  now?: () => number;
}

/** Refs per summary request: one board's worth, so one call can't build an unbounded query. */
const MAX_SUMMARY_REFS = 200;
/** Chips on several views ask for the same PRs within seconds of each other. */
const SUMMARY_TTL_MS = 15_000;
const HEAD_SHA_RE = /^[0-9a-f]{40}$/;
const GH_ERROR_MAX = 300;

/**
 * Live CI for the PR chip: bulk summaries (status + counts) for every chip on
 * screen, one PR's detail when its menu opens, and merge. Takes the GitHub
 * adapter directly (not the whole container) so the routes run over real HTTP
 * with a fake.
 */
export function prCiRoutes(deps: PrCiRouteDeps) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { summary: PrCiSummary; fetchedAt: number }>();

  return async function (app: FastifyInstance) {
    app.post<{ Body: { refs?: unknown } }>('/api/pr-ci', async (request) => {
      const raw = Array.isArray(request.body?.refs) ? request.body.refs : [];
      const parsed = new Map<string, ParsedPRRef>();
      for (const ref of raw.slice(0, MAX_SUMMARY_REFS)) {
        if (typeof ref !== 'string') continue;
        const pr = parsePRRef(ref.toLowerCase());
        if (pr) parsed.set(ref.toLowerCase(), pr);
      }

      const out: Record<string, PrCiSummary> = {};
      const missing: ParsedPRRef[] = [];
      const at = now();
      for (const [ref, pr] of parsed) {
        const hit = cache.get(ref);
        if (hit && at - hit.fetchedAt < SUMMARY_TTL_MS) out[ref] = hit.summary;
        else missing.push(pr);
      }

      if (missing.length > 0) {
        const fetched = await deps.github.fetchPRCiSummaries(missing);
        for (const [ref, summary] of fetched) {
          cache.set(ref, { summary, fetchedAt: at });
          out[ref] = summary;
        }
      }
      return out;
    });

    app.get<{ Querystring: { ref?: string } }>('/api/pr-ci/detail', async (request, reply) => {
      const ref = request.query.ref?.toLowerCase() ?? '';
      const pr = parsePRRef(ref);
      if (!pr) return reply.code(400).send({ error: `Invalid PR ref: ${request.query.ref ?? ''}` });

      const detail = await deps.github.fetchPRCiDetail(pr);
      if (!detail) return reply.code(404).send({ error: `Pull request not found: ${ref}` });
      // The detail is fresher than any cached summary: keep them in step.
      const { ref: _ref, state, isDraft, ciStatus, counts } = detail;
      cache.set(ref, { summary: { ref, state, isDraft, ciStatus, counts }, fetchedAt: now() });
      return detail;
    });

    app.post<{ Body: { ref?: unknown; method?: unknown; headSha?: unknown } }>('/api/prs/merge', async (request, reply) => {
      const { ref, method, headSha } = request.body ?? {};
      const pr = typeof ref === 'string' ? parsePRRef(ref.toLowerCase()) : null;
      if (!pr) return reply.code(400).send({ error: `Invalid PR ref: ${String(ref)}` });
      if (!PR_MERGE_METHODS.includes(method as PrMergeMethod)) {
        return reply.code(400).send({ error: `Invalid merge method: ${String(method)}` });
      }
      if (typeof headSha !== 'string' || !HEAD_SHA_RE.test(headSha)) {
        return reply.code(400).send({ error: 'Invalid head commit SHA' });
      }

      const key = (ref as string).toLowerCase();
      try {
        await deps.github.mergePR({ ...pr, method: method as PrMergeMethod, headSha });
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).trim().slice(0, GH_ERROR_MAX);
        return reply.code(422).send({ error: message || 'gh pr merge failed' });
      }

      cache.delete(key);
      deps.emit({ type: 'pr.merged', ref: key, method: method as PrMergeMethod, occurredAt: new Date() });
      return { ok: true };
    });
  };
}
