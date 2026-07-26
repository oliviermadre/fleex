import { describe, it, expect } from 'vitest';
import { DEFAULT_AGENT_MAX_TURNS, AGENT_MAX_TURNS_MIN, AGENT_MAX_TURNS_MAX } from '@fleex/shared';
import { buildSdkOptions } from '../../src/application/utils/build-sdk-options.js';

const ctx = { model: 'claude-opus-5', systemPrompt: 'sys' };

describe('buildSdkOptions — maxTurns', () => {
  it('falls back to the default when no budget is configured', () => {
    expect(buildSdkOptions('plan', ctx).maxTurns).toBe(DEFAULT_AGENT_MAX_TURNS);
    expect(buildSdkOptions('edit', ctx).maxTurns).toBe(DEFAULT_AGENT_MAX_TURNS);
  });

  it('honours a configured budget for plan and edit', () => {
    expect(buildSdkOptions('plan', { ...ctx, maxTurns: 42 }).maxTurns).toBe(42);
    expect(buildSdkOptions('edit', { ...ctx, maxTurns: 42 }).maxTurns).toBe(42);
  });

  it('clamps out-of-range and non-integer values', () => {
    expect(buildSdkOptions('edit', { ...ctx, maxTurns: 0 }).maxTurns).toBe(AGENT_MAX_TURNS_MIN);
    expect(buildSdkOptions('edit', { ...ctx, maxTurns: -5 }).maxTurns).toBe(AGENT_MAX_TURNS_MIN);
    expect(buildSdkOptions('edit', { ...ctx, maxTurns: 999_999 }).maxTurns).toBe(AGENT_MAX_TURNS_MAX);
    expect(buildSdkOptions('edit', { ...ctx, maxTurns: 12.9 }).maxTurns).toBe(12);
    expect(buildSdkOptions('edit', { ...ctx, maxTurns: NaN }).maxTurns).toBe(DEFAULT_AGENT_MAX_TURNS);
  });

  it('leaves talk-mode permission guards untouched', () => {
    // 0 and 4 are defense-in-depth tool guards, not a turn budget.
    expect(buildSdkOptions('talk', { ...ctx, maxTurns: 500 }).maxTurns).toBe(0);
    expect(buildSdkOptions('talk', { ...ctx, maxTurns: 500, talkCanReadImages: true }).maxTurns).toBe(4);
  });
});
