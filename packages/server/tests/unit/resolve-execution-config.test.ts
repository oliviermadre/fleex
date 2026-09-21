import { describe, it, expect } from 'vitest';
import { resolveExecutionConfig } from '../../src/application/utils/resolve-execution-config.js';

const persona = { executionMode: 'claude_code' as const, model: 'claude-sonnet-5' };

describe('resolveExecutionConfig', () => {
  it('uses the ticket conversation mode and the persona model by default', () => {
    const r = resolveExecutionConfig(persona, { conversationMode: 'edit', modelOverride: null, effortOverride: null, fastMode: false });
    expect(r).toMatchObject({ mode: 'edit', model: 'claude-sonnet-5', fast: false });
  });
  it('a message persona always runs in talk mode', () => {
    const r = resolveExecutionConfig({ ...persona, executionMode: 'message' }, { conversationMode: 'edit', modelOverride: null, effortOverride: null, fastMode: false });
    expect(r.mode).toBe('talk');
  });
  it('the ticket model override wins over the persona model', () => {
    const r = resolveExecutionConfig(persona, { conversationMode: 'plan', modelOverride: 'claude-opus-5', effortOverride: null, fastMode: false });
    expect(r.model).toBe('claude-opus-5');
  });
  it('no ticket → plan mode, persona model', () => {
    expect(resolveExecutionConfig(persona, null)).toMatchObject({ mode: 'plan', model: 'claude-sonnet-5' });
  });
});
