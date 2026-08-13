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

  const bonus = anchor.boostHumanFeedback && meta.tags?.includes(HUMAN_FEEDBACK_TAG)
    ? HUMAN_FEEDBACK_BONUS
    : 0;

  // Clamped so the score stays a comparable [0, 1] value whether or not the
  // bonus applied.
  return Math.min(1, weighted + bonus);
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
  const scored: ScoredHit[] = hits
    .map((hit) => ({ ...hit, score: hybridScore(hit, anchor) }))
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
