import { describe, it, expect } from 'vitest';
import { parseAssistantOutput, renderQuestion, buildAssistantSystemPrompt } from '../../src/application/assistant/assistant-protocol.js';

describe('parseAssistantOutput', () => {
  it('accepts a structured reply', () => {
    expect(parseAssistantOutput({ action: 'reply', message: 'Salut' }, '')).toEqual({ action: 'reply', message: 'Salut', question: null });
  });
  it('accepts a delegate with defaults for optional fields', () => {
    const a = parseAssistantOutput({ action: 'delegate', personaName: 'builder', brief: 'Fix e2e', turn: 'Go' }, '');
    expect(a).toEqual({ action: 'delegate', personaName: 'builder', brief: 'Fix e2e', forward: ['ticket'], turn: 'Go', message: null });
  });
  it('strips a leading @agent: from personaName', () => {
    const a = parseAssistantOutput({ action: 'delegate', personaName: '@agent:builder', brief: 'x', turn: 'y' }, '');
    expect(a).toMatchObject({ personaName: 'builder' });
  });
  it('falls back to JSON found in the text when structured output is missing', () => {
    const a = parseAssistantOutput(null, 'Voici:\n{"action":"conclude_thread","threadId":"th1","summary":"ok"}');
    expect(a).toMatchObject({ action: 'conclude_thread', threadId: 'th1', summary: 'ok' });
  });
  it('rejects an unknown action or a delegate without persona', () => {
    expect(parseAssistantOutput({ action: 'dance' }, '')).toBeNull();
    expect(parseAssistantOutput({ action: 'delegate', brief: 'x', turn: 'y' }, '')).toBeNull();
    expect(parseAssistantOutput(null, 'plain prose')).toBeNull();
  });
});

describe('renderQuestion', () => {
  it('renders the bullet list parseInlineOptions understands', () => {
    expect(renderQuestion({ text: 'Push it?', options: ['Push it', 'Hold'] })).toBe('\n\nPush it?\n- Push it\n- Hold');
    expect(renderQuestion(null)).toBe('');
    expect(renderQuestion({ text: 'x', options: ['only one'] })).toBe('');
  });
});

describe('buildAssistantSystemPrompt', () => {
  it('lists the delegable personas and the four actions', () => {
    const s = buildAssistantSystemPrompt({
      persona: { soulMd: 'SOUL', identityMd: '', memoryMd: '' }, assistantName: 'Nas',
      personas: [{ name: 'builder', displayName: 'The Builder', identityMd: 'Builds things.' }],
    });
    expect(s).toContain('SOUL');
    expect(s).toContain('@agent:builder');
    for (const a of ['reply', 'delegate', 'continue_thread', 'conclude_thread']) expect(s).toContain(`"${a}"`);
  });
});
