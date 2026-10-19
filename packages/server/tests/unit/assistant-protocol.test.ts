import { describe, it, expect } from 'vitest';
import { parseAssistantOutput, renderQuestion, assistantQuestions, buildAssistantSystemPrompt, skillSummary, ACTION_TOOLS } from '../../src/application/assistant/assistant-protocol.js';

describe('parseAssistantOutput', () => {
  it('accepts a structured reply', () => {
    expect(parseAssistantOutput({ action: 'reply', message: 'Salut' }, '')).toEqual({ action: 'reply', message: 'Salut', question: null });
  });
  it('accepts a delegate with defaults for optional fields (an agent unless told otherwise)', () => {
    const a = parseAssistantOutput({ action: 'delegate', name: 'builder', brief: 'Fix e2e', turn: 'Go' }, '');
    expect(a).toEqual({ action: 'delegate', targetType: 'agent', name: 'builder', brief: 'Fix e2e', forward: ['ticket'], turn: 'Go', message: null });
  });
  it('delegates to a skill, a panel or a workflow by targetType', () => {
    for (const targetType of ['skill', 'panel', 'workflow'] as const) {
      expect(parseAssistantOutput({ action: 'delegate', targetType, name: 'x', brief: 'b', turn: 't' }, '')).toMatchObject({ targetType, name: 'x' });
    }
  });
  it('reads the target type from a mention prefix on the name, whatever targetType says', () => {
    expect(parseAssistantOutput({ action: 'delegate', name: '@agent:builder', brief: 'x', turn: 'y' }, '')).toMatchObject({ targetType: 'agent', name: 'builder' });
    expect(parseAssistantOutput({ action: 'delegate', targetType: 'agent', name: '@workflow:review', brief: 'x', turn: 'y' }, '')).toMatchObject({ targetType: 'workflow', name: 'review' });
  });
  it('still reads the legacy personaName as an agent', () => {
    expect(parseAssistantOutput({ action: 'delegate', personaName: 'builder', brief: 'x', turn: 'y' }, '')).toMatchObject({ targetType: 'agent', name: 'builder' });
  });
  it('treats an unknown targetType as an agent rather than dropping the delegation', () => {
    expect(parseAssistantOutput({ action: 'delegate', targetType: 'robot', name: 'builder', brief: 'x', turn: 'y' }, '')).toMatchObject({ targetType: 'agent' });
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
  it('restates the question and its options in the body, so the comment reads without buttons', () => {
    expect(renderQuestion({ text: 'Push it?', options: ['Push it', 'Hold'] })).toBe('\n\nPush it?\n- Push it\n- Hold');
    expect(renderQuestion(null)).toBe('');
    expect(renderQuestion({ text: 'x', options: ['only one'] })).toBe('');
  });
});

describe('assistantQuestions', () => {
  it('declares the question so the UI renders one button per option (buttons are never parsed from the body)', () => {
    expect(assistantQuestions({ text: 'Push it?', options: ['Push it', 'Hold'] })).toEqual([{ prompt: 'Push it?', options: ['Push it', 'Hold'] }]);
  });

  it('declares nothing when there is no closed choice to offer', () => {
    expect(assistantQuestions(null)).toBeNull();
    expect(assistantQuestions({ text: 'x', options: ['only one'] })).toBeNull();
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
    for (const a of ['delegate', 'continue_thread', 'conclude_thread', 'request_mode', 'fleex_*']) expect(s).toContain(`\`${a}\``);
  });

  // The regression NaS hit: identities were cut to their first line ("• Nom : The Builder"),
  // so the assistant could not tell the PM from the dev and sent a thin spec straight to the dev.
  it('injects every persona IDENTITY.md in full, so the assistant can tell who specifies from who builds', () => {
    const catalyst = '• Nom : The Catalyst\n• Rôle : PM. Transforme un besoin flou en spec exploitable.\n' + 'x'.repeat(400);
    const builder = '• Nom : The Builder\n• Rôle : Architecte, dev. Prend des specs et les transforme en logiciel.';
    const s = buildAssistantSystemPrompt({
      persona: { soulMd: '', identityMd: '', memoryMd: '' }, assistantName: 'Jarvis',
      personas: [{ name: 'catalyst', displayName: 'The Catalyst', identityMd: catalyst }, { name: 'builder', displayName: 'The Builder', identityMd: builder }],
    });
    expect(s).toContain(catalyst);
    expect(s).toContain(builder);
  });

  it('routes a thin spec to the persona whose role is to specify before the one who builds', () => {
    const s = buildAssistantSystemPrompt({ persona: { soulMd: '', identityMd: '', memoryMd: '' }, assistantName: 'Jarvis', personas: [] });
    expect(s).toMatch(/mal spécifiée ne part pas directement à l'exécution/);
    expect(s).toMatch(/persona dont l'identité dit qu'elle spécifie/);
  });

  it('lists the enabled skills, panels and workflows as delegation targets', () => {
    const s = buildAssistantSystemPrompt({
      persona: { soulMd: '', identityMd: '', memoryMd: '' }, assistantName: 'Jarvis', personas: [],
      capabilities: {
        skills: [{ name: 'rebase-remote-main', displayName: 'Rebase', description: 'Rebase the worktree on main.' }],
        panels: [{ name: 'leadership', displayName: 'Leadership', description: 'Arbitrates product choices.', members: ['The Catalyst', 'The Builder'] }],
        workflows: [{ slug: 'review', name: 'Review', description: 'Code review then QA.' }],
      },
    });
    expect(s).toContain('@skill:rebase-remote-main — Rebase : Rebase the worktree on main.');
    expect(s).toContain('@panel:leadership — Leadership : Arbitrates product choices. (membres : The Catalyst, The Builder)');
    expect(s).toContain('@workflow:review — Review : Code review then QA.');
  });

  it('says so when a catalogue is empty instead of leaving a blank section', () => {
    const s = buildAssistantSystemPrompt({ persona: { soulMd: '', identityMd: '', memoryMd: '' }, assistantName: 'J', personas: [] });
    expect(s).toMatch(/## Skills disponibles[^#]*\(aucun\)/);
  });

  it('exposes one delegate tool that takes the target type', () => {
    const delegate = ACTION_TOOLS.find((t) => t.name === 'delegate')!;
    expect((delegate.input_schema as { required: string[] }).required).toEqual(['targetType', 'name', 'brief', 'turn']);
  });
});

describe('skillSummary', () => {
  it('prefers the frontmatter description', () => {
    expect(skillSummary('---\nname: x\ndescription: "Rebase on main"\n---\n# Purpose\nLong text')).toBe('Rebase on main');
  });
  it('falls back to the first prose line, skipping headings', () => {
    expect(skillSummary('# Purpose\n\n## Rebase\nTon but est de rebase la branche.\nMore')).toBe('Ton but est de rebase la branche.');
  });
  it('is empty for an empty skill', () => {
    expect(skillSummary('')).toBe('');
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
    expect(failed).not.toContain('Cause :');
    const maxTurns = buildAssistantUserPrompt({ context, threads: [thread], turns: [], trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'failed', failure: { reason: 'max_turns', message: 'Reached maximum number of turns (20)' } } });
    expect(maxTurns).toContain('Cause : max_turns — Reached maximum number of turns (20).');
    expect(maxTurns).toContain('pas un problème de permissions');
    const waiting = buildAssistantUserPrompt({ context, threads: [thread], turns: [], trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'waiting_for_info' } });
    expect(waiting).toContain('sans sous-agent ni tâche de fond');
    expect(waiting).not.toContain('request_mode');
  });

  it('ticket_created sends a thin description to the specifying persona before asking the user', async () => {
    const { buildAssistantUserPrompt } = await import('../../src/application/assistant/assistant-protocol.js');
    const context = { ticket: { displayId: 1, title: 'T', status: 'doing', type: null, priority: 'none', description: '' }, comments: [], deliverables: [] } as never;
    const created = buildAssistantUserPrompt({ context, threads: [], turns: [], trigger: { kind: 'ticket_created' } });
    expect(created).toContain('délègue d\'abord la spécification à la persona dont c\'est le rôle');
    expect(created).toContain('que si lui seul peut trancher');
  });

  it('a workflow wake-up speaks of the run, and a human gate is relayed, never decided', async () => {
    const { buildAssistantUserPrompt } = await import('../../src/application/assistant/assistant-protocol.js');
    const context = { ticket: { displayId: 1, title: 'T', status: 'doing', type: null, priority: 'none', description: '' }, comments: [], deliverables: [] } as never;
    const thread = { id: 'th1', targetType: 'workflow', personaName: 'review', status: 'waiting', exchanges: 1, brief: 'x', failures: 0 } as never;
    const gate = buildAssistantUserPrompt({ context, threads: [thread], turns: [], trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'waiting_for_info', workflowRun: { id: 'r1', status: 'needs_review' } } });
    expect(gate).toContain('run r1');
    expect(gate).toContain('ne peux pas la prendre à la place de l\'utilisateur');
    expect(gate).toContain('@workflow:review');
    const done = buildAssistantUserPrompt({ context, threads: [thread], turns: [], trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'resolved', workflowRun: { id: 'r1', status: 'completed' } } });
    expect(done).toContain('est terminé');
    const failed = buildAssistantUserPrompt({ context, threads: [thread], turns: [], trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'failed', workflowRun: { id: 'r1', status: 'cancelled' } } });
    expect(failed).toContain('statut cancelled');
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
