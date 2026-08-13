import { describe, it, expect } from 'vitest';
import {
  isMemoryFeatureEnabled,
  MEMORY_FEATURE_KEYS,
  type AppConfig,
  type MemoryFeatureFlags,
} from '../../src/application/ports/config.port.js';
import { hasHumanFeedback, HUMAN_FEEDBACK_TAG, chunkCommentThread } from '../../src/application/memory/chunker.js';
import { hybridScore, HUMAN_FEEDBACK_BONUS } from '../../src/application/memory/scoring.js';
import { MemoryChunkEntity } from '../../src/domain/entities/memory-chunk.entity.js';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { basePath: '/tmp', defaultShell: 'bash', repositoryRefreshIntervalMs: 0, ...overrides } as AppConfig;
}

describe('isMemoryFeatureEnabled', () => {
  it('is false for every feature under the legacy engine', () => {
    const legacy = config({ memoryEngine: 'legacy', memoryFeatures: { ask: true, paletteSearch: true } });
    for (const key of MEMORY_FEATURE_KEYS) {
      // These features all read the index; running any under legacy would either
      // fail or silently do nothing.
      expect(isMemoryFeatureEnabled(legacy, key)).toBe(false);
    }
  });

  it('is false for every feature when no engine is configured', () => {
    for (const key of MEMORY_FEATURE_KEYS) {
      expect(isMemoryFeatureEnabled(config(), key)).toBe(false);
    }
  });

  it('defaults to enabled under the semantic engine', () => {
    const semantic = config({ memoryEngine: 'semantic' });
    for (const key of MEMORY_FEATURE_KEYS) {
      // Opting into the engine is already the deliberate choice; a user disables
      // rather than opting in twice.
      expect(isMemoryFeatureEnabled(semantic, key)).toBe(true);
    }
  });

  it('respects an explicit false', () => {
    const semantic = config({ memoryEngine: 'semantic', memoryFeatures: { ask: false } });
    expect(isMemoryFeatureEnabled(semantic, 'ask')).toBe(false);
    // Disabling one must not disable its neighbours.
    expect(isMemoryFeatureEnabled(semantic, 'paletteSearch')).toBe(true);
  });

  it('treats an explicit true the same as the default', () => {
    const semantic = config({ memoryEngine: 'semantic', memoryFeatures: { repoScope: true } });
    expect(isMemoryFeatureEnabled(semantic, 'repoScope')).toBe(true);
  });

  it('enumerates every flag in the shape, so a new one cannot go unlisted', () => {
    const keys: Array<keyof MemoryFeatureFlags> = [
      'paletteSearch', 'ask', 'repoScope', 'duplicateDetection', 'humanFeedbackBoost',
      'personaCoach', 'synthesis', 'curation', 'assistantMemory', 'automationMining', 'wikiLinks',
      'executionTraces',
    ];
    expect([...MEMORY_FEATURE_KEYS].sort()).toEqual(keys.sort());
  });
});

describe('hasHumanFeedback', () => {
  const user = (body: string) => ({ id: body, authorName: 'Olivier', authorType: 'user', body });
  const agent = (body: string) => ({ id: body, authorName: 'Builder', authorType: 'agent', body });

  it('detects a human replying after an agent', () => {
    expect(hasHumanFeedback([agent('here is my draft'), user('no, use sessions')])).toBe(true);
  });

  it('is false when the human only spoke first', () => {
    // The opening request is not feedback on anything.
    expect(hasHumanFeedback([user('please do this'), agent('done')])).toBe(false);
  });

  it('is false for an agent-only thread', () => {
    expect(hasHumanFeedback([agent('a'), agent('b')])).toBe(false);
  });

  it('is false for a human-only thread', () => {
    expect(hasHumanFeedback([user('a'), user('b')])).toBe(false);
  });

  it('detects feedback later in a long thread', () => {
    expect(hasHumanFeedback([
      user('please do this'), agent('done'), user('actually not like that'),
    ])).toBe(true);
  });

  it('is false for an empty thread', () => {
    expect(hasHumanFeedback([])).toBe(false);
  });
});

describe('comment thread tagging', () => {
  const ticket = { id: 't1', displayId: 7, title: 'Fix login', boardId: 'b1', tags: ['auth'] };

  it('tags a thread where a human corrected an agent', () => {
    const chunks = chunkCommentThread(ticket, [
      { id: 'c1', authorName: 'Builder', authorType: 'agent', body: 'I used JWT' },
      { id: 'c2', authorName: 'Olivier', authorType: 'user', body: 'no, sessions — we need revocation' },
    ]);
    expect(chunks[0]?.metadata.tags).toContain(HUMAN_FEEDBACK_TAG);
    // The ticket's own tags survive alongside it.
    expect(chunks[0]?.metadata.tags).toContain('auth');
  });

  it('leaves an ordinary thread untagged', () => {
    const chunks = chunkCommentThread(ticket, [
      { id: 'c1', authorName: 'Olivier', authorType: 'user', body: 'please look at this' },
    ]);
    expect(chunks[0]?.metadata.tags).toEqual(['auth']);
  });

  it('does not duplicate the tag when the ticket already carries it', () => {
    const chunks = chunkCommentThread(
      { ...ticket, tags: ['auth', HUMAN_FEEDBACK_TAG] },
      [
        { id: 'c1', authorName: 'Builder', authorType: 'agent', body: 'draft' },
        { id: 'c2', authorName: 'Olivier', authorType: 'user', body: 'no' },
      ],
    );
    const occurrences = chunks[0]!.metadata.tags!.filter((t) => t === HUMAN_FEEDBACK_TAG);
    expect(occurrences).toHaveLength(1);
  });
});

describe('human feedback boost', () => {
  const now = new Date('2026-08-13T00:00:00Z');

  function hit(tags: string[], similarity: number) {
    return {
      chunk: MemoryChunkEntity.create({
        sourceKind: 'comment_thread', sourceId: 's', chunkIndex: 0,
        title: 't', content: 'c', metadata: { tags },
      }),
      similarity,
    };
  }

  it('lifts a tagged chunk above an equally similar untagged one', () => {
    const tagged = hybridScore(hit([HUMAN_FEEDBACK_TAG], 0.6), { now, boostHumanFeedback: true });
    const plain = hybridScore(hit([], 0.6), { now, boostHumanFeedback: true });
    expect(tagged).toBeGreaterThan(plain);
    expect(tagged - plain).toBeCloseTo(HUMAN_FEEDBACK_BONUS, 6);
  });

  it('changes nothing when the feature is off', () => {
    const tagged = hybridScore(hit([HUMAN_FEEDBACK_TAG], 0.6), { now });
    const plain = hybridScore(hit([], 0.6), { now });
    expect(tagged).toBe(plain);
  });

  it('does not let a correction outrank a clearly more relevant hit', () => {
    // The bonus reorders near-ties; a correction about another subject must still
    // lose to on-topic material.
    const offTopicCorrection = hybridScore(hit([HUMAN_FEEDBACK_TAG], 0.1), { now, boostHumanFeedback: true });
    const onTopic = hybridScore(hit([], 0.95), { now, boostHumanFeedback: true });
    expect(onTopic).toBeGreaterThan(offTopicCorrection);
  });

  it('keeps the score within [0, 1]', () => {
    const maxed = hybridScore(
      hit([HUMAN_FEEDBACK_TAG, 'x'], 1),
      { now, boostHumanFeedback: true, tags: ['x'], repo: 'r', boardId: 'b' },
    );
    expect(maxed).toBeLessThanOrEqual(1);
  });
});
