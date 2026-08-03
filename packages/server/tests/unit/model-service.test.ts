import { describe, it, expect } from 'vitest';

import { ModelService } from '../../src/application/services/model.service.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

// Minimal stub matching the shape ModelService consumes from the SDK.
function makeFakeClient(
  data: Array<{ id: string; display_name?: string | null }>,
  opts: { throws?: boolean } = {},
) {
  return {
    models: {
      async list() {
        if (opts.throws) throw new Error('boom');
        return { data };
      },
    },
  } as unknown as ConstructorParameters<typeof ModelService>[2] extends () => infer R ? R : never;
}

describe('ModelService', () => {
  it('returns Anthropic models sorted by family (opus > sonnet > haiku) then version desc', async () => {
    const fake = makeFakeClient([
      { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
      { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6' },
      { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
      { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
      { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
    ]);
    const svc = new ModelService(new FakeLoggerPort(), 60_000, () => fake as never);

    const { models, fallback } = await svc.getAvailableModels();

    expect(fallback).toBe(false);
    // Single-token generation ids (opus-5 → 500) must outrank 'major-minor'
    // ones (opus-4-8 → 408), so the newest Opus heads the dropdown.
    expect(models.map((m) => m.id)).toEqual([
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ]);
  });

  it('maps Opus 5 with effort + fast-mode support and a derived label', async () => {
    // No display_name: exercises deriveLabel on a single-token generation id.
    const fake = makeFakeClient([{ id: 'claude-opus-5' }]);
    const svc = new ModelService(new FakeLoggerPort(), 60_000, () => fake as never);

    const { models } = await svc.getAvailableModels();

    expect(models[0]).toEqual({
      id: 'claude-opus-5',
      label: 'Claude Opus 5',
      family: 'opus',
      supportsEffort: true,
      supportsFastMode: true,
      // Full ladder — the client enumerates this rather than re-deriving it.
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  it('excludes legacy Claude 1/2/instant models so dropdowns stay clean', async () => {
    const fake = makeFakeClient([
      { id: 'claude-1-2' },
      { id: 'claude-2-1' },
      { id: 'claude-instant-1-2' },
      { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
    ]);
    const svc = new ModelService(new FakeLoggerPort(), 60_000, () => fake as never);

    const { models } = await svc.getAvailableModels();
    expect(models.map((m) => m.id)).toEqual(['claude-opus-4-8']);
  });

  it('falls back to static FALLBACK_MODELS when the Anthropic API throws', async () => {
    const fake = makeFakeClient([], { throws: true });
    const svc = new ModelService(new FakeLoggerPort(), 60_000, () => fake as never);

    const { models, fallback } = await svc.getAvailableModels();

    expect(fallback).toBe(true);
    // Opus 5 must be present in fallback so the immediate UX works even
    // if Anthropic is unreachable on first boot.
    expect(models.some((m) => m.id === 'claude-opus-5')).toBe(true);
    expect(models.some((m) => m.id === 'claude-opus-4-8')).toBe(true);
  });

  it('caches results across calls within the TTL window', async () => {
    let calls = 0;
    const fake = {
      models: {
        async list() {
          calls++;
          return { data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }] };
        },
      },
    };
    const svc = new ModelService(new FakeLoggerPort(), 60_000, () => fake as never);

    await svc.getAvailableModels();
    await svc.getAvailableModels();
    await svc.getAvailableModels();

    expect(calls).toBe(1);
  });
});
