import { describe, it, expect } from 'vitest';
import {
  TITLE_MATCH_BONUS,
  hybridScore,
  rankHits,
  titleMatchRatio,
  titleWordWeights,
} from '../../src/application/memory/scoring.js';
import { MemoryChunkEntity } from '../../src/domain/entities/memory-chunk.entity.js';
import type { MemorySearchHit } from '../../src/application/ports/memory-store.port.js';

function hit(title: string, similarity: number): MemorySearchHit {
  return {
    chunk: MemoryChunkEntity.create({
      sourceKind: 'deliverable',
      sourceId: `id-${title}`,
      chunkIndex: 0,
      title,
      content: 'body text long enough to matter',
      metadata: {},
      sourceUpdatedAt: null,
    }),
    similarity,
  };
}

/**
 * Why a lexical title signal exists at all.
 *
 * Measured on a live corpus of 16 959 chunks, 12 884 of them meeting
 * transcripts: the twelve results for "les OKR Q3 2026" spanned 0.643 to 0.629.
 * Cosine cannot separate the document that *defines* the OKRs from a meeting that
 * *mentions* them, so the OKR document ranked seventh. Fourteen thousandths of a
 * point is a coin toss, not a ranking.
 */
describe('titleMatchRatio', () => {
  it('scores a title that answers the question', () => {
    expect(titleMatchRatio('OKR Q3', 'OKR Q3 (Variable Q3) (2/4)')).toBe(1);
  });

  it('scores a partial match proportionally', () => {
    // "2026" is absent from the title, so two of the three words match.
    expect(titleMatchRatio('OKR Q3 2026', 'OKR Q3')).toBeCloseTo(2 / 3, 5);
  });

  it('scores an unrelated title at zero', () => {
    expect(titleMatchRatio('OKR Q3 2026', 'Monthly coffee')).toBe(0);
  });

  it('ignores the words that carry no signal', () => {
    // "les" must not count as a third of the question.
    expect(titleMatchRatio('les OKR', 'les notes de la semaine')).toBe(0);
  });

  it('matches across accents and case', () => {
    expect(titleMatchRatio('rétention', 'Objectif 3 — Retention')).toBe(1);
  });

  it('scores nothing without a query', () => {
    expect(titleMatchRatio(undefined, 'OKR Q3')).toBe(0);
  });

  it('scores nothing for a query made only of stopwords', () => {
    expect(titleMatchRatio('the and of', 'the and of')).toBe(0);
  });
});

describe('titleWordWeights', () => {
  it('weighs a rare word above a ubiquitous one', () => {
    // The failure this fixes: two discussion threads outranked the OKR document
    // on the strength of "2026" alone, a word in hundreds of titles.
    const titles = [
      'OKR Q3',
      'Retro du 2 juillet 2026',
      'imputation mai 2026',
      'Weekly Product 2026',
      'monthly coffee 2026',
    ];
    const weights = titleWordWeights('OKR 2026', titles);
    expect(weights.get('okr')!).toBeGreaterThan(weights.get('2026')!);
  });

  it('gives a word absent from every candidate a finite weight', () => {
    const weights = titleWordWeights('absent', ['something else']);
    expect(Number.isFinite(weights.get('absent')!)).toBe(true);
  });

  it('returns nothing for a query with no content words', () => {
    expect(titleWordWeights('the of and', ['whatever']).size).toBe(0);
  });
});

describe('hybridScore with a title match', () => {
  it('leaves ticket-anchored injection untouched', () => {
    // No query means no bonus, so the ranking agents already depend on is
    // byte-for-byte what it was.
    const h = hit('OKR Q3', 0.4);
    expect(hybridScore(h, {})).toBe(hybridScore(h, { query: undefined }));
  });

  it('lifts a matching title by at most the bonus', () => {
    const h = hit('OKR Q3', 0.4);
    const lifted = hybridScore(h, { query: 'OKR Q3' }) - hybridScore(h, {});
    expect(lifted).toBeCloseTo(TITLE_MATCH_BONUS, 5);
  });
});

describe('rankHits with a query', () => {
  it('puts the document named by the question first', () => {
    // The real ordering, with the real numbers: the OKR document trailed three
    // transcripts on cosine alone.
    const hits = [
      hit('Retro du 2 juillet 2026', 0.42),
      hit('monthly coffee 2026', 0.41),
      hit('OKR Q3 (Variable Q3)', 0.28),
    ];
    const ranked = rankHits(hits, { query: 'les OKR Q3 2026' }, 3);
    expect(ranked[0]!.chunk.title).toBe('OKR Q3 (Variable Q3)');
  });

  it('keeps cosine in charge when no title matches', () => {
    const hits = [hit('alpha note', 0.2), hit('beta note', 0.5)];
    const ranked = rankHits(hits, { query: 'something unrelated' }, 2);
    expect(ranked[0]!.chunk.title).toBe('beta note');
  });

  it('does not let a title match beat a far better cosine', () => {
    // The bonus reorders near-ties; it must not drag in a title-alike whose
    // content is elsewhere.
    const hits = [hit('OKR', -0.9), hit('quarterly objectives', 0.95)];
    const ranked = rankHits(hits, { query: 'OKR' }, 2);
    expect(ranked[0]!.chunk.title).toBe('quarterly objectives');
  });
});
