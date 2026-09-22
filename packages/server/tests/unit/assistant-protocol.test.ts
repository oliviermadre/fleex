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
    for (const a of ['delegate_to_persona', 'continue_thread', 'conclude_thread', 'request_mode', 'fleex_*']) expect(s).toContain(`\`${a}\``);
  });
});

describe('buildAssistantUserPrompt — triggers', () => {
  it('ticket_created and failed triggers carry the project-manager instructions', async () => {
    const { buildAssistantUserPrompt } = await import('../../src/application/assistant/assistant-protocol.js');
    const context = { ticket: { displayId: 1, title: 'T', status: 'doing', type: null, priority: 'none', description: '' }, comments: [], deliverables: [] } as never;
    const created = buildAssistantUserPrompt({ context, threads: [], turns: [], trigger: { kind: 'ticket_created' } });
    expect(created).toContain('Prends-le en charge');
    const thread = { id: 'th1', personaName: 'b', status: 'failed', exchanges: 2, brief: 'x', failures: 2 } as never;
    const failed = buildAssistantUserPrompt({ context, threads: [thread], turns: [], trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'failed' } });
    expect(failed).toContain('2 échec(s) consécutif(s)');
    expect(failed).toContain('continue_thread');
  });
});

describe('parseAssistantOutput — request_mode', () => {
  it('accepts a mode request and rejects an unknown mode', () => {
    expect(parseAssistantOutput({ action: 'request_mode', threadId: 't', mode: 'edit', message: 'why' }, '')).toEqual({ action: 'request_mode', threadId: 't', mode: 'edit', message: 'why' });
    expect(parseAssistantOutput({ action: 'request_mode', threadId: 't', mode: 'god', message: 'why' }, '')).toBeNull();
  });
});

describe('buildAssistantUserPrompt — thread deliverables', () => {
  it('inlines the full content of the thread deliverables and lists the others by title', async () => {
    const { buildAssistantUserPrompt } = await import('../../src/application/assistant/assistant-protocol.js');
    const d = (id: string, title: string, content: string) => ({ id, title, content, status: 'final', type: 'plan', agentName: 'The Builder', createdAt: 'now', mentionId: 'm1' });
    const context = { ticket: { displayId: 1, title: 'T', status: 'doing', type: null, priority: 'none', description: '', conversationMode: 'plan' }, comments: [], deliverables: [d('a', 'Plan', 'FULL PLAN BODY'), d('b', 'Autre', 'x')] } as never;
    const out = buildAssistantUserPrompt({ context, threads: [], turns: [], trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'resolved' }, threadDeliverables: [d('a', 'Plan', 'FULL PLAN BODY') as never] });
    expect(out).toContain('Livrable « Plan »');
    expect(out).toContain('FULL PLAN BODY');
    expect(out).toContain('- Autre (final, par The Builder)');
    expect(out).not.toContain('- Plan (final');
  });
});

describe('buildAssistantEnvPreamble', () => {
  it('degrades gracefully without workspace or docs', async () => {
    const { buildAssistantEnvPreamble } = await import('../../src/application/assistant/assistant-protocol.js');
    const s = buildAssistantEnvPreamble({ ticketId: 'u', displayId: 7, workspace: null, cliToolCount: 0 });
    expect(s).toContain('Workspace Fleex : **inconnu**');
    expect(s).toContain("n'a pas répondu");
    expect(s).toContain('uuid `u`');
  });
});
