/**
 * Retrieval quality metrics.
 *
 * Pure arithmetic over ranked results, kept separate from anything that fetches
 * them so the definitions can be tested exactly and reused by both the bench (one
 * model against another) and any future regression check (one commit against
 * another).
 */

export interface EvalCase {
  /** What a user would type. */
  query: string;
  /** Source ids that would be a correct answer. Any one of them counts. */
  expected: string[];
}

export interface EvalOutcome extends EvalCase {
  /** Source ids actually returned, best first. */
  returned: string[];
  /** 1-based rank of the first expected id, or 0 when none was returned. */
  firstRelevantRank: number;
}

export interface EvalReport {
  cases: number;
  /** Share of cases where an expected id appeared in the top K. */
  recallAtK: number;
  k: number;
  /** Mean reciprocal rank: rewards putting the right answer first, not just in. */
  mrr: number;
  /** Cases that returned nothing expected at all. */
  misses: EvalOutcome[];
}

/**
 * Rank of the first expected id in a result list, 1-based.
 *
 * Returns 0 for "not found", which the callers below treat as a miss. Using 0
 * rather than -1 keeps the reciprocal-rank sum a plain guard (`rank ? 1/rank : 0`)
 * instead of a special case.
 */
export function firstRelevantRank(returned: string[], expected: string[]): number {
  const wanted = new Set(expected);
  for (let i = 0; i < returned.length; i++) {
    if (wanted.has(returned[i]!)) return i + 1;
  }
  return 0;
}

/**
 * Score a set of outcomes.
 *
 * Recall@K answers "did it find it at all", MRR answers "did it put it first".
 * Both are reported because they fail differently: a retrieval that always returns
 * the right answer in position eight scores well on the first and badly on the
 * second, and only the second predicts whether an agent's prompt — which is
 * budget-limited — will actually contain it.
 */
export function scoreOutcomes(outcomes: EvalOutcome[], k: number): EvalReport {
  if (outcomes.length === 0) {
    return { cases: 0, recallAtK: 0, k, mrr: 0, misses: [] };
  }

  let found = 0;
  let reciprocalSum = 0;
  const misses: EvalOutcome[] = [];

  for (const outcome of outcomes) {
    const rank = outcome.firstRelevantRank;
    if (rank > 0 && rank <= k) found++;
    reciprocalSum += rank ? 1 / rank : 0;
    if (rank === 0) misses.push(outcome);
  }

  return {
    cases: outcomes.length,
    recallAtK: round(found / outcomes.length),
    k,
    mrr: round(reciprocalSum / outcomes.length),
    misses,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Build eval cases from the corpus itself.
 *
 * A hand-written golden set is better, and does not exist on a fresh instance. The
 * usable substitute: take a chunk's own title as the query and expect its own
 * source back. That is a weak test of semantic understanding — the title is
 * literally in the text — but a strong test of the plumbing, and it catches the
 * failures that matter most in practice: a broken filter, a mismatched vector
 * space, an index that silently stopped being written.
 *
 * Cases are only generated for sources with more than one chunk's worth of
 * content, so a one-line note whose title *is* its body cannot inflate the score.
 */
export function deriveCasesFromCorpus(
  chunks: Array<{ sourceId: string; title: string; content: string }>,
  limit: number,
): EvalCase[] {
  const cases: EvalCase[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    if (cases.length >= limit) break;
    if (seen.has(chunk.sourceId)) continue;
    if (chunk.content.trim().length < 200) continue;

    const query = stripBreadcrumb(chunk.title);
    if (query.length < 8) continue;

    seen.add(chunk.sourceId);
    cases.push({ query, expected: [chunk.sourceId] });
  }
  return cases;
}

/**
 * Reduce a breadcrumb title to the part a person would type.
 *
 * `Ticket #42: Fix login > Solution (1/3)` becomes `Fix login > Solution`: the id
 * and the part counter are retrieval hints nobody types, and leaving them in would
 * measure exact-match rather than meaning.
 */
export function stripBreadcrumb(title: string): string {
  return title
    .replace(/^Ticket #\d+:\s*/, '')
    .replace(/^(Scratchpad|Assistant|Skill|Agent)\s*[:/]\s*/i, '')
    .replace(/\s*\(\d+\/\d+\)\s*$/, '')
    .trim();
}
