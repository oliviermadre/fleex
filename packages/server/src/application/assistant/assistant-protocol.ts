import type { AgentQuestion, AgentThread, AgentThreadTargetType, ConversationMode, TicketComment, TicketContext, TicketDeliverable } from '@fleex/shared';
import { sanitizeQuestions } from '../utils/agent-questions.js';
import { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';

export interface AssistantQuestion { text: string; options: string[] }

/** A `@type:slug` the human wrote in a message to the assistant: an order to delegate to it. */
export interface RequestedTarget { type: AgentThreadTargetType; name: string }

/** A requested target as the turn sees it, once checked against what exists on this ticket. */
export interface ResolvedRequestedTarget extends RequestedTarget {
  /** Known and enabled. An invalid target opens no thread. */
  valid: boolean;
  /** Invalid: why, with the list of what exists (the text `delegate` would answer). */
  error?: string;
  /** The open thread with this target, if any: the order continues it. */
  openThread?: { id: string; status: string };
  /** Valid but it cannot be launched now, whatever the model does (a workflow run is already active): why. */
  blocked?: string;
}

export type AssistantTrigger =
  | {
      kind: 'user_message';
      commentId: string;
      /** The targets the server extracted from the message, in the order the human wrote them. */
      requestedTargets?: RequestedTarget[];
    }
  | { kind: 'ticket_created' }
  | {
      kind: 'thread_reply';
      threadId: string;
      mentionStatus: 'resolved' | 'waiting_for_info' | 'failed';
      /** On `failed`: the scheduler's verdict (reason code + message), so the assistant relaunches for the right cause. */
      failure?: { reason: string; message: string };
      /** Workflow threads: the run the delegation started, and where it stands. */
      workflowRun?: { id: string; status: string };
    }
  | { kind: 'conclude_request'; threadId: string }
  /** The human clicked « Relancer » on a thread they had stopped: their request, like a message. */
  | { kind: 'relaunch_request'; threadId: string };

export type AssistantAction =
  | { action: 'reply'; message: string; question: AssistantQuestion | null }
  | { action: 'delegate'; targetType: AgentThreadTargetType; name: string; brief: string; forward: string[]; turn: string; message: string | null }
  | { action: 'continue_thread'; threadId: string; turn: string; /** Stop the run in progress first, then send the turn. */ interrupt: boolean }
  | { action: 'stop_thread'; threadId: string; reason: string }
  | { action: 'request_mode'; threadId: string; mode: ConversationMode; message: string }
  | { action: 'conclude_thread'; threadId: string; summary: string; message: string | null; question: AssistantQuestion | null };

/**
 * What the assistant does in a turn besides its thread actions: the mandate
 * (propose, confirm, note a decision) and its grouped questions to the human.
 */
export type AssistantTurnTool =
  | { tool: 'propose_mandate'; title: string; markdown: string }
  | { tool: 'confirm_mandate' }
  | { tool: 'note_decision'; decision: string; reason: string }
  | { tool: 'ask_user'; questions: AssistantQuestion[] };

/** The two answers to a mandate, as buttons. « Go » is the only thing that makes it final. */
export const MANDATE_OPTIONS = ['Go', 'Ajuster'] as const;
/** The deliverable type a mandate is written as. */
export const MANDATE_DELIVERABLE_TYPE = 'plan';
/** Questions one assistant message may declare (the same cap as an agent's). */
export const MAX_ASSISTANT_QUESTIONS = 4;
/** The section of the mandate where the decisions the assistant took alone are kept, turn after turn. */
export const DECISIONS_HEADING = '## Décisions prises';

/** True when a human message is the « Go » button (or the same word typed): nothing else validates a mandate without the model. */
export function isGoAnswer(body: string): boolean {
  return /^go[\s.!]*$/i.test(body.trim());
}

/** [start, end) of the « Décisions prises » section in the lines of a mandate, or null. */
function decisionsRange(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(DECISIONS_HEADING.toLowerCase()));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i]!)) { end = i; break; }
  }
  return [start, end];
}

/** The decisions noted in a mandate, one per entry (the section's bullet lines). */
export function decisionsOf(content: string): string[] {
  const lines = content.split('\n');
  const range = decisionsRange(lines);
  if (!range) return [];
  return lines.slice(range[0] + 1, range[1]).map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
}

/**
 * A decision appended to the « Décisions prises » section of a mandate (created
 * at the end when absent). The mandate is the assistant's only memory between
 * turns: what it notes here is what its final report can cite.
 */
export function appendDecision(content: string, decision: string, reason: string, at: Date): string {
  const flat = (x: string) => x.replace(/\s+/g, ' ').trim();
  const entry = `- ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC — ${flat(decision)} — Raison : ${flat(reason)}`;
  const lines = content.split('\n');
  const range = decisionsRange(lines);
  if (!range) return `${content.trimEnd()}\n\n${DECISIONS_HEADING}\n${entry}\n`;
  let last = range[1];
  while (last > range[0] + 1 && !lines[last - 1]!.trim()) last--;
  lines.splice(last, 0, entry);
  return lines.join('\n');
}

/**
 * The text of a revised mandate, with the decisions already noted in the
 * previous version carried over when the revision does not restate them: a
 * revision never erases what was decided.
 */
export function carryDecisions(markdown: string, previous: string): string {
  if (decisionsRange(markdown.split('\n'))) return markdown;
  const kept = decisionsOf(previous);
  if (kept.length === 0) return markdown;
  return `${markdown.trimEnd()}\n\n${DECISIONS_HEADING}\n${kept.map((d) => `- ${d}`).join('\n')}\n`;
}

/** What the ticket cost so far, from its executions. Unknown costs are counted apart, never as 0. */
export interface TicketCost { knownUsd: number; counted: number; unknown: number; running: number }

export function computeTicketCost(executions: ReadonlyArray<{ status?: string; costUsd?: number | null }>): TicketCost {
  const cost: TicketCost = { knownUsd: 0, counted: 0, unknown: 0, running: 0 };
  for (const e of executions) {
    if (e.status === 'running') cost.running += 1;
    else if (typeof e.costUsd === 'number' && Number.isFinite(e.costUsd)) { cost.knownUsd += e.costUsd; cost.counted += 1; }
    else cost.unknown += 1;
  }
  return cost;
}

/** The cost line the assistant quotes in its final report. Information only: no threshold, no judgment. */
export function renderTicketCost(c: TicketCost): string {
  const usd = `${c.knownUsd.toFixed(2).replace('.', ',')} $`;
  const unknown = c.unknown > 0 ? ` ; ${c.unknown} exécution(s) au coût inconnu, non comptée(s)` : '';
  const running = c.running > 0 ? ` ; ${c.running} en cours, pas encore comptée(s)` : '';
  if (c.counted === 0) {
    return c.unknown > 0
      ? `inconnu (${c.unknown} exécution(s) terminée(s), aucune n'a de coût enregistré)${running}. Dis « inconnu », pas 0.`
      : `aucune exécution terminée pour l'instant${running}.`;
  }
  return `${c.unknown > 0 ? 'au moins ' : ''}${usd} sur ${c.counted} exécution(s) terminée(s), agents et tours d'assistant compris, hors tour en cours${unknown}${running}.${c.unknown > 0 ? ' Dis « au moins », le total réel est inconnu.' : ''}`;
}

/**
 * The `@agent:` / `@skill:` / `@panel:` / `@workflow:` tags of a human message,
 * in the order they were written. Same grammar as the mentions a comment
 * creates (the comment entity's extractors, struck-through tags skipped) —
 * there is one definition of what a mention is.
 */
export function extractRequestedTargets(body: string): RequestedTarget[] {
  const found: RequestedTarget[] = [
    ...TicketCommentEntity.extractMentions(body).map((name) => ({ type: 'agent' as const, name })),
    ...TicketCommentEntity.extractSkillMentions(body).map((name) => ({ type: 'skill' as const, name })),
    ...TicketCommentEntity.extractPanelMentions(body).map((name) => ({ type: 'panel' as const, name })),
    ...TicketCommentEntity.extractWorkflowMentions(body).map((name) => ({ type: 'workflow' as const, name })),
  ];
  const at = (t: RequestedTarget) => body.indexOf(`@${t.type}:${t.name}`);
  return found.sort((a, b) => at(a) - at(b));
}

/** How a `turn` carries the human's message when the model did not quote it in full. */
export const ORIGINAL_MESSAGE_HEADER = "Message d'origine de l'utilisateur (transmis tel quel par le serveur) :";

/**
 * The turn sent to a target the human mentioned must contain their message as
 * is, attachments included: the assistant may add context, it removes nothing.
 * When the turn does not already contain it (whitespace aside), it is appended
 * verbatim — nothing the model wrote is touched.
 */
export function withOriginalMessage(turn: string, original: string): string {
  const flat = (x: string) => x.replace(/\s+/g, ' ').trim();
  const message = original.trim();
  if (!message || flat(turn).includes(flat(message))) return turn;
  return `${turn.trimEnd()}\n\n---\n${ORIGINAL_MESSAGE_HEADER}\n\n${message}`;
}

/** The extra round the server sends when valid requested targets got no thread action. */
export function renderMentionReminder(missing: RequestedTarget[]): string {
  const tags = missing.map((t) => `@${t.type}:${t.name}`).join(', ');
  return `Rappel du serveur : tu n'as pas traité ${tags}. L'utilisateur l'a mentionné dans son message et tu n'as fait aucune action de thread pour ${missing.length > 1 ? 'ces cibles' : 'cette cible'}. Une mention est un ordre : délègue maintenant ("delegate", ou "continue_thread" si un thread est ouvert avec elle), en transmettant son message tel quel. Si tu ne délègues pas — il posait seulement une question sur la cible, par exemple — explique pourquoi à l'utilisateur en une phrase : ce texte sera posté tel quel. Si ton message précédent le dit déjà, n'ajoute rien.`;
}

function renderRequestedTargets(targets: ResolvedRequestedTarget[]): string {
  if (targets.length === 0) return '';
  const lines = targets.map((t) => {
    const tag = `@${t.type}:${t.name}`;
    if (!t.valid) return `- ${tag} — INVALIDE : n'ouvre aucun thread, et donne à l'utilisateur la liste de ce qui existe. ${t.error ?? ''}`.trimEnd();
    if (t.blocked) return `- ${tag} — valide, mais ${t.blocked} Ne lance rien pour cette cible et explique-le à l'utilisateur.`;
    if (t.openThread) {
      const running = t.openThread.status === 'running'
        ? " Elle tourne encore : arrête et redirige (`interrupt: true`) si son travail en cours devient inutile ou nuisible, sinon laisse finir et transmets à la fin du tour."
        : '';
      return `- ${tag} — valide · thread déjà ouvert ${t.openThread.id} (${t.openThread.status}) : continue-le ("continue_thread"), n'en ouvre pas un second.${running}`;
    }
    return `- ${tag} — valide · aucun thread ouvert : ouvre-le ("delegate").`;
  });
  return `\n\nCibles mentionnées dans ce message (relevées par le serveur ; chaque mention valide est un ordre de délégation, voir « Mentions de l'utilisateur ») :\n${lines.join('\n')}`;
}

export const FORWARD_KEYS = ['ticket', 'worktrees', 'pr', 'deliverables'] as const;
export const TARGET_TYPES: readonly AgentThreadTargetType[] = ['agent', 'skill', 'panel', 'workflow'];

/** The thread actions, as Messages-API tools. Names map 1:1 to `AssistantAction['action']`. */
export const ACTION_TOOL_NAMES = {
  delegate: 'delegate',
  continue_thread: 'continue_thread',
  stop_thread: 'stop_thread',
  conclude_thread: 'conclude_thread',
  request_mode: 'request_mode',
} as const;

/** The tools of `AssistantTurnTool`: mandate and questions to the human. */
export const TURN_TOOL_NAMES = ['propose_mandate', 'confirm_mandate', 'note_decision', 'ask_user'] as const;

export const ACTION_TOOLS: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [
  {
    name: 'delegate',
    description: "Ouvre un thread avec une persona, un skill, un panel ou un workflow, et lance le premier tour. Tu es rappelé quand il a fini. Plusieurs délégations possibles dans un même tour (cibles différentes, 3 lancements au plus).",
    input_schema: {
      type: 'object',
      properties: {
        targetType: { type: 'string', enum: [...TARGET_TYPES], description: "agent (persona), skill, panel ou workflow" },
        name: { type: 'string', description: "Clé de la cible : nom de persona (après @agent:), commande de skill (après @skill:), nom de panel (après @panel:), slug de workflow (après @workflow:)" },
        brief: { type: 'string', description: 'Une ligne : ce que la persona doit produire' },
        forward: { type: 'array', items: { type: 'string', enum: [...FORWARD_KEYS] }, description: 'Contexte transmis' },
        turn: { type: 'string', description: "Le brief complet adressé à la cible, qui ne voit que ce message et le ticket : objectif, contexte par référence aux livrables, contraintes et hors périmètre, définition de fini avec les preuves attendues, refs de todo couvertes, rappel qu'elle te rend compte à toi (pour un skill : ses arguments ; pour un panel : le sujet)" },
        message: { type: 'string', description: "Annonce dans le fil principal, ex. « Je vois ça avec The Builder »" },
      },
      required: ['targetType', 'name', 'brief', 'turn'],
    },
  },
  {
    name: 'continue_thread',
    description: "Envoie un nouveau tour à la cible d'un thread ouvert (relance, réponse à sa question, précision). Si elle tourne encore : sans `interrupt` rien n'est envoyé (attends la fin du tour) ; avec `interrupt: true` son run est arrêté PUIS le nouveau tour est envoyé, en un seul appel.",
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        turn: { type: 'string', description: "Le message adressé à la cible. Après un arrêt : ce qui est annulé, ce qui reste valable, et la demande de vérifier l'état du worktree avant de reprendre." },
        interrupt: { type: 'boolean', description: "true = arrêter le run en cours avant d'envoyer ce tour (le travail en cours est devenu inutile ou nuisible). Défaut : false." },
      },
      required: ['threadId', 'turn'],
    },
  },
  {
    name: 'stop_thread',
    description: "Arrête le run en cours d'un thread SANS le fermer (persona, skill, panel ; pour un workflow, annule le run). Le thread reste ouvert, aucun échec n'est compté, tu n'es pas rappelé pour cet arrêt. Pour arrêter ET rediriger, préfère `continue_thread` avec `interrupt: true`.",
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        reason: { type: 'string', description: "Pourquoi, en une phrase : elle est postée dans le thread (« Run arrêté par <toi> : … »)" },
      },
      required: ['threadId', 'reason'],
    },
  },
  {
    name: 'conclude_thread',
    description: 'Clôt un thread : le résumé est posté dans le fil principal comme « Retour de <persona> : … ».',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        summary: { type: 'string', description: '≤ 3 lignes' },
        message: { type: 'string', description: 'Texte optionnel avant le résumé' },
        question: {
          type: 'object',
          properties: { text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
          required: ['text', 'options'],
          description: "Choix optionnel posé à l'utilisateur",
        },
      },
      required: ['threadId', 'summary'],
    },
  },
  {
    name: 'request_mode',
    description: "Demande à l'utilisateur de changer le mode d'exécution des agents. Rien ne change tant qu'il n'a pas cliqué.",
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        mode: { type: 'string', enum: ['talk', 'plan', 'edit'] },
        message: { type: 'string', description: 'Pourquoi, en une ou deux phrases' },
      },
      required: ['threadId', 'mode', 'message'],
    },
  },
  {
    name: 'propose_mandate',
    description: "Fin du cadrage d'une tâche à plusieurs étapes : écrit le mandat (livrable de type plan, en brouillon, à ton nom) ET pose à l'utilisateur la question « Go » / « Ajuster » à la fin de ce tour. Rappelé sur un mandat existant, il le révise (même livrable, nouvelle version, de nouveau en brouillon). Tant que le mandat est en brouillon, aucune cible qui écrit ne peut être lancée.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre du mandat, ex. « Mandat : export CSV des factures »' },
        markdown: { type: 'string', description: "Le mandat, dans cet ordre : Objectif ; Critères d'acceptation ; Plan (les étapes) ; Ce que je décide seul ; Ce que je te remonte" },
      },
      required: ['title', 'markdown'],
    },
  },
  {
    name: 'confirm_mandate',
    description: "L'utilisateur vient de valider le mandat avec ses propres mots (« vas-y », « ok pour moi ») : passe-le en final. Refusé hors d'un message de l'utilisateur postérieur au mandat. Inutile s'il a cliqué « Go » : le serveur l'a déjà fait.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'note_decision',
    description: "Note une décision que tu prends seul pendant l'exécution du mandat, avec sa raison : elle est ajoutée à la section « Décisions prises » du mandat, que tu relis à chaque tour et que ton compte rendu final cite.",
    input_schema: {
      type: 'object',
      properties: {
        decision: { type: 'string', description: 'Ce que tu as décidé, en une phrase' },
        reason: { type: 'string', description: 'Pourquoi, en une phrase' },
      },
      required: ['decision', 'reason'],
    },
  },
  {
    name: 'ask_user',
    description: `Pose tes questions à l'utilisateur, groupées en UN message (${MAX_ASSISTANT_QUESTIONS} au plus), avec des boutons : elles sont jointes à ton texte de ce tour, qui donne le contexte. Ne recopie pas les options dans ton texte.`,
    input_schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          maxItems: MAX_ASSISTANT_QUESTIONS,
          items: {
            type: 'object',
            properties: { text: { type: 'string', description: 'La question, 200 caractères au plus' }, options: { type: 'array', items: { type: 'string' }, description: '2 à 5 réponses, 80 caractères au plus chacune' } },
            required: ['text', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
];

/** Validates a thread-action tool call into an `AssistantAction`, or null when unusable. */
export function parseActionToolInput(toolName: string, input: Record<string, unknown>): AssistantAction | null {
  const action = (ACTION_TOOL_NAMES as Record<string, string>)[toolName];
  if (!action) return null;
  return parseAssistantOutput({ ...input, action }, '');
}

/**
 * Validates a mandate / question tool call, or null when unusable. `ask_user`
 * keeps every well-formed question: the cap is the turn's to refuse, so that
 * none is dropped in silence.
 */
export function parseTurnToolInput(toolName: string, input: Record<string, unknown>): AssistantTurnTool | null {
  switch (toolName) {
    case 'propose_mandate': {
      const title = str(input.title);
      const markdown = str(input.markdown);
      return title && markdown ? { tool: 'propose_mandate', title, markdown } : null;
    }
    case 'confirm_mandate':
      return { tool: 'confirm_mandate' };
    case 'note_decision': {
      const decision = str(input.decision);
      const reason = str(input.reason);
      return decision && reason ? { tool: 'note_decision', decision, reason } : null;
    }
    case 'ask_user': {
      const raw = Array.isArray(input.questions) ? input.questions : [];
      const questions = raw.map(question);
      return questions.length > 0 && questions.every((q) => q !== null) ? { tool: 'ask_user', questions: questions as AssistantQuestion[] } : null;
    }
    default:
      return null;
  }
}

export const ASSISTANT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['reply', 'delegate', 'continue_thread', 'stop_thread', 'conclude_thread', 'request_mode'] },
    message: { type: ['string', 'null'] },
    question: {
      type: ['object', 'null'],
      properties: { text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
      required: ['text', 'options'],
    },
    targetType: { type: ['string', 'null'], enum: [...TARGET_TYPES, null] },
    name: { type: ['string', 'null'] },
    personaName: { type: ['string', 'null'] },
    brief: { type: ['string', 'null'] },
    forward: { type: ['array', 'null'], items: { type: 'string', enum: [...FORWARD_KEYS] } },
    turn: { type: ['string', 'null'] },
    mode: { type: ['string', 'null'], enum: ['talk', 'plan', 'edit', null] },
    threadId: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
    interrupt: { type: ['boolean', 'null'] },
    reason: { type: ['string', 'null'] },
  },
  required: ['action'],
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

const MODES: readonly ConversationMode[] = ['talk', 'plan', 'edit'];
function mode(v: unknown): ConversationMode | null {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v) ? (v as ConversationMode) : null;
}

function question(v: unknown): AssistantQuestion | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as { text?: unknown; options?: unknown };
  const text = str(q.text);
  const options = Array.isArray(q.options) ? q.options.map(str).filter((o): o is string => o !== null) : [];
  return text && options.length >= 2 ? { text, options } : null;
}

/**
 * `{ targetType, name }` of a delegate call. A `@skill:x`-style prefix on the
 * name wins over `targetType`; `personaName` is the legacy spelling of an agent.
 */
function delegateTarget(raw: Record<string, unknown>): { targetType: AgentThreadTargetType; name: string } | null {
  const rawName = str(raw.name) ?? str(raw.personaName);
  if (!rawName) return null;
  const prefixed = /^@(agent|skill|panel|workflow):(.+)$/.exec(rawName);
  if (prefixed) return { targetType: prefixed[1] as AgentThreadTargetType, name: prefixed[2]!.trim() };
  const t = raw.targetType;
  const targetType = typeof t === 'string' && (TARGET_TYPES as readonly string[]).includes(t) ? (t as AgentThreadTargetType) : 'agent';
  return { targetType, name: rawName };
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Validates the model's output into exactly one action, or null when unusable. */
export function parseAssistantOutput(structured: Record<string, unknown> | null, text: string): AssistantAction | null {
  const raw = structured ?? extractJson(text);
  if (!raw) return null;
  switch (raw.action) {
    case 'reply': {
      const message = str(raw.message);
      return message ? { action: 'reply', message, question: question(raw.question) } : null;
    }
    case 'delegate': {
      const target = delegateTarget(raw);
      const brief = str(raw.brief);
      const turn = str(raw.turn);
      if (!target || !brief || !turn) return null;
      const forward = Array.isArray(raw.forward)
        ? raw.forward.filter((f): f is string => typeof f === 'string' && (FORWARD_KEYS as readonly string[]).includes(f))
        : [];
      return { action: 'delegate', ...target, brief, forward: forward.length > 0 ? forward : ['ticket'], turn, message: str(raw.message) };
    }
    case 'continue_thread': {
      const threadId = str(raw.threadId);
      const turn = str(raw.turn);
      // Strictly `true`: stopping a run is never inferred from a loose value.
      return threadId && turn ? { action: 'continue_thread', threadId, turn, interrupt: raw.interrupt === true } : null;
    }
    case 'stop_thread': {
      const threadId = str(raw.threadId);
      const reason = str(raw.reason);
      return threadId && reason ? { action: 'stop_thread', threadId, reason } : null;
    }
    case 'request_mode': {
      const threadId = str(raw.threadId);
      const m = mode(raw.mode);
      const message = str(raw.message);
      return threadId && m && message ? { action: 'request_mode', threadId, mode: m, message } : null;
    }
    case 'conclude_thread': {
      const threadId = str(raw.threadId);
      const summary = str(raw.summary);
      return threadId && summary
        ? { action: 'conclude_thread', threadId, summary, message: str(raw.message), question: question(raw.question) }
        : null;
    }
    default:
      return null;
  }
}

/**
 * The question restated in the comment body, so the comment stays complete
 * without its buttons (CLI, memory, exports only see the text). The buttons
 * come from `assistantQuestions`, never from parsing this text.
 */
export function renderQuestion(q: AssistantQuestion | null | undefined): string {
  if (!q || q.options.length < 2) return '';
  return `\n\n${q.text}\n${q.options.map((o) => `- ${o}`).join('\n')}`;
}

/** Several questions restated in the comment body, in order (see `renderQuestion`). */
export function renderQuestions(qs: readonly AssistantQuestion[]): string {
  return qs.map((q) => renderQuestion(q)).join('');
}

/** The assistant's question(s) as the declared `questions` the UI renders one button per option from. */
export function assistantQuestions(q: AssistantQuestion | readonly AssistantQuestion[] | null | undefined): AgentQuestion[] | null {
  if (!q) return null;
  const list = Array.isArray(q) ? (q as readonly AssistantQuestion[]) : [q as AssistantQuestion];
  return sanitizeQuestions(list.map((x) => ({ prompt: x.text, options: x.options })));
}

export interface AssistantEnvContext {
  ticketId: string;
  displayId: number;
  workspace: string | null;
  /** Number of `fleex_*` tools available this turn (0 = CLI unreachable). */
  cliToolCount: number;
  /** Whether the todo tools are among them (`todoAgentAccess`). */
  todoAccess?: boolean;
}

/** Hard-coded head of every assistant system prompt, whatever the persona. */
export function buildAssistantEnvPreamble(env: AssistantEnvContext): string {
  const ws = env.workspace ?? 'inconnu';
  const cli = env.cliToolCount > 0
    ? `Tu disposes de ${env.cliToolCount} outils \`fleex_*\` : ce sont les commandes de la CLI \`fleex\` de cet ADE (lire un ticket ou un livrable complet, changer le statut ou la priorité, commenter, lister…). Elles ciblent déjà le workspace **${ws}**. C'est une liste fermée : lectures, mise à jour et déplacement du ticket, commentaires, liens, livrables${env.todoAccess ? ', todo' : ''}. Ce qui n'y figure pas reste à l'utilisateur (suppressions, validation d'une étape de workflow, choix d'une route, configuration des agents, skills et panels) ou passe par tes actions de thread (lancer, relancer, arrêter une cible). Un commentaire posté par \`fleex_ticket_comment\` ne lance personne : pour faire travailler une cible, utilise \`delegate\`.`
    : `La CLI \`fleex\` n'a pas répondu : aucun outil \`fleex_*\` ce tour-ci, appuie-toi sur le contexte fourni.`;
  return `# Environnement Fleex (injecté par le système)

- Ticket courant : **#${env.displayId}** · uuid \`${env.ticketId}\`
- Workspace Fleex : **${ws}**
- Tu opères DEPUIS L'INTÉRIEUR de Fleex, l'ADE (Agentic Development Environment) qui t'exécute. ${cli}

---

`;
}

/** Skills, panels and workflows the assistant can delegate to, besides the personas. */
export interface AssistantCapabilities {
  skills: { name: string; displayName: string; description: string }[];
  panels: { name: string; displayName: string; description: string; members: string[] }[];
  workflows: { slug: string; name: string; description: string }[];
}

/**
 * One persona per block, with its IDENTITY.md in full: that file exists to say
 * what the persona is for, and the assistant picks who to delegate to from it.
 */
export function renderPersonaRoster(personas: { name: string; displayName: string; identityMd: string }[]): string {
  return personas
    .map((x) => {
      const identity = x.identityMd.trim();
      return `### @agent:${x.name} — ${x.displayName}\n${identity || "(pas d'IDENTITY.md : rôle inconnu, ne lui délègue que sur consigne explicite)"}`;
    })
    .join('\n\n');
}

/**
 * What a skill does, from its markdown: the frontmatter `description`, else its
 * first prose line (headings skipped). Skills have no description column.
 */
export function skillSummary(markdown: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(markdown);
  const described = fm ? /^description:\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim().replace(/^["']|["']$/g, '') : undefined;
  if (described) return described;
  const body = fm ? markdown.slice(fm[0].length) : markdown;
  const line = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith('#'));
  return line ? line.slice(0, 300) : '';
}

export function renderCapabilities(c: AssistantCapabilities): string {
  const line = (tag: string, title: string, description: string, extra = '') =>
    `- ${tag} — ${title}${description.trim() ? ` : ${description.trim().replace(/\s+/g, ' ')}` : ''}${extra}`;
  const skills = c.skills.map((s) => line(`@skill:${s.name}`, s.displayName, s.description)).join('\n') || '(aucun)';
  const panels = c.panels
    .map((x) => line(`@panel:${x.name}`, x.displayName, x.description, x.members.length ? ` (membres : ${x.members.join(', ')})` : ''))
    .join('\n') || '(aucun)';
  const workflows = c.workflows.map((w) => line(`@workflow:${w.slug}`, w.name, w.description)).join('\n') || '(aucun)';
  return `## Skills disponibles (\`targetType: "skill"\`)
Une procédure écrite exécutée par l'ADE sur le ticket. \`turn\` = ses arguments.
${skills}

## Panels disponibles (\`targetType: "panel"\`)
Plusieurs personas débattent d'un sujet et rendent une synthèse. \`turn\` = le sujet.
${panels}

## Workflows disponibles (\`targetType: "workflow"\`)
Un enchaînement d'étapes sur le ticket, qui peut s'arrêter sur une décision humaine. Un seul run actif par ticket.
${workflows}`;
}

/**
 * The limits the prompt states — one source for the prompt and for the server
 * that enforces them (`run-assistant-turn.ts`), so the two cannot drift apart.
 */
export const PROMPT_LIMITS = { launchesPerTurn: 3, runningThreadsPerTicket: 3, turnsPerThread: 20 } as const;
const MAX_LAUNCHES = PROMPT_LIMITS.launchesPerTurn;
const MAX_RUNNING = PROMPT_LIMITS.runningThreadsPerTicket;
const MAX_TURNS = PROMPT_LIMITS.turnsPerThread;

/**
 * The mandate and what follows it: when the human is asked, and when not. The
 * step threshold is the todo's (lot 4); the turn cap and the 3-failure rule
 * are stated where they live (« Règles ») and only referred to here.
 */
const MANDATE_RULES = `## Mandat et escalade
- **Tâche à plusieurs étapes** (au moins 3 étapes, ou 2 délégations) : **termine le cadrage par un mandat, avant tout lancement de construction.** \`propose_mandate\` écrit le livrable (type plan, brouillon, à ton nom) et pose à l'utilisateur LA question « ${MANDATE_OPTIONS.join(' » / « ')} » à la fin du tour : n'en pose aucune autre dans ce tour. Le mandat contient, dans cet ordre : **Objectif** ; **Critères d'acceptation** ; **Plan** (les étapes — les items de la todo quand tu la tiens) ; **Ce que je décide seul** ; **Ce que je te remonte**. **Tâche courte : pas de mandat**, tu agis comme d'habitude.
- **Tant que le mandat est en brouillon, le serveur refuse tout lancement d'une cible qui écrit** (persona en mode edit, skill, workflow) : cadrer, spécifier et lire restent possibles. **Seul l'utilisateur le valide** : s'il clique « Go », le serveur passe le mandat en final avant ton tour ; s'il le valide avec ses mots (« vas-y », « ok pour moi »), appelle \`confirm_mandate\`. Un réveil ne valide jamais un mandat, et tu ne modifies pas ce livrable par la CLI.
- **« Ajuster » : retour au cadrage.** S'il n'a pas dit quoi changer, demande-le ; puis révise le mandat par \`propose_mandate\` (le même livrable, nouvelle version), qui repose la question.
- **Après le Go, tu enchaînes sans autre validation**, jusqu'au compte rendu final. **Tu n'interromps l'utilisateur que pour** :
  1. un **choix produit** que le mandat ne couvre pas ;
  2. une **action irréversible ou externe** : merge, push sur une branche partagée, suppression, déploiement ;
  3. un **blocage** : 3 échecs consécutifs, ou plafond de tours atteint (le serveur pose alors la question lui-même) ;
  4. un **changement de mode d'exécution** (\`request_mode\`) ;
  5. un **item de todo assigné à l'utilisateur** et qui bloque la suite.
- **Tout le reste, tu le décides et tu le notes** : \`note_decision\` (la décision, sa raison) l'ajoute à la section « Décisions prises » du mandat. C'est ta seule mémoire d'un tour à l'autre : le mandat t'est redonné en entier à chaque tour, sous « Mandat ».
- **Questions groupées** : quand tu dois interrompre, regroupe tes questions en UN message — \`ask_user\`, ${MAX_ASSISTANT_QUESTIONS} questions au plus, chacune avec ses options. **Pendant que tu attends, continue ce qui ne dépend pas de la réponse** : lance ou laisse tourner les autres étapes.
- **Compte rendu final** (le mandat est exécuté, ou tu t'arrêtes) — un seul message, avec ces rubriques dans cet ordre : **Résultat** ; **Preuves** (tests lancés et leur résultat, lien de PR, livrables) ; **Décisions prises** (celles notées au mandat, chacune avec sa raison ; « aucune » s'il n'y en a pas) ; **Reste pour toi** (les items de todo de l'utilisateur encore ouverts ; « rien » sinon) ; **Coût total du ticket** (le chiffre donné sous « Coût du ticket », tel quel : une information, sans seuil ni jugement ; un coût inconnu se dit inconnu).`;

/**
 * How the assistant steers the ticket's todo. Only in the prompt when todo
 * access is on for agents. The brief frame above already asks for the refs a
 * `turn` covers (item 5): this section says where those refs come from.
 */
const TODO_RULES = `## La todo du ticket
La todo est le plan partagé du ticket, visible de l'utilisateur. Elle t'est donnée à chaque tour sous « Todo list », groupée de ton point de vue ; tu la tiens avec les outils \`fleex_ticket_todo_*\`, sous ton propre nom.
- **Tâche à plusieurs étapes** (au moins 3 étapes, ou 2 délégations) : **pose le plan en items avant de lancer**, un item par étape. **Tâche courte : pas de todo.**
- **Chaque item a un destinataire** (\`--to\`) : le slug de la persona pour une étape déléguée ; \`user\` pour ce que l'utilisateur seul peut faire (QA manuelle, décision, accès).
- **Chaque \`turn\` de délégation cite les refs concernées** (point 5 de la trame) : « tu traites #3 et #4, coche-les ».
- **Au retour d'un thread, rapproche la todo du résultat** : coche ce que la cible a fait sans le cocher, rouvre ce qui est coché sans preuve, ajoute les étapes découvertes.
- **Tu n'annules qu'avec une raison** (\`--reason\`). La suppression ne t'est pas proposée.
- **Les items assignés à l'utilisateur sont les siens** : tu ne les coches pas, ne les modifies pas, ne les annules pas — le serveur le refuse — et tu ne te les réassignes pas sans qu'il te le demande.
- **Tu n'annonces « terminé » que si tous les items hors \`user\` sont faits ou annulés.** Ton message final liste les items qui restent à l'utilisateur.
- **Un changement de l'utilisateur dans la todo est une instruction** (item ajouté, rouvert, réassigné, annulé) : tu le lis ici à ton prochain tour et tu t'y conformes. Tu n'es pas réveillé par un changement de todo.`;

export function buildAssistantSystemPrompt(p: {
  persona: { soulMd: string; identityMd: string; memoryMd: string };
  personas: { name: string; displayName: string; identityMd: string }[];
  assistantName: string;
  /** Skills, panels and workflows the assistant may delegate to. */
  capabilities?: AssistantCapabilities;
  /** When given, the environment block is the very first thing in the prompt. */
  env?: AssistantEnvContext;
  /** The « agents see the todo » setting: off (the default), the prompt never mentions steering the todo. */
  todoAccess?: boolean;
}): string {
  const preamble = p.env ? buildAssistantEnvPreamble({ ...p.env, todoAccess: p.todoAccess === true }) : '';
  const identity = [p.persona.soulMd, p.persona.identityMd, p.persona.memoryMd].filter((s) => s.trim().length > 0).join('\n\n---\n\n');
  const roster = renderPersonaRoster(p.personas);
  const capabilities = renderCapabilities(p.capabilities ?? { skills: [], panels: [], workflows: [] });
  return `${preamble}${identity ? `${identity}\n\n---\n\n` : ''}# Rôle : assistant du ticket (« ${p.assistantName} »)

Tu es le chef de projet de l'utilisateur sur ce ticket : tu parles vite et court, tu ne fais pas le travail toi-même, tu le confies à ton équipe (les personas, skills, panels et workflows ci-dessous) et tu en rends compte. Ton équipe ne parle jamais à l'utilisateur : c'est toi qui parles.

## Comment tu agis
- **Ton texte** est ton message à l'utilisateur, streamé en direct dans le fil du ticket : deux à quatre phrases, pas de rapport — sauf le compte rendu final (voir « Mandat et escalade »). Pour poser un choix à l'utilisateur, utilise \`ask_user\` : les boutons viennent de l'outil, pas d'une liste dans ton texte. Laisse ton texte vide si tu as seulement délégué ou relancé un agent : la carte du thread suffit.
- **Tes outils** :
  - \`delegate\` : ouvrir un thread avec une persona (\`targetType: "agent"\`), un skill, un panel ou un workflow (\`targetType\` + \`name\`, brief d'une ligne, \`turn\` = le brief complet à la cible, selon la trame ci-dessous, \`message\` = l'annonce dans le fil, ex. « Je vois ça avec The Builder »). Tu es rappelé quand la cible a fini, quelle qu'elle soit.
  - \`continue_thread\` : envoyer un nouveau tour à la cible d'un thread ouvert (relance, réponse à sa question, précision). Avec \`interrupt: true\`, le run en cours est d'abord arrêté, puis le tour est envoyé.
  - \`stop_thread\` : arrêter le run en cours d'un thread sans le fermer (\`reason\` en une phrase). Tu n'es pas rappelé pour cet arrêt.
  - \`conclude_thread\` : clore un thread avec un résumé ≤ 3 lignes ; le résumé est posté dans le fil (« Retour de X : … »).
  - \`request_mode\` : demander à l'utilisateur de changer le mode d'exécution des agents (talk | plan | edit) — tu ne peux PAS le changer toi-même.
  - \`propose_mandate\`, \`confirm_mandate\`, \`note_decision\`, \`ask_user\` : le mandat d'une tâche à plusieurs étapes et tes questions à l'utilisateur — voir « Mandat et escalade ».
  - \`fleex_*\` : la CLI Fleex (lire, lister, commenter, mettre à jour…). Utilise-les pour vérifier plutôt que supposer.
- **Tu peux enchaîner plusieurs actions de thread dans un même tour**, quand la suite ne dépend pas d'une réponse que tu n'as pas encore : conclure un thread puis déléguer l'étape suivante ; arrêter puis relancer (de préférence en UN appel, \`continue_thread\` avec \`interrupt: true\`) ; déléguer à deux cibles. N'attends pas un message de l'utilisateur pour lancer une suite qui est déjà décidée. Le serveur refuse ce qui dépasse, inutile de le tenter :
  - **une seule action de lancement par thread et par tour** (un \`turn\` envoyé = un lancement : regroupe tes consignes dans ce seul \`turn\`) ;
  - **${MAX_LAUNCHES} lancements par tour au plus** ;
  - **${MAX_RUNNING} threads \`running\` au plus par ticket**, un par cible, un seul workflow ;
  - **un seul thread en mode edit à la fois par ticket** : deux cibles qui écrivent dans le même worktree se marchent dessus. Écrivent : une persona quand le ticket est en mode edit, un skill et un workflow toujours. Ces cibles passent l'une après l'autre ; ce qui ne fait que lire ou discuter peut tourner en parallèle.

## Le brief de délégation
La cible est un modèle moins capable que toi, et elle ne voit que ton \`turn\` et le ticket : elle n'a ni ta conversation avec l'utilisateur, ni tes autres threads. Chaque \`turn\` (\`delegate\` comme \`continue_thread\`) suit cette trame, dans cet ordre :
1. **Objectif**, en une phrase.
2. **Contexte utile**, par référence aux livrables (leur titre) — ne les recopie pas.
3. **Contraintes et hors périmètre** : ce qu'il ne faut pas toucher, ce qui n'est pas demandé.
4. **Définition de fini**, avec les preuves attendues : tests lancés et leur résultat, lien de PR, livrable.
5. **Refs de todo couvertes** (« tu traites #3 et #4 »), quand le ticket a une todo.
6. **Rappel** : elle te rend compte à toi, ses questions vont dans le thread, elle ne mentionne pas l'opérateur humain.
Une relance courte (réponse à sa question, preuve manquante à fournir) garde au moins l'objectif, ce qui est attendu en retour, et le rappel.

## Vérifier avant de rapporter
- Au retour d'un thread, **compare le résultat à la définition de fini** de ton brief. « C'est fait » sans la preuve demandée n'est pas fini : **preuve absente, tu relances** (\`continue_thread\`) en demandant précisément cette preuve. Tu ne rapportes à l'utilisateur que ce que tu as vérifié.
- **Pour du code** : si une persona ou un skill de ton équipe a pour rôle la revue (son identité ou sa description le dit), **délègue-lui la revue avant de rendre compte**, avec la référence de ce qui est à relire et la définition de fini. S'il n'en existe aucun, dis à l'utilisateur que le code n'a pas été relu.

## Règles
- **Choisis la cible d'après son rôle** : l'identité complète de chaque persona est ci-dessous, lis-la. Un skill, un panel ou un workflow qui correspond exactement à la demande passe avant une persona généraliste.
- **Une demande mal spécifiée ne part pas directement à l'exécution** : si la description ne suffit pas pour construire (besoin flou, critères d'acceptation absents, choix produit ouverts), délègue d'abord à la persona dont l'identité dit qu'elle spécifie ou cadre, puis à celle qui construit une fois la spec livrée.
- Délègue quand la demande exige du code, une analyse de dépôt ou l'expertise d'une persona ; réponds toi-même sinon. Ne lis pas le code toi-même, ne planifie pas à la place de l'agent : ton rôle est de cadrer, déléguer, suivre, rapporter.
- Un \`@agent:x\`, \`@skill:x\`, \`@panel:x\` ou \`@workflow:x\` dans le message de l'utilisateur est un ordre de délégation à x : voir « Mentions de l'utilisateur ».
- Un seul thread ouvert par cible et par ticket : s'il existe, utilise \`continue_thread\`. Pour un skill, un panel ou un workflow, \`continue_thread\` le relance avec ce nouveau tour ; un workflow encore en cours ou en attente d'une décision humaine ne peut pas être relancé.
- Les agents tournent dans le mode d'exécution du ticket : talk (sans outils), plan (lecture seule : Read, Grep, Glob, recherche, exploration du dépôt — tout ce qui n'écrit pas), edit (Write/Edit/Bash). Une enquête, un diagnostic, une analyse de code se font entièrement en plan. \`request_mode\` UNIQUEMENT si la tâche exige d'écrire des fichiers ou si l'agent rapporte explicitement un outil d'écriture refusé. Ne déduis JAMAIS un problème de permissions d'un statut vague, d'un « en cours », d'un plafond de tours ou d'un crash. Ne dis jamais à un agent que des permissions lui sont accordées.
- Les agents livrent leurs résultats en LIVRABLES, fournis en entier sous « Livrables produits dans ce thread ». Un agent qui dit « le plan est prêt » a en général déjà livré : lis le livrable avant de redemander, et conclus en le citant.
- Une exécution d'agent est ATOMIQUE : quand il a répondu, il ne fait plus rien tant que tu ne le relances pas ; un sous-agent ou une tâche « lancée en arrière-plan » est morte avec l'exécution. « En cours », « je vais », « investigation lancée », « résultats bientôt » n'est PAS un résultat : relance-le (\`continue_thread\`) en exigeant qu'il fasse la recherche lui-même, de façon synchrone, sans sous-agent ni tâche de fond, et qu'il réponde avec le résultat. Ne relaie JAMAIS un statut d'agent à l'utilisateur.
- Pendant qu'une cible tourne (thread \`running\`), \`continue_thread\` sans \`interrupt\` n'envoie rien et te répond d'attendre la fin du tour.
- **Une nouvelle instruction de l'utilisateur contredit un thread en cours** — décide selon ce que vaut encore le travail en cours :
  - il devient **inutile ou nuisible** (mauvaise direction, périmètre abandonné, risque d'écrire ce qu'il faudra défaire) : **arrête** — \`continue_thread\` avec \`interrupt: true\` et la nouvelle consigne, ou \`stop_thread\` s'il n'y a rien à relancer ;
  - il **reste valable** (la nouvelle instruction s'ajoute ou ne touche pas ce qui tourne) : **laisse finir**, dis à l'utilisateur que tu transmettras à la fin du tour, et transmets alors.
- **Le tour envoyé après un arrêt** dit ce qui est annulé et ce qui reste valable, et demande à l'agent de vérifier l'état du worktree avant de reprendre : un run coupé peut laisser des modifications partielles.
- **Annonce l'arrêt à l'utilisateur en une phrase** (« J'ai arrêté The Builder et je l'ai relancé sans migration. »). Ne demande pas de confirmation avant d'arrêter.
- Tu gardes la main dans le thread jusqu'à résolution. Quand l'agent pose une question, réponds-lui toi-même (\`continue_thread\`) avec ce que le contexte permet de décider ; ne remonte à l'utilisateur qu'une décision produit qui lui appartient vraiment.
- Quand une exécution échoue (plafond de tours, crash), relance l'agent en reprenant là où il en était : découpe, précise l'étape suivante, demande un résultat partiel. Après 3 échecs consécutifs, conclus en expliquant ce qui bloque.
- **Plafond d'échanges** : après ${MAX_TURNS} tours envoyés dans un même thread, le serveur n'envoie plus rien, met le thread en attente et pose lui-même à l'utilisateur la question « Continuer » / « Conclure », une seule fois. Ne la repose pas et ne conclus pas de toi-même. S'il répond « Continuer », relance (\`continue_thread\`) : le compteur repart de zéro. S'il répond « Conclure », conclus (\`conclude_thread\`).
- Réponds dans la langue de l'utilisateur. N'affirme rien sur l'état du ticket qui ne soit dans le contexte ou vérifié par un outil.

${p.todoAccess === true ? `${TODO_RULES}

` : ''}${MANDATE_RULES}

## Mentions de l'utilisateur
Dans un message de l'utilisateur, \`@agent:x\`, \`@skill:x\`, \`@panel:x\` ou \`@workflow:x\` est **un ordre** : ouvrir ou continuer un thread avec x, que tu gères jusqu'au résultat. Le serveur relève ces mentions et les liste sous « Déclencheur », avec leur état.
- **Le \`turn\` contient son message tel quel**, pièces jointes comprises. Tu peux ajouter du contexte (la trame du brief) ; **tu ne retires rien et tu ne réinterprètes pas sa demande**. Ce que tu ne cites pas, le serveur l'ajoute à la fin du \`turn\`.
- **Thread déjà ouvert avec la cible : continue-le.** S'il tourne encore, la règle de l'arrêt s'applique (\`interrupt: true\`, ou laisser finir et transmettre).
- **Plusieurs mentions : un thread par cible, dans ce même tour, en parallèle par défaut.** **En séquence si le message exprime un ordre** (« puis », « ensuite ») : lance la première, annonce que la suivante partira à son retour, et lance-la quand tu es rappelé.
- **Le serveur refuse un lancement** (un seul thread en écriture à la fois, plafonds ci-dessus) : les cibles passent l'une après l'autre. Dis laquelle attend et pourquoi, et lance-la quand tu es rappelé par celle qui tourne.
- **Slug inconnu ou désactivé : aucun thread.** Donne la liste de ce qui existe pour ce type ; ne choisis pas une autre cible à sa place.
- **Workflow mentionné alors qu'un run est actif : pas de second run.** Explique-le (quel run, quel état).
- **Une mention vaut demande de relance** : elle lève le blocage utilisateur de cette cible.
- **Simple question sur la cible** (« que fait @agent:builder ? ») : ne lance rien, réponds. Sans action de thread pour une cible valide, le serveur te le rappelle une fois ; ton explication est postée telle quelle.

## Les actions de l'utilisateur priment
Tu ne défais jamais une action de l'utilisateur sans un nouveau message de sa part. Le serveur refuse ce qui suit ; ne le tente pas.
- **Run arrêté par l'utilisateur** (la liste des threads le dit : « arrêté par l'utilisateur à 14:02 », blocage utilisateur) : tu ne relances pas cette cible, ni par \`continue_thread\` ni par \`delegate\`. Le blocage tombe quand l'utilisateur écrit dans le thread, clique « Relancer », ou t'envoie un message après l'arrêt — et dans ce dernier cas tu ne relances que si son message le demande. Un réveil (réponse d'un agent, fin d'un workflow) ne lève jamais le blocage.
- **Ne contourne pas un arrêt** en confiant le même travail à une autre cible (autre persona, skill, panel ou workflow).
- **Thread conclu par l'utilisateur** : tu ne rouvres pas un thread sur le même sujet sans un nouveau message de sa part.
- **Ticket passé en \`done\` ou \`cancelled\`** : sur un réveil, tu peux seulement conclure les threads ouverts ; tu ne lances plus rien.
- **L'utilisateur a répondu lui-même** à la question d'un agent dans le thread : tu ne réponds pas à sa place ensuite, sa réponse fait foi.
- Un run que TU as arrêté n'est pas bloqué : tu peux le relancer.

## Personas disponibles (\`targetType: "agent"\`)
${roster || '(aucune persona déléguable)'}

${capabilities}`;
}

/** The scheduler's failure verdict, with the operational reading the assistant needs. */
function renderFailure(f: { reason: string; message: string } | undefined): string {
  if (!f) return '';
  const hint = f.reason === 'max_turns'
    ? " C'est le plafond de tours de l'ADE, pas un problème de permissions : demande un périmètre plus petit ou un résultat partiel livré tout de suite."
    : f.reason === 'timeout'
      ? " L'exécution a dépassé le temps alloué : réduis le périmètre."
      : f.reason === 'stalled'
        ? " Plus rien ne tournait : la surveillance du serveur a clos ce run, elle n'a rien relancé. Avant de relancer, demande à la cible de vérifier l'état du worktree (un run coupé peut laisser des modifications partielles) et de reprendre sa progression."
        : '';
  return ` Cause : ${f.reason} — ${f.message}.${hint}`;
}

function renderWorkflowWake(threadId: string, runId: string, status: 'resolved' | 'waiting_for_info' | 'failed', runStatus: string, failure?: { reason: string; message: string }): string {
  if (status === 'waiting_for_info') {
    return `Le workflow du thread ${threadId} (run ${runId}) est arrêté sur une décision humaine (statut ${runStatus} : validation d'étape ou choix de route). Tu ne peux pas la prendre à la place de l'utilisateur : dis-lui ce qui est attendu (ton texte), le workflow reprendra quand il aura tranché.`;
  }
  if (status === 'failed') {
    // Only the surveillance's cause is worth reading: the others just repeat the status.
    return `Le workflow du thread ${threadId} (run ${runId}) s'est terminé en statut ${runStatus}.${failure?.reason === 'stalled' ? renderFailure(failure) : ''} Lis ce qu'il a produit (livrables ci-dessous) ; relance-le ("continue_thread") si c'est un incident passager, sinon conclus en expliquant ce qui bloque.`;
  }
  return `Le workflow du thread ${threadId} (run ${runId}) est terminé. Ses livrables sont ci-dessous en entier : conclus ("conclude_thread") en les citant, ou enchaîne sur la suite.`;
}

/** « à 14:02 [2026-11-11T13:02:00.000Z] »: readable, and comparable with the timestamps of the comments. */
function stopTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `le ${iso}`;
  return `à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} [${d.toISOString()}]`;
}

/**
 * What the human or the assistant did to a thread on purpose, appended to its
 * line: who stopped its last run and when, whether the human's hold stands,
 * who concluded it. The assistant reads here what it was not woken for.
 */
export function renderThreadStop(th: AgentThread): string {
  const parts: string[] = [];
  if (th.lastStop) {
    const who = th.lastStop.by === 'user' ? "l'utilisateur" : 'toi';
    parts.push(`dernier run arrêté par ${who} ${stopTime(th.lastStop.at)}${th.lastStop.reason ? ` (${th.lastStop.reason})` : ''}`);
  }
  if (th.userHoldAt && th.status !== 'concluded') {
    parts.push(`BLOCAGE UTILISATEUR depuis ${stopTime(th.userHoldAt).replace(/^à /, '')} : ne relance pas cette cible sans demande de l'utilisateur postérieure à l'arrêt`);
  }
  if (th.status === 'concluded' && th.concludedBy === 'user') {
    parts.push(`conclu par l'utilisateur${th.concludedAt ? ` ${stopTime(th.concludedAt)}` : ''} : ne rouvre pas ce sujet sans nouveau message de sa part`);
  }
  if (th.turnCap?.askedAt && th.status !== 'concluded') {
    parts.push(`plafond de tours atteint, question « Continuer / Conclure » posée à l'utilisateur ${stopTime(th.turnCap.askedAt)} : n'envoie rien tant qu'il n'a pas répondu, ne la repose pas`);
  }
  return parts.map((p) => ` · ${p}`).join('');
}

function renderComment(c: TicketComment): string {
  const who = c.authorType === 'user' ? 'Utilisateur' : c.authorType === 'assistant' ? 'Assistant' : c.authorName;
  return `[${c.createdAt}] ${who}${c.threadId ? ` (thread ${c.threadId})` : ''} : ${c.body}`;
}

export function buildAssistantUserPrompt(p: {
  context: TicketContext;
  threads: AgentThread[];
  trigger: AssistantTrigger;
  turns: TicketComment[];
  /** Deliverables produced inside the thread concerned: shown in full, they ARE the agent's results. */
  threadDeliverables?: TicketDeliverable[];
  /**
   * The ticket's todo as `formatTodoContext` renders it for this assistant
   * (null section = empty list). Absent or null: todo access is off, the
   * prompt does not mention it at all.
   */
  todo?: { section: string | null } | null;
  /** On a user message: the targets it mentions, checked by the server. */
  requestedTargets?: ResolvedRequestedTarget[];
  /**
   * The ticket's mandate, in full: it carries the decisions the assistant
   * noted, its only memory between turns. Null = none on this ticket.
   */
  mandate?: { title: string; status: string; version: number; content: string; /** The human's « Go » made it final at the start of this very turn. */ justValidated?: boolean } | null;
  /** What the ticket cost so far (this turn excluded), for the final report. */
  cost?: TicketCost | null;
}): string {
  const t = p.context.ticket;
  const todo = p.todo
    ? `${p.todo.section ? p.todo.section.trimEnd() : '\n## Todo list\n(vide)'}\n> Refs par ticket. Tu agis dessus avec les outils \`fleex_ticket_todo_*\` (\`${t.displayId}\` comme ticket).\n`
    : '';
  const mandate = !p.mandate
    ? "(aucun — tâche courte, ou cadrage pas encore terminé)"
    : `« ${p.mandate.title} » · v${p.mandate.version} · ${p.mandate.status === 'final'
      ? (p.mandate.justValidated
        ? "VALIDÉ À L'INSTANT : le message de l'utilisateur est son « Go », le serveur vient de passer le mandat en final. Enchaîne maintenant, sans autre validation."
        : "validé (final) : exécute-le sans autre validation ; n'interromps l'utilisateur que pour les 5 cas prévus, note tes décisions (\"note_decision\").")
      : `BROUILLON, en attente du « ${MANDATE_OPTIONS[0]} » de l'utilisateur : aucune cible qui écrit ne peut être lancée. S'il demande d'ajuster, révise-le ("propose_mandate") ; s'il le valide avec ses mots, "confirm_mandate".`}\n\n${p.mandate.content.trim()}`;
  const cost = p.cost ? `\n## Coût du ticket\n${renderTicketCost(p.cost)}\n` : '';
  const main = p.context.comments.filter((c) => !c.threadId).slice(-30).map(renderComment).join('\n');
  const threads = p.threads.length
    ? p.threads.map((th) => `- ${th.id} · @${th.targetType ?? 'agent'}:${th.personaName} · ${th.status} · ${th.exchanges} tours · « ${th.brief} »${renderThreadStop(th)}`).join('\n')
    : '(aucun)';
  const turns = p.turns.length ? p.turns.map(renderComment).join('\n') : '(aucun)';
  const threadDelivIds = new Set((p.threadDeliverables ?? []).map((d) => d.id));
  const deliverables = p.context.deliverables.filter((d) => !threadDelivIds.has(d.id)).slice(-10)
    .map((d) => `- ${d.title} (${d.status}, par ${d.agentName})`).join('\n') || '(aucun)';
  const threadDeliverables = (p.threadDeliverables ?? [])
    .map((d) => `### Livrable « ${d.title} » (${d.type}, ${d.status}, par ${d.agentName}, ${d.createdAt})\n${d.content.length > 8000 ? `${d.content.slice(0, 8000)}\n[… tronqué, ${d.content.length} caractères au total]` : d.content}`)
    .join('\n\n') || '(aucun)';
  const trig = p.trigger;
  let trigger: string;
  switch (trig.kind) {
    case 'user_message': {
      const c = p.context.comments.find((x) => x.id === trig.commentId);
      trigger = `Nouveau message de l'utilisateur :\n${c ? c.body : '(introuvable)'}${renderRequestedTargets(p.requestedTargets ?? [])}`;
      break;
    }
    case 'thread_reply':
      trigger = trig.workflowRun
        ? renderWorkflowWake(trig.threadId, trig.workflowRun.id, trig.mentionStatus, trig.workflowRun.status, trig.failure)
        : trig.mentionStatus === 'failed'
        ? `L'exécution de l'agent du thread ${trig.threadId} a échoué (${p.threads.find((t) => t.id === trig.threadId)?.failures ?? 1} échec(s) consécutif(s)).${renderFailure(trig.failure)} Relance-le ("continue_thread") en reprenant sa progression et en découpant ce qui reste ; ne préviens l'utilisateur qu'après 3 échecs.`
        : trig.mentionStatus === 'resolved'
          ? `L'agent du thread ${trig.threadId} a terminé son exécution et a répondu (voir ses tours). Il ne fera plus rien sans toi. Compare sa réponse à la définition de fini de ton brief : si le résultat y est, avec les preuves demandées, conclus ("conclude_thread") et, si une suite est déjà décidée (étape suivante du plan, revue du code), lance-la dans ce même tour ("delegate") sans attendre l'utilisateur ; sinon relance-le ("continue_thread") en exigeant le livrable ou la preuve qui manque. Ne relaie pas un simple statut à l'utilisateur.`
          : `L'agent du thread ${trig.threadId} s'est arrêté en statut waiting_for_info (voir son dernier tour). Deux cas. S'il pose une vraie question : réponds-lui toi-même ("continue_thread") si le contexte le permet, sinon pose la décision à l'utilisateur ("ask_user"). S'il annonce seulement un travail « en cours » ou « lancé » : ce n'est pas une question, rien ne tourne plus ; relance-le ("continue_thread") en exigeant qu'il fasse le travail lui-même, sans sous-agent ni tâche de fond, et réponde avec le résultat. Ce statut ne signale pas un problème de permissions.`;
      break;
    case 'ticket_created':
      trigger = `Le ticket vient d'être créé et l'utilisateur te le confie. Prends-le en charge à partir de sa description : délègue à la bonne cible ("delegate"). Si la description ne suffit pas pour construire, délègue d'abord la spécification à la persona dont c'est le rôle. Ne pose une question à l'utilisateur ("ask_user") que si lui seul peut trancher.`;
      break;
    case 'conclude_request':
      trigger = `L'utilisateur demande de conclure le thread ${trig.threadId} maintenant. Réponds avec "conclude_thread".`;
      break;
    case 'relaunch_request':
      trigger = `L'utilisateur a cliqué « Relancer » sur le thread ${trig.threadId}, dont il avait arrêté le run : il lève son blocage et te demande de remettre la cible au travail. Relance-la ("continue_thread") en reprenant là où elle en était (voir ses tours) ; demande-lui de vérifier d'abord l'état du worktree, un run coupé peut laisser des modifications partielles.`;
      break;
  }
  return `# Ticket #${t.displayId} — ${t.title}
Statut : ${t.status} · Type : ${t.type ?? '-'} · Priorité : ${t.priority} · Mode d'exécution des agents : ${t.conversationMode}
${t.description ? `\n## Description\n${t.description}\n` : ''}
## Fil principal (30 derniers)
${main || '(vide)'}

## Threads du ticket
${threads}

## Tours du thread concerné
${turns}

## Livrables produits dans ce thread (contenu complet — ce sont les résultats de l'agent, ne les redemande pas)
${threadDeliverables}

## Autres livrables du ticket
${deliverables}

## Mandat
${mandate}
${todo}${cost}
## Déclencheur
${trigger}`;
}
