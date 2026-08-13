import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  hybridScore,
  rankHits,
  recencyScore,
  tagOverlapRatio,
  MAX_CHUNKS_PER_SOURCE,
  SCORING_WEIGHTS,
} from '../../src/application/memory/scoring.js';
import { MemoryChunkEntity, type MemorySourceKind, type MemoryChunkMetadata } from '../../src/domain/entities/memory-chunk.entity.js';
import type { MemorySearchHit } from '../../src/application/ports/memory-store.port.js';

function chunk(
  sourceId: string,
  metadata: MemoryChunkMetadata = {},
  sourceUpdatedAt: Date | null = null,
  sourceKind: MemorySourceKind = 'deliverable',
  chunkIndex = 0,
): MemoryChunkEntity {
  return MemoryChunkEntity.create({
    sourceKind, sourceId, chunkIndex, title: sourceId, content: 'body', metadata, sourceUpdatedAt,
  });
}

const hit = (c: MemoryChunkEntity, similarity: number): MemorySearchHit => ({ chunk: c, similarity });

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  it('is -1 for opposed vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 1]), new Float32Array([-1, -1]))).toBeCloseTo(-1, 6);
  });

  it('ignores magnitude', () => {
    expect(cosineSimilarity(new Float32Array([1, 1]), new Float32Array([10, 10]))).toBeCloseTo(1, 6);
  });

  it('returns 0 rather than NaN for a zero vector', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });

  it('returns 0 for mismatched widths instead of comparing partial vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toBe(0);
  });
});

describe('tagOverlapRatio', () => {
  it('is 1 when every anchor tag is matched', () => {
    expect(tagOverlapRatio(['a', 'b'], ['a', 'b', 'c'])).toBe(1);
  });

  it('is proportional to the anchor tags matched', () => {
    expect(tagOverlapRatio(['a', 'b'], ['a'])).toBe(0.5);
  });

  it('is 0 when either side has no tags', () => {
    expect(tagOverlapRatio([], ['a'])).toBe(0);
    expect(tagOverlapRatio(['a'], undefined)).toBe(0);
  });

  it('does not let duplicate candidate tags inflate the ratio', () => {
    expect(tagOverlapRatio(['a', 'b'], ['a', 'a', 'a'])).toBe(0.5);
  });
});

describe('recencyScore', () => {
  const now = new Date('2026-08-13T00:00:00Z');

  it('is 1 for content updated now', () => {
    expect(recencyScore(now, now)).toBe(1);
  });

  it('decays with age', () => {
    const older = recencyScore(new Date('2026-05-13T00:00:00Z'), now);
    const newer = recencyScore(new Date('2026-08-01T00:00:00Z'), now);
    expect(newer).toBeGreaterThan(older);
  });

  it('treats undated content as neutral, not stale', () => {
    // A hand-written scratchpad with no timestamp must not rank below old agent
    // output purely for lacking a date.
    expect(recencyScore(null, now)).toBe(0.5);
    expect(recencyScore(null, now)).toBeGreaterThan(recencyScore(new Date('2025-01-01T00:00:00Z'), now));
  });
});

describe('hybridScore', () => {
  const now = new Date('2026-08-13T00:00:00Z');

  it('ranks a more similar chunk above a less similar one, all else equal', () => {
    const a = hybridScore(hit(chunk('a'), 0.9), { now });
    const b = hybridScore(hit(chunk('b'), 0.2), { now });
    expect(a).toBeGreaterThan(b);
  });

  it('rewards shared tags, same repo and same board', () => {
    const bare = hybridScore(hit(chunk('a'), 0.5), { now, tags: ['auth'], repo: 'org/app', boardId: 'b1' });
    const related = hybridScore(
      hit(chunk('b', { tags: ['auth'], repo: 'org/app', boardId: 'b1' }), 0.5),
      { now, tags: ['auth'], repo: 'org/app', boardId: 'b1' },
    );
    expect(related).toBeGreaterThan(bare);
  });

  it('weights repo affinity above board affinity', () => {
    const anchor = { now, repo: 'org/app', boardId: 'b1' };
    const sameRepo = hybridScore(hit(chunk('a', { repo: 'org/app' }), 0.5), anchor);
    const sameBoard = hybridScore(hit(chunk('b', { boardId: 'b1' }), 0.5), anchor);
    expect(sameRepo).toBeGreaterThan(sameBoard);
    expect(SCORING_WEIGHTS.sameRepo).toBeGreaterThan(SCORING_WEIGHTS.sameBoard);
  });

  it('never lets structural bonuses turn a negative similarity into a top hit', () => {
    // Cosine is remapped onto [0,1] before weighting, so an opposed vector keeps
    // the similarity term at 0 no matter how many bonuses it collects.
    const opposed = hybridScore(
      hit(chunk('a', { tags: ['auth'], repo: 'org/app', boardId: 'b1' }, new Date(now)), -1),
      { now, tags: ['auth'], repo: 'org/app', boardId: 'b1' },
    );
    const neutral = hybridScore(hit(chunk('b'), 0.8), { now });
    expect(opposed).toBeLessThan(neutral);
  });

  it('stays within [0, 1]', () => {
    const best = hybridScore(
      hit(chunk('a', { tags: ['x'], repo: 'r', boardId: 'b' }, now), 1),
      { now, tags: ['x'], repo: 'r', boardId: 'b' },
    );
    const worst = hybridScore(hit(chunk('b'), -1), { now });
    expect(best).toBeLessThanOrEqual(1);
    expect(worst).toBeGreaterThanOrEqual(0);
  });
});

describe('rankHits', () => {
  const now = new Date('2026-08-13T00:00:00Z');

  it('returns hits ordered by descending score', () => {
    const ranked = rankHits(
      [hit(chunk('a'), 0.1), hit(chunk('b'), 0.9), hit(chunk('c'), 0.5)],
      { now },
      10,
    );
    expect(ranked.map((r) => r.chunk.sourceId)).toEqual(['b', 'c', 'a']);
  });

  it('caps how many chunks one source can contribute', () => {
    // A long deliverable split into five sections must not fill the whole budget.
    const hits = Array.from({ length: 5 }, (_, i) =>
      hit(chunk('big', {}, null, 'deliverable', i), 0.9 - i * 0.01));
    hits.push(hit(chunk('other'), 0.5));

    const ranked = rankHits(hits, { now }, 10);
    const fromBig = ranked.filter((r) => r.chunk.sourceId === 'big');
    expect(fromBig).toHaveLength(MAX_CHUNKS_PER_SOURCE);
    expect(ranked.some((r) => r.chunk.sourceId === 'other')).toBe(true);
  });

  it('keeps a source best two chunks, not its first two', () => {
    const hits = [
      hit(chunk('big', {}, null, 'deliverable', 0), 0.10),
      hit(chunk('big', {}, null, 'deliverable', 1), 0.95),
      hit(chunk('big', {}, null, 'deliverable', 2), 0.90),
    ];
    const ranked = rankHits(hits, { now }, 10);
    expect(ranked.map((r) => r.chunk.chunkIndex)).toEqual([1, 2]);
  });

  it('honours the limit', () => {
    const hits = Array.from({ length: 8 }, (_, i) => hit(chunk(`s${i}`), 0.5));
    expect(rankHits(hits, { now }, 3)).toHaveLength(3);
  });

  it('is deterministic for equal scores, breaking ties on similarity', () => {
    const hits = [hit(chunk('a'), 0.4), hit(chunk('b'), 0.6)];
    const first = rankHits(hits, { now }, 10).map((r) => r.chunk.sourceId);
    const second = rankHits([...hits].reverse(), { now }, 10).map((r) => r.chunk.sourceId);
    expect(first).toEqual(second);
  });

  it('exposes the score it ranked on, so a run can report why an item was chosen', () => {
    const ranked = rankHits([hit(chunk('a'), 0.9)], { now }, 1);
    expect(ranked[0]!.score).toBeGreaterThan(0);
    expect(ranked[0]!.score).toBeLessThanOrEqual(1);
  });

  it('returns nothing for no hits', () => {
    expect(rankHits([], { now }, 5)).toEqual([]);
  });
});
