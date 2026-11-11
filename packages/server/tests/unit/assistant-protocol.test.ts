import { describe, it, expect } from 'vitest';
import { parseTurnToolInput, renderQuestions, isGoAnswer, appendDecision, carryDecisions, decisionsOf, computeTicketCost, renderTicketCost, MANDATE_OPTIONS, parseAssistantOutput, renderQuestion, assistantQuestions, buildAssistantSystemPrompt, buildAssistantUserPrompt, renderThreadStop, skillSummary, ACTION_TOOLS, extractRequestedTargets, withOriginalMessage, renderMentionReminder, ORIGINAL_MESSAGE_HEADER } from '../../src/application/assistant/assistant-protocol.js';

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

// Lot 2 — the human's actions win. The server enforces it; the prompt must still
// tell the assistant what it will be refused, and show it what it was not woken for.
describe("the human's actions in the assistant's prompts", () => {
  const context = { ticket: { displayId: 1, title: 'T', status: 'doing', type: null, priority: 'none', description: '' }, comments: [], deliverables: [] } as never;
  const base = { id: 'th1', targetType: 'agent', personaName: 'builder', status: 'idle', exchanges: 2, brief: 'Fix', failures: 0 };

  it('the system prompt states the rules: no relaunch of a user stop, no workaround through another target, closed ticket, human conclusion, human answer', () => {
    const system = buildAssistantSystemPrompt({ persona: { soulMd: '', identityMd: '', memoryMd: '' }, personas: [], assistantName: 'Nas' });
    expect(system).toContain("## Les actions de l'utilisateur priment");
    expect(system).toContain('Un réveil (réponse d\'un agent, fin d\'un workflow) ne lève jamais le blocage');
    expect(system).toContain('tu ne relances que si son message le demande');
    expect(system).toMatch(/Ne contourne pas un arrêt\*\* en confiant le même travail à une autre cible/);
    expect(system).toMatch(/Thread conclu par l'utilisateur\*\* : tu ne rouvres pas un thread sur le même sujet/);
    expect(system).toMatch(/`done` ou `cancelled`\*\* : sur un réveil, tu peux seulement conclure/);
    expect(system).toMatch(/L'utilisateur a répondu lui-même\*\* à la question d'un agent dans le thread : tu ne réponds pas à sa place/);
  });

  it('each thread line says who stopped its last run and when, and whether the hold stands', async () => {
    const { buildAssistantUserPrompt, renderThreadStop } = await import('../../src/application/assistant/assistant-protocol.js');
    const at = '2026-11-11T13:02:00.000Z';
    const clock = new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const held = { ...base, lastStop: { by: 'user', at, reason: 'mauvaise piste', mentionId: 'm1' }, userHoldAt: at } as never;
    const prompt = buildAssistantUserPrompt({ context, threads: [held], turns: [], trigger: { kind: 'user_message', commentId: 'c' } });
    expect(prompt).toContain(`dernier run arrêté par l'utilisateur à ${clock} [${at}] (mauvaise piste)`);
    expect(prompt).toContain('BLOCAGE UTILISATEUR');

    const mine = renderThreadStop({ ...base, lastStop: { by: 'assistant', at, reason: null, mentionId: 'm1' }, userHoldAt: null } as never);
    expect(mine).toContain(`dernier run arrêté par toi à ${clock}`);
    expect(mine).not.toContain('BLOCAGE');

    expect(renderThreadStop(base as never)).toBe('');
    // Hold lifted by the human, stop still on record until the next run.
    expect(renderThreadStop({ ...base, lastStop: { by: 'user', at, reason: null, mentionId: 'm1' }, userHoldAt: null } as never)).not.toContain('BLOCAGE');
    expect(renderThreadStop({ ...base, status: 'concluded', concludedBy: 'user', concludedAt: at } as never)).toContain("conclu par l'utilisateur");
    expect(renderThreadStop({ ...base, status: 'concluded', concludedBy: 'assistant', concludedAt: at } as never)).toBe('');
  });

  it('« Relancer » reaches the assistant as a request of the user, with the worktree check', async () => {
    const { buildAssistantUserPrompt } = await import('../../src/application/assistant/assistant-protocol.js');
    const prompt = buildAssistantUserPrompt({ context, threads: [base as never], turns: [], trigger: { kind: 'relaunch_request', threadId: 'th1' } });
    expect(prompt).toContain("L'utilisateur a cliqué « Relancer » sur le thread th1");
    expect(prompt).toContain('continue_thread');
    expect(prompt).toContain("l'état du worktree");
  });
});

// Lot 1 — stop a run and redirect it.
describe('stop_thread and continue_thread(interrupt)', () => {
  it('parses stop_thread with its reason, and refuses one without', () => {
    expect(parseAssistantOutput({ action: 'stop_thread', threadId: 'th1', reason: 'plus besoin' }, '')).toEqual({ action: 'stop_thread', threadId: 'th1', reason: 'plus besoin' });
    expect(parseAssistantOutput({ action: 'stop_thread', threadId: 'th1' }, '')).toBeNull();
    expect(parseAssistantOutput({ action: 'stop_thread', reason: 'x' }, '')).toBeNull();
  });

  it('continue_thread interrupts only on a strict true; absent means the current behaviour (wait)', () => {
    expect(parseAssistantOutput({ action: 'continue_thread', threadId: 'th1', turn: 'go' }, '')).toEqual({ action: 'continue_thread', threadId: 'th1', turn: 'go', interrupt: false });
    expect(parseAssistantOutput({ action: 'continue_thread', threadId: 'th1', turn: 'go', interrupt: true }, '')).toMatchObject({ interrupt: true });
    expect(parseAssistantOutput({ action: 'continue_thread', threadId: 'th1', turn: 'go', interrupt: 'yes' }, '')).toMatchObject({ interrupt: false });
  });

  it('both are offered as tools, with the fields the server needs', () => {
    const stop = ACTION_TOOLS.find((t) => t.name === 'stop_thread')!;
    expect(stop.input_schema.required).toEqual(['threadId', 'reason']);
    const cont = ACTION_TOOLS.find((t) => t.name === 'continue_thread')!;
    expect((cont.input_schema.properties as Record<string, { type: string }>).interrupt!.type).toBe('boolean');
    expect(cont.input_schema.required).toEqual(['threadId', 'turn']);
  });

  // Acceptance criterion: the « contredit / reste valable » rule is in the prompt.
  it('the prompt tells when to stop a running thread and when to let it finish', () => {
    const system = buildAssistantSystemPrompt({ persona: { soulMd: '', identityMd: '', memoryMd: '' }, personas: [], assistantName: 'Nas' });
    expect(system).toContain("Une nouvelle instruction de l'utilisateur contredit un thread en cours");
    expect(system).toMatch(/\*\*inutile ou nuisible\*\*[^\n]*\*\*arrête\*\* — `continue_thread` avec `interrupt: true`[^\n]*ou `stop_thread`/);
    expect(system).toMatch(/\*\*reste valable\*\*[^\n]*\*\*laisse finir\*\*[^\n]*transmettras à la fin du tour/);
  });

  it('the prompt frames the turn sent after a stop, and the announcement to the user', () => {
    const system = buildAssistantSystemPrompt({ persona: { soulMd: '', identityMd: '', memoryMd: '' }, personas: [], assistantName: 'Nas' });
    expect(system).toMatch(/Le tour envoyé après un arrêt\*\* dit ce qui est annulé et ce qui reste valable, et demande à l'agent de vérifier l'état du worktree/);
    expect(system).toContain('un run coupé peut laisser des modifications partielles');
    expect(system).toMatch(/Annonce l'arrêt à l'utilisateur en une phrase\*\*/);
    expect(system).toContain("Ne demande pas de confirmation avant d'arrêter");
    // Stop + redirect stays a single call by preference, even now that a turn may chain actions.
    expect(system).toContain('arrêter puis relancer (de préférence en UN appel, `continue_thread` avec `interrupt: true`)');
  });
});

// Lot 5 — an orchestrator, not an executor.
describe('orchestration rules in the prompt', () => {
  const system = buildAssistantSystemPrompt({ persona: { soulMd: '', identityMd: '', memoryMd: '' }, personas: [], assistantName: 'Nas' });
  const section = (title: string) => {
    const start = system.indexOf(`## ${title}`);
    expect(start).toBeGreaterThan(-1);
    const end = system.indexOf('\n## ', start + 1);
    return system.slice(start, end < 0 ? undefined : end);
  };

  // Acceptance criterion: the brief frame is in the prompt.
  it('the delegation brief has its six parts, in order, and says why', () => {
    const brief = section('Le brief de délégation');
    expect(brief).toContain('modèle moins capable que toi');
    expect(brief).toContain('elle ne voit que ton `turn` et le ticket');
    const parts = [
      /1\. \*\*Objectif\*\*, en une phrase/,
      /2\. \*\*Contexte utile\*\*, par référence aux livrables[^\n]*ne les recopie pas/,
      /3\. \*\*Contraintes et hors périmètre\*\*/,
      /4\. \*\*Définition de fini\*\*, avec les preuves attendues : tests lancés et leur résultat, lien de PR, livrable/,
      /5\. \*\*Refs de todo couvertes\*\*/,
      /6\. \*\*Rappel\*\* : elle te rend compte à toi[^\n]*elle ne mentionne pas l'opérateur humain/,
    ];
    const at = parts.map((re) => brief.search(re));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The tool the model fills carries the same frame.
    const turn = (ACTION_TOOLS.find((t) => t.name === 'delegate')!.input_schema.properties as Record<string, { description: string }>).turn!.description;
    expect(turn).toMatch(/objectif.*contexte par référence aux livrables.*hors périmètre.*définition de fini avec les preuves attendues.*refs de todo.*te rend compte à toi/);
  });

  // Acceptance criterion: the proof rule is in the prompt.
  it('verify before reporting: compare with the definition of done, and relaunch for a missing proof', () => {
    const verify = section('Vérifier avant de rapporter');
    expect(verify).toMatch(/\*\*compare le résultat à la définition de fini\*\*/);
    expect(verify).toMatch(/\*\*preuve absente, tu relances\*\* \(`continue_thread`\) en demandant précisément cette preuve/);
  });

  it('the review rule is generic: any persona or skill whose role is review, no name wired in', () => {
    const verify = section('Vérifier avant de rapporter');
    expect(verify).toMatch(/\*\*Pour du code\*\* : si une persona ou un skill de ton équipe a pour rôle la revue[^\n]*\*\*délègue-lui la revue avant de rendre compte\*\*/);
    // No persona, skill or workflow name appears in the rule: the roster below is the only place names come from.
    const withTeam = buildAssistantSystemPrompt({
      persona: { soulMd: '', identityMd: '', memoryMd: '' }, assistantName: 'Nas',
      personas: [{ name: 'sentinel', displayName: 'Sentinel', identityMd: 'Relit le code.' }],
    });
    const rule = withTeam.slice(withTeam.indexOf('## Vérifier avant de rapporter'), withTeam.indexOf('## Règles'));
    expect(rule).not.toMatch(/sentinel|reviewer|@agent:|@skill:/i);
  });

  it('several thread actions per turn, with the limits the server enforces', () => {
    expect(system).not.toContain('Une seule intention par tour');
    expect(system).toMatch(/enchaîner plusieurs actions de thread dans un même tour/);
    expect(system).toMatch(/conclure un thread puis déléguer l'étape suivante/);
    expect(system).toContain('**une seule action de lancement par thread et par tour**');
    expect(system).toContain('**3 lancements par tour au plus**');
    expect(system).toMatch(/\*\*3 threads `running` au plus par ticket\*\*, un par cible, un seul workflow/);
    expect(system).toContain('**un seul thread en mode edit à la fois par ticket**');
    expect(ACTION_TOOLS.find((t) => t.name === 'delegate')!.description).not.toContain('Une seule délégation par tour');
  });

  it('the turn cap: the server asks « Continuer » / « Conclure », the assistant neither re-asks nor concludes on its own', () => {
    expect(system).toMatch(/après 20 tours envoyés dans un même thread[^\n]*« Continuer » \/ « Conclure », une seule fois[^\n]*Ne la repose pas et ne conclus pas de toi-même/);
  });

  it('a pending turn-cap question shows on the thread line; a concluded thread no longer carries it', () => {
    const th = {
      id: 'th1', ticketId: 't1', initiator: 'assistant', targetType: 'agent', personaId: 'p', personaName: 'builder', assistantPersonaId: 'a',
      brief: 'b', forwardedContext: [], status: 'waiting', currentMentionId: null, exchanges: 20, failures: 0, summary: null,
      createdAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z', concludedAt: null,
      turnCap: { base: 0, askedAt: '2026-11-11T13:02:00.000Z' },
    } as const;
    expect(renderThreadStop(th)).toMatch(/plafond de tours atteint, question « Continuer \/ Conclure » posée à l'utilisateur.*\[2026-11-11T13:02:00\.000Z\].*ne la repose pas/);
    expect(renderThreadStop({ ...th, turnCap: { base: 20, askedAt: null } })).toBe('');
    expect(renderThreadStop({ ...th, status: 'concluded' })).toBe('');
  });

  it('a thread wake-up invites to check the definition of done and to chain the next step in the same turn', () => {
    const prompt = buildAssistantUserPrompt({
      context: { ticket: { displayId: 1, title: 'T', status: 'doing', priority: 'medium', conversationMode: 'plan' }, comments: [], deliverables: [] } as never,
      threads: [], turns: [], trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'resolved' },
    });
    expect(prompt).toMatch(/Compare sa réponse à la définition de fini de ton brief/);
    expect(prompt).toMatch(/lance-la dans ce même tour \("delegate"\) sans attendre l'utilisateur/);
    expect(prompt).toMatch(/exigeant le livrable ou la preuve qui manque/);
  });
});

// Lot 4: how the assistant steers the todo. Each rule is pinned by the words that carry it.
describe('assistant prompt — steering the todo', () => {
  const base = { persona: { soulMd: '', identityMd: '', memoryMd: '' }, personas: [], assistantName: 'Nas' };
  const on = buildAssistantSystemPrompt({ ...base, todoAccess: true });
  const section = on.slice(on.indexOf('## La todo du ticket'), on.indexOf("## Les actions de l'utilisateur priment"));

  it('is in the system prompt only when todo access is on (off by default)', () => {
    expect(section.length).toBeGreaterThan(200);
    for (const off of [buildAssistantSystemPrompt(base), buildAssistantSystemPrompt({ ...base, todoAccess: false })]) {
      expect(off).not.toContain('## La todo du ticket');
      expect(off).not.toContain('fleex_ticket_todo');
    }
  });
  it('plans in items for a multi-step task, none for a short one', () => {
    expect(section).toMatch(/au moins 3 étapes, ou 2 délégations.*pose le plan en items/);
    expect(section).toMatch(/Tâche courte : pas de todo/);
  });
  it('gives every item an assignee: the persona slug, or `user` for what only the human can do', () => {
    expect(section).toMatch(/Chaque item a un destinataire.*slug de la persona.*`user`.*l'utilisateur seul peut faire/);
  });
  it('has each delegation turn cite the refs, pointing at the brief frame instead of restating it', () => {
    expect(section).toMatch(/Chaque `turn` de délégation cite les refs concernées.*point 5 de la trame/);
    // The frame itself (lot 5) is stated once.
    expect(on.match(/Refs de todo couvertes/g)).toHaveLength(1);
  });
  it('reconciles the todo with the result when a thread comes back', () => {
    expect(section).toMatch(/Au retour d'un thread.*coche ce que la cible a fait sans le cocher.*rouvre ce qui est coché sans preuve.*ajoute les étapes découvertes/);
  });
  it('cancels only with a reason and is not offered deletion', () => {
    expect(section).toMatch(/Tu n'annules qu'avec une raison/);
    expect(section).toMatch(/La suppression ne t'est pas proposée/);
  });
  it('leaves the human’s items alone', () => {
    expect(section).toMatch(/items assignés à l'utilisateur sont les siens.*ne les coches pas.*ne les modifies pas.*ne les annules pas.*ne te les réassignes pas sans qu'il te le demande/);
  });
  it('never says « terminé » with open non-user items, and lists what is left to the human', () => {
    expect(section).toMatch(/Tu n'annonces « terminé » que si tous les items hors `user` sont faits ou annulés/);
    expect(section).toMatch(/message final liste les items qui restent à l'utilisateur/);
  });
  it('reads a human change as an instruction at the next turn, without being woken for it', () => {
    expect(section).toMatch(/Un changement de l'utilisateur dans la todo est une instruction.*à ton prochain tour/);
    expect(section).toMatch(/Tu n'es pas réveillé par un changement de todo/);
  });
  it('the environment preamble lists the todo among the CLI tools only when it is offered', () => {
    const env = { ticketId: 't1', displayId: 1, workspace: 'qa', cliToolCount: 5 };
    expect(buildAssistantSystemPrompt({ ...base, env, todoAccess: true })).toContain('livrables, todo.');
    expect(buildAssistantSystemPrompt({ ...base, env })).toContain('liens, livrables. Ce qui');
  });
});

describe('assistant user prompt — the todo section', () => {
  const context = { ticket: { displayId: 7, title: 'T', status: 'doing', priority: 'none', conversationMode: 'plan', description: '' }, comments: [], deliverables: [] } as never;
  const build = (todo?: { section: string | null } | null) => buildAssistantUserPrompt({ context, threads: [], turns: [], trigger: { kind: 'ticket_created' }, todo });

  it('inserts the rendered section before the trigger, with how to act on it', () => {
    const out = build({ section: '\n## Todo list\n\n1 open · 0 done · 0 cancelled\n### For you (nas)\n- [ ] #1 Cadrer — by olivier\n' });
    expect(out).toContain('### For you (nas)\n- [ ] #1 Cadrer — by olivier\n> Refs par ticket.');
    expect(out).toContain('`fleex_ticket_todo_*` (`7` comme ticket)');
    expect(out.indexOf('## Todo list')).toBeLessThan(out.indexOf('## Déclencheur'));
    expect(out.indexOf('## Todo list')).toBeGreaterThan(out.indexOf('## Autres livrables du ticket'));
  });
  it('says the list is empty rather than hiding that it exists', () => {
    expect(build({ section: null })).toContain('## Todo list\n(vide)\n');
  });
  it('says nothing at all when todo access is off: the prompt is the one of before', () => {
    expect(build(null)).toBe(build());
    expect(build(null)).not.toMatch(/todo/i);
  });
});

describe('mentions in a message to the assistant', () => {
  const system = buildAssistantSystemPrompt({ persona: { soulMd: '', identityMd: '', memoryMd: '' }, personas: [], assistantName: 'Nas' });
  const section = system.slice(system.indexOf("## Mentions de l'utilisateur"), system.indexOf("## Les actions de l'utilisateur priment"));

  it('the prompt states the rules of the order: verbatim turn, continue an open thread, parallel then sequence, refusals, unknown slug, active workflow, hold, question', () => {
    expect(section).toContain('est **un ordre**');
    expect(section).toContain('**Le `turn` contient son message tel quel**, pièces jointes comprises');
    expect(section).toContain('tu ne retires rien et tu ne réinterprètes pas sa demande');
    expect(section).toContain('**Thread déjà ouvert avec la cible : continue-le.**');
    expect(section).toContain('un thread par cible, dans ce même tour, en parallèle par défaut');
    expect(section).toMatch(/En séquence si le message exprime un ordre\*\* \(« puis », « ensuite »\)/);
    expect(section).toContain('**Le serveur refuse un lancement**');
    expect(section).toContain('**Slug inconnu ou désactivé : aucun thread.** Donne la liste de ce qui existe');
    expect(section).toContain("**Workflow mentionné alors qu'un run est actif : pas de second run.**");
    expect(section).toContain('elle lève le blocage utilisateur de cette cible');
    expect(section).toContain('ne lance rien, réponds');
  });

  it('extracts the four kinds in the order written, once each, with the grammar of comment mentions', () => {
    expect(extractRequestedTargets('@skill:lint puis @agent:builder, @panel:archi, @workflow:review et encore @agent:builder')).toEqual([
      { type: 'skill', name: 'lint' }, { type: 'agent', name: 'builder' }, { type: 'panel', name: 'archi' }, { type: 'workflow', name: 'review' },
    ]);
    expect(extractRequestedTargets('rien ici, ni olivier@example.com ni @nas ni ~~@agent:old~~')).toEqual([]);
  });

  it('withOriginalMessage appends what the turn lacks, and only then', () => {
    expect(withOriginalMessage('Objectif : X.', ' @agent:c fais X ')).toBe(`Objectif : X.\n\n---\n${ORIGINAL_MESSAGE_HEADER}\n\n@agent:c fais X`);
    expect(withOriginalMessage('Contexte.\n@agent:c  fais\nX\nFini.', '@agent:c fais X')).toBe('Contexte.\n@agent:c  fais\nX\nFini.');
    // A paraphrase is not the message.
    expect(withOriginalMessage('@agent:c fais Y', '@agent:c fais X')).toContain(ORIGINAL_MESSAGE_HEADER);
  });

  it('the trigger lists each target with what the model must do about it', () => {
    const context = { ticket: { displayId: 7, title: 'T', status: 'doing', priority: 'none', conversationMode: 'plan', description: '' }, comments: [{ id: 'c1', body: 'hello', authorType: 'user', authorName: 'o', createdAt: '', threadId: null }], deliverables: [] } as never;
    const out = buildAssistantUserPrompt({
      context, threads: [], turns: [], trigger: { kind: 'user_message', commentId: 'c1' },
      requestedTargets: [
        { type: 'agent', name: 'a', valid: true },
        { type: 'agent', name: 'b', valid: true, openThread: { id: 'th-b', status: 'idle' } },
        { type: 'skill', name: 'zz', valid: false, error: 'Skill inconnu ou désactivé : « zz ». Skills disponibles : lint.' },
      ],
    });
    const trigger = out.slice(out.indexOf('## Déclencheur'));
    expect(trigger).toContain('- @agent:a — valide · aucun thread ouvert : ouvre-le ("delegate").');
    expect(trigger).toContain('- @agent:b — valide · thread déjà ouvert th-b (idle) : continue-le ("continue_thread"), n\'en ouvre pas un second.');
    expect(trigger).not.toContain('interrupt');
    expect(trigger).toContain('- @skill:zz — INVALIDE');
    expect(trigger).toContain('Skills disponibles : lint.');
    // No mention, nothing added.
    expect(buildAssistantUserPrompt({ context, threads: [], turns: [], trigger: { kind: 'user_message', commentId: 'c1' } })).not.toContain('Cibles mentionnées');
  });

  it('the reminder names the targets and offers both ways out', () => {
    expect(renderMentionReminder([{ type: 'agent', name: 'x' }, { type: 'skill', name: 'y' }])).toMatch(/tu n'as pas traité @agent:x, @skill:y\..*délègue maintenant.*explique pourquoi/);
  });
});

describe('mandate and escalation (lot 6) — the prompt', () => {
  const build = (todoAccess?: boolean) => buildAssistantSystemPrompt({ persona: { soulMd: '', identityMd: '', memoryMd: '' }, personas: [], assistantName: 'Nas', todoAccess });
  const system = build();
  const section = (title: string, from = system) => {
    const start = from.indexOf(`## ${title}`);
    expect(start).toBeGreaterThan(-1);
    const end = from.indexOf('\n## ', start + 1);
    return from.slice(start, end < 0 ? undefined : end);
  };
  const rules = section('Mandat et escalade');

  it('a multi-step task ends its framing with a mandate, before any build launch; a short task has none — same threshold as the todo', () => {
    expect(rules).toMatch(/\*\*Tâche à plusieurs étapes\*\* \(au moins 3 étapes, ou 2 délégations\) : \*\*termine le cadrage par un mandat, avant tout lancement de construction\.\*\*/);
    expect(rules).toMatch(/\*\*Tâche courte : pas de mandat\*\*/);
    // One threshold for the todo and the mandate: the two rules cannot drift apart.
    expect(section('La todo du ticket', build(true))).toContain('(au moins 3 étapes, ou 2 délégations)');
  });

  it('the mandate has its five parts, in order, and ONE question: Go / Ajuster', () => {
    const parts = ['**Objectif**', "**Critères d'acceptation**", '**Plan**', '**Ce que je décide seul**', '**Ce que je te remonte**'].map((x) => rules.indexOf(x));
    expect(parts.every((i) => i >= 0)).toBe(true);
    expect([...parts].sort((a, b) => a - b)).toEqual(parts);
    expect(rules).toContain("pose à l'utilisateur LA question « Go » / « Ajuster » à la fin du tour : n'en pose aucune autre dans ce tour");
    expect(MANDATE_OPTIONS).toEqual(['Go', 'Ajuster']);
    const tool = ACTION_TOOLS.find((t) => t.name === 'propose_mandate')!;
    expect(tool.description).toMatch(/livrable de type plan, en brouillon, à ton nom/);
    expect(tool.input_schema.required).toEqual(['title', 'markdown']);
  });

  it('only the human validates; « Ajuster » goes back to framing and revises the same deliverable', () => {
    expect(rules).toMatch(/\*\*Seul l'utilisateur le valide\*\*/);
    expect(rules).toContain('Un réveil ne valide jamais un mandat');
    expect(rules).toMatch(/\*\*« Ajuster » : retour au cadrage\.\*\*[^\n]*révise le mandat par `propose_mandate` \(le même livrable, nouvelle version\)/);
  });

  it('after Go it carries on without validation and interrupts the human for the five cases only — everything else is decided and noted', () => {
    expect(rules).toMatch(/\*\*Après le Go, tu enchaînes sans autre validation\*\*[^\n]*\*\*Tu n'interromps l'utilisateur que pour\*\* :/);
    const cases = [
      /1\. un \*\*choix produit\*\* que le mandat ne couvre pas ;/,
      /2\. une \*\*action irréversible ou externe\*\* : merge, push sur une branche partagée, suppression, déploiement ;/,
      /3\. un \*\*blocage\*\* : 3 échecs consécutifs, ou plafond de tours atteint/,
      /4\. un \*\*changement de mode d'exécution\*\* \(`request_mode`\) ;/,
      /5\. un \*\*item de todo assigné à l'utilisateur\*\* et qui bloque la suite\./,
    ];
    const at = cases.map((re) => rules.search(re));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(rules).not.toMatch(/\n  6\. /);
    expect(rules).toMatch(/\*\*Tout le reste, tu le décides et tu le notes\*\* : `note_decision`[^\n]*« Décisions prises » du mandat/);
  });

  it('questions are grouped: one message, 4 at most, declared — and it keeps going on what does not depend on the answer', () => {
    expect(rules).toMatch(/\*\*Questions groupées\*\*[^\n]*en UN message — `ask_user`, 4 questions au plus/);
    expect(rules).toMatch(/\*\*Pendant que tu attends, continue ce qui ne dépend pas de la réponse\*\*/);
    const schema = ACTION_TOOLS.find((t) => t.name === 'ask_user')!.input_schema.properties as { questions: { maxItems: number } };
    expect(schema.questions.maxItems).toBe(4);
  });

  // Acceptance criterion: the final report contains « Décisions prises ».
  it('the final report has its five headings, in order, « Décisions prises » with reasons and the cost as plain information', () => {
    const report = rules.slice(rules.indexOf('**Compte rendu final**'));
    const parts = ['**Résultat**', '**Preuves**', '**Décisions prises**', '**Reste pour toi**', '**Coût total du ticket**'].map((x) => report.indexOf(x));
    expect(parts.every((i) => i >= 0)).toBe(true);
    expect([...parts].sort((a, b) => a - b)).toEqual(parts);
    expect(report).toMatch(/\*\*Décisions prises\*\* \(celles notées au mandat, chacune avec sa raison/);
    expect(report).toMatch(/une information, sans seuil ni jugement ; un coût inconnu se dit inconnu/);
  });

  it('the older rules agree with it: the short-message rule excepts the final report, and choices go through ask_user', () => {
    const how = section('Comment tu agis');
    expect(how).toContain('pas de rapport — sauf le compte rendu final');
    expect(how).toContain("Pour poser un choix à l'utilisateur, utilise `ask_user`");
    expect(system).not.toContain('"reply"');
    // The failure and turn-cap rules are stated once, in « Règles »; the mandate only refers to them.
    expect(system.match(/Après 3 échecs consécutifs/g)).toHaveLength(1);
    expect(rules).not.toContain('Continuer');
  });

  it('the rules are there with or without todo access', () => {
    expect(build(true)).toContain('## Mandat et escalade');
    expect(build(false)).toContain('## Mandat et escalade');
  });
});

describe('mandate and escalation (lot 6) — the user prompt', () => {
  const context = { ticket: { displayId: 1, title: 'T', status: 'doing', type: null, priority: 'none', description: '' }, comments: [], deliverables: [] } as never;
  const base = { context, threads: [], turns: [], trigger: { kind: 'ticket_created' as const } };

  it('carries the mandate in full, with its state; none is said as none', () => {
    expect(buildAssistantUserPrompt(base)).toContain('## Mandat\n(aucun');
    const draft = buildAssistantUserPrompt({ ...base, mandate: { title: 'M', status: 'draft', version: 2, content: '## Objectif\nX\n\n## Décisions prises\n- d1 — Raison : r1' } });
    expect(draft).toContain('## Mandat\n« M » · v2 · BROUILLON, en attente du « Go » de l\'utilisateur : aucune cible qui écrit ne peut être lancée.');
    expect(draft).toContain('## Décisions prises\n- d1 — Raison : r1');
    const final = buildAssistantUserPrompt({ ...base, mandate: { title: 'M', status: 'final', version: 2, content: 'x' } });
    expect(final).toContain("validé (final) : exécute-le sans autre validation ; n'interromps l'utilisateur que pour les 5 cas prévus");
    expect(buildAssistantUserPrompt({ ...base, mandate: { title: 'M', status: 'final', version: 2, content: 'x', justValidated: true } })).toContain("VALIDÉ À L'INSTANT");
  });

  it('carries the cost only when the server computed it', () => {
    expect(buildAssistantUserPrompt(base)).not.toContain('## Coût du ticket');
    expect(buildAssistantUserPrompt({ ...base, cost: { knownUsd: 1.234, counted: 2, unknown: 0, running: 0 } })).toContain('## Coût du ticket\n1,23 $ sur 2 exécution(s) terminée(s)');
  });
});

describe('mandate and escalation (lot 6) — helpers', () => {
  it('isGoAnswer: the button, or the same word typed — nothing longer', () => {
    for (const yes of ['Go', 'go', ' GO ! ', 'Go.']) expect(isGoAnswer(yes)).toBe(true);
    for (const no of ['Ajuster', 'go ahead but drop the XLSX', 'ok', 'Gone', '']) expect(isGoAnswer(no)).toBe(false);
  });

  it('parseTurnToolInput validates the four tools', () => {
    expect(parseTurnToolInput('propose_mandate', { title: ' T ', markdown: 'M' })).toEqual({ tool: 'propose_mandate', title: 'T', markdown: 'M' });
    expect(parseTurnToolInput('propose_mandate', { title: 'T' })).toBeNull();
    expect(parseTurnToolInput('confirm_mandate', {})).toEqual({ tool: 'confirm_mandate' });
    expect(parseTurnToolInput('note_decision', { decision: 'd', reason: 'r' })).toEqual({ tool: 'note_decision', decision: 'd', reason: 'r' });
    expect(parseTurnToolInput('note_decision', { decision: 'd' })).toBeNull();
    const five = Array.from({ length: 5 }, (_, i) => ({ text: `q${i}`, options: ['a', 'b'] }));
    // All five are kept: refusing the fifth is the turn's job, so that none disappears in silence.
    expect(parseTurnToolInput('ask_user', { questions: five })).toEqual({ tool: 'ask_user', questions: five });
    expect(parseTurnToolInput('ask_user', { questions: [{ text: 'q', options: ['only'] }] })).toBeNull();
    expect(parseTurnToolInput('ask_user', { questions: [] })).toBeNull();
    expect(parseTurnToolInput('delegate', {})).toBeNull();
  });

  it('several questions are declared and restated in order', () => {
    const qs = [{ text: 'A ?', options: ['1', '2'] }, { text: 'B ?', options: ['3', '4'] }];
    expect(assistantQuestions(qs)).toEqual([{ prompt: 'A ?', options: ['1', '2'] }, { prompt: 'B ?', options: ['3', '4'] }]);
    expect(renderQuestions(qs)).toBe('\n\nA ?\n- 1\n- 2\n\nB ?\n- 3\n- 4');
  });

  it('appendDecision creates the section at the end, then appends inside it — even when another section follows', () => {
    const at = new Date('2026-11-11T10:05:00Z');
    const once = appendDecision('## Objectif\nX', 'Séparateur\n« ; »', 'Excel FR', at);
    expect(once).toBe('## Objectif\nX\n\n## Décisions prises\n- 2026-11-11 10:05 UTC — Séparateur « ; » — Raison : Excel FR\n');
    const twice = appendDecision(once, 'Pas de BOM', 'UTF-8', at);
    expect(decisionsOf(twice)).toEqual(['2026-11-11 10:05 UTC — Séparateur « ; » — Raison : Excel FR', '2026-11-11 10:05 UTC — Pas de BOM — Raison : UTF-8']);
    const middle = appendDecision('## Décisions prises\n- a\n\n## Annexe\nz', 'b', 'r', at);
    expect(middle).toBe('## Décisions prises\n- a\n- 2026-11-11 10:05 UTC — b — Raison : r\n\n## Annexe\nz');
  });

  it('carryDecisions keeps what was decided when a revision does not restate it', () => {
    const previous = '## Objectif\nX\n\n## Décisions prises\n- a\n- b\n';
    expect(carryDecisions('## Objectif\nY', previous)).toBe('## Objectif\nY\n\n## Décisions prises\n- a\n- b\n');
    expect(carryDecisions('## Objectif\nY\n\n## Décisions prises\n- a', previous)).toBe('## Objectif\nY\n\n## Décisions prises\n- a');
    expect(carryDecisions('## Objectif\nY', '## Objectif\nX')).toBe('## Objectif\nY');
  });

  it('computeTicketCost: unknown is not 0, running is not counted', () => {
    const cost = computeTicketCost([{ status: 'completed', costUsd: 1 }, { status: 'failed', costUsd: 0 }, { status: 'completed', costUsd: null }, { status: 'interrupted' }, { status: 'running', costUsd: 9 }]);
    expect(cost).toEqual({ knownUsd: 1, counted: 2, unknown: 2, running: 1 });
    expect(renderTicketCost(cost)).toMatch(/^au moins 1,00 \$ sur 2 exécution\(s\) terminée\(s\).*2 exécution\(s\) au coût inconnu.*Dis « au moins »/);
    expect(renderTicketCost({ knownUsd: 0, counted: 0, unknown: 0, running: 0 })).toBe("aucune exécution terminée pour l'instant.");
    expect(renderTicketCost({ knownUsd: 0, counted: 0, unknown: 3, running: 0 })).toMatch(/^inconnu \(3 exécution/);
  });
});
