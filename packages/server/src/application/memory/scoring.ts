import type { MemorySearchHit } from '../ports/memory-store.port.js';

/**
 * Weights of the hybrid score.
 *
 * Similarity dominates, but not alone: the structural signals are what the
 * previous tag-and-recency ranking got right, and dropping them would make
 * retrieval worse for the very case it handled well — a ticket whose siblings
 * share its tags and board. The remainder keeps a same-repo note ahead of an
 * equally similar one from an unrelated codebase.
 */
export const SCORING_WEIGHTS = {
  similarity: 0.65,
  tagOverlap: 0.15,
  sameRepo: 0.10,
  sameBoard: 0.05,
  recency: 0.05,
} as const;

/** Half-life of the recency term, in days. */
const RECENCY_HALFLIFE_DAYS = 45;

/**
 * At most this many chunks from one source may survive.
 *
 * Without the cap, one long deliverable split into eight sections monopolises
 * the whole context budget, and the agent sees one document instead of the four
 * different things it needed.
 */
export const MAX_CHUNKS_PER_SOURCE = 2;

/**
 * Additive bonus for a chunk carrying human corrections.
 *
 * Additive rather than a weight, because it is not a similarity signal: a thread
 * where someone corrected an agent is more *worth injecting* at equal relevance,
 * so it lifts an already-relevant hit rather than dragging in an irrelevant one.
 * Sized to reorder near-ties, not to dominate — a correction about another
 * subject must still lose to an on-topic hit.
 */
export const HUMAN_FEEDBACK_BONUS = 0.08;

/** Tag that marks a chunk as carrying human corrections. */
const HUMAN_FEEDBACK_TAG = 'human-feedback';

/**
 * Additive bonus for a chunk whose title answers the words of the question.
 *
 * Sized against a measurement, not a feeling. On a real corpus — 12 884 of
 * 16 959 chunks being meeting transcripts — the twelve results for "les OKR Q3
 * 2026" spanned 0.643 down to 0.629. Cosine cannot tell the document that
 * *defines* the OKRs from a meeting that *mentions* them, so the OKR document
 * ranked fourth behind three transcripts. Fourteen thousandths of a point is not
 * a ranking, it is a coin toss, and a title match is the cheapest signal that
 * breaks it: at 2/3 of the query's words matched this adds 0.08, enough to
 * settle the question.
 *
 * Additive and query-only, like the human-feedback bonus: it lifts a hit that
 * similarity already found rather than dragging in a title-alike, and it never
 * applies to ticket-anchored injection, which has no query to match against.
 */
export const TITLE_MATCH_BONUS = 0.12;

/**
 * Words carrying no retrieval signal, in the two languages this corpus mixes.
 *
 * Without them "les OKR" and "the OKR" would score a title containing only "les"
 * or "the" as a third of a match.
 */
const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'que', 'qui',
  'quoi', 'dans', 'sur', 'pour', 'par', 'avec', 'sans', 'est', 'sont', 'au',
  'aux', 'ce', 'ces', 'cet', 'cette', 'mon', 'ma', 'mes', 'son', 'sa', 'ses',
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'by', 'with', 'to',
  'is', 'are', 'what', 'which', 'that', 'this', 'these', 'from', 'at', 'it',
]);

/** Lowercase, unaccented content words of at least two characters. */
function contentWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Share of the question's content words that the title carries.
 *
 * Measured against the title rather than the body on purpose: a transcript of a
 * meeting about OKRs contains the word everywhere, which is exactly why the body
 * cannot separate it from the OKR document. A title is what someone chose to
 * call the thing.
 */
export function titleMatchRatio(
  query: string | undefined,
  title: string,
  weights?: Map<string, number>,
): number {
  if (!query) return 0;
  const wanted = new Set(contentWords(query));
  if (wanted.size === 0) return 0;

  const present = new Set(contentWords(title));
  let matched = 0;
  let total = 0;
  for (const word of wanted) {
    const weight = weights?.get(word) ?? 1;
    total += weight;
    if (present.has(word)) matched += weight;
  }
  return total > 0 ? matched / total : 0;
}

/**
 * How much each word of the question is worth, from how common it is here.
 *
 * Counting words equally rewarded the wrong thing. Asked for "les OKR Q3 2026",
 * two discussion threads outranked the OKR document itself on the strength of
 * `2026` alone — a word in hundreds of titles, which distinguishes nothing. `okr`
 * appears in a handful, and is the entire question.
 *
 * The document frequency is taken over the candidates already in hand, so this
 * costs no query and adapts to the corpus: in a workspace where every document
 * says OKR, the word stops earning its keep, which is correct.
 */
export function titleWordWeights(query: string, titles: string[]): Map<string, number> {
  const wanted = new Set(contentWords(query));
  const weights = new Map<string, number>();
  if (wanted.size === 0) return weights;

  const seenIn = new Map<string, number>();
  for (const title of titles) {
    for (const word of new Set(contentWords(title))) {
      if (wanted.has(word)) seenIn.set(word, (seenIn.get(word) ?? 0) + 1);
    }
  }

  const total = Math.max(1, titles.length);
  for (const word of wanted) {
    // Standard inverse document frequency, smoothed so a word absent from every
    // candidate title still yields a finite weight rather than dominating.
    weights.set(word, Math.log(1 + total / (1 + (seenIn.get(word) ?? 0))));
  }
  return weights;
}

export interface ScoringAnchor {
  tags?: string[];
  boardId?: string | null;
  repo?: string | null;
  /** Reference point for recency; defaults to now. */
  now?: Date;
  /**
   * Rank human corrections above ordinary discussion. Off unless the feature is
   * enabled, so the ranking stays exactly as it was for anyone who has not asked
   * for it.
   */
  boostHumanFeedback?: boolean;
  /**
   * The question being asked, when there is one.
   *
   * Set by search and by question answering; absent for ticket-anchored
   * injection, which has an anchor rather than a query. Its only use is the title
   * match, so leaving it unset keeps that ranking byte-for-byte unchanged.
   */
  query?: string;
  /**
   * Per-word weights for the title match, derived from the candidate pool by
   * `rankHits`. Absent means every word counts the same.
   */
  titleWeights?: Map<string, number>;
}

export interface ScoredHit extends MemorySearchHit {
  score: number;
}

/** Tag overlap as a ratio of the anchor's tags, so a tag-less anchor scores 0. */
export function tagOverlapRatio(anchorTags: string[] | undefined, candidateTags: string[] | undefined): number {
  if (!anchorTags?.length || !candidateTags?.length) return 0;
  const anchor = new Set(anchorTags);
  let shared = 0;
  for (const tag of new Set(candidateTags)) {
    if (anchor.has(tag)) shared++;
  }
  return shared / anchor.size;
}

/**
 * Recency in (0, 1], halving every `RECENCY_HALFLIFE_DAYS`.
 *
 * Undated content scores neutral rather than zero: a scratchpad with no
 * timestamp is not stale, its age is simply unknown, and penalising it would
 * bury hand-written notes under agent output.
 */
export function recencyScore(updatedAt: Date | null | undefined, now: Date = new Date()): number {
  if (!updatedAt) return 0.5;
  const days = (now.getTime() - updatedAt.getTime()) / 86_400_000;
  if (days <= 0) return 1;
  return 1 / (1 + days / RECENCY_HALFLIFE_DAYS);
}

/**
 * Combine similarity with the structural signals.
 *
 * Cosine is remapped from [-1, 1] onto [0, 1] first, so a negative similarity
 * cannot be offset into relevance by tag and board bonuses alone.
 */
export function hybridScore(hit: MemorySearchHit, anchor: ScoringAnchor): number {
  const now = anchor.now ?? new Date();
  const meta = hit.chunk.metadata;

  const similarity = (Math.max(-1, Math.min(1, hit.similarity)) + 1) / 2;
  const tags = tagOverlapRatio(anchor.tags, meta.tags);
  const sameRepo = anchor.repo && meta.repo && anchor.repo === meta.repo ? 1 : 0;
  const sameBoard = anchor.boardId && meta.boardId && anchor.boardId === meta.boardId ? 1 : 0;
  const recency = recencyScore(hit.chunk.sourceUpdatedAt, now);

  const weighted = (
    SCORING_WEIGHTS.similarity * similarity
    + SCORING_WEIGHTS.tagOverlap * tags
    + SCORING_WEIGHTS.sameRepo * sameRepo
    + SCORING_WEIGHTS.sameBoard * sameBoard
    + SCORING_WEIGHTS.recency * recency
  );

  const feedbackBonus = anchor.boostHumanFeedback && meta.tags?.includes(HUMAN_FEEDBACK_TAG)
    ? HUMAN_FEEDBACK_BONUS
    : 0;
  const titleBonus = TITLE_MATCH_BONUS
    * titleMatchRatio(anchor.query, hit.chunk.title, anchor.titleWeights);

  // Clamped so the score stays a comparable [0, 1] value whether or not the
  // bonuses applied.
  return Math.min(1, weighted + feedbackBonus + titleBonus);
}

/**
 * Score, sort, then diversify.
 *
 * The per-source cap is applied after sorting so a source keeps its two *best*
 * chunks rather than its first two, and ties break on similarity so the ordering
 * is deterministic — an unstable order would make the shadow comparison between
 * engines unreadable.
 */
export function rankHits(
  hits: MemorySearchHit[],
  anchor: ScoringAnchor,
  limit: number,
  maxPerSource: number = MAX_CHUNKS_PER_SOURCE,
): ScoredHit[] {
  // Word weights come from the candidates themselves, so they are computed once
  // per ranking rather than once per hit.
  const scoringAnchor: ScoringAnchor = anchor.query
    ? { ...anchor, titleWeights: titleWordWeights(anchor.query, hits.map((h) => h.chunk.title)) }
    : anchor;

  const scored: ScoredHit[] = hits
    .map((hit) => ({ ...hit, score: hybridScore(hit, scoringAnchor) }))
    .sort((a, b) => (b.score - a.score) || (b.similarity - a.similarity));

  const perSource = new Map<string, number>();
  const out: ScoredHit[] = [];

  for (const hit of scored) {
    if (out.length >= limit) break;
    const key = `${hit.chunk.sourceKind}:${hit.chunk.sourceId}`;
    const seen = perSource.get(key) ?? 0;
    if (seen >= maxPerSource) continue;
    perSource.set(key, seen + 1);
    out.push(hit);
  }
  return out;
}

/** Cosine similarity. Returns 0 for mismatched widths or a zero vector. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
