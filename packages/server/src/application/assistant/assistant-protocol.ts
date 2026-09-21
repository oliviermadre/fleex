import type { AgentThread, TicketComment, TicketContext } from '@fleex/shared';

export interface AssistantQuestion { text: string; options: string[] }

export type AssistantTrigger =
  | { kind: 'user_message'; commentId: string }
  | { kind: 'thread_reply'; threadId: string; mentionStatus: 'resolved' | 'waiting_for_info' | 'failed' }
  | { kind: 'conclude_request'; threadId: string };

export type AssistantAction =
  | { action: 'reply'; message: string; question: AssistantQuestion | null }
  | { action: 'delegate'; personaName: string; brief: string; forward: string[]; turn: string; message: string | null }
  | { action: 'continue_thread'; threadId: string; turn: string }
  | { action: 'conclude_thread'; threadId: string; summary: string; message: string | null; question: AssistantQuestion | null };

export const FORWARD_KEYS = ['ticket', 'worktrees', 'pr', 'deliverables'] as const;

export const ASSISTANT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['reply', 'delegate', 'continue_thread', 'conclude_thread'] },
    message: { type: ['string', 'null'] },
    question: {
      type: ['object', 'null'],
      properties: { text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
      required: ['text', 'options'],
    },
    personaName: { type: ['string', 'null'] },
    brief: { type: ['string', 'null'] },
    forward: { type: ['array', 'null'], items: { type: 'string', enum: [...FORWARD_KEYS] } },
    turn: { type: ['string', 'null'] },
    threadId: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
  },
  required: ['action'],
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function question(v: unknown): AssistantQuestion | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as { text?: unknown; options?: unknown };
  const text = str(q.text);
  const options = Array.isArray(q.options) ? q.options.map(str).filter((o): o is string => o !== null) : [];
  return text && options.length >= 2 ? { text, options } : null;
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
      const personaName = str(raw.personaName);
      const brief = str(raw.brief);
      const turn = str(raw.turn);
      if (!personaName || !brief || !turn) return null;
      const forward = Array.isArray(raw.forward)
        ? raw.forward.filter((f): f is string => typeof f === 'string' && (FORWARD_KEYS as readonly string[]).includes(f))
        : [];
      return { action: 'delegate', personaName: personaName.replace(/^@agent:/, ''), brief, forward: forward.length > 0 ? forward : ['ticket'], turn, message: str(raw.message) };
    }
    case 'continue_thread': {
      const threadId = str(raw.threadId);
      const turn = str(raw.turn);
      return threadId && turn ? { action: 'continue_thread', threadId, turn } : null;
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

/** The bullet-list shape `parseInlineOptions` (web) recognises as an inline question. */
export function renderQuestion(q: AssistantQuestion | null | undefined): string {
  if (!q || q.options.length < 2) return '';
  return `\n\n${q.text}\n${q.options.map((o) => `- ${o}`).join('\n')}`;
}

export function buildAssistantSystemPrompt(p: {
  persona: { soulMd: string; identityMd: string; memoryMd: string };
  personas: { name: string; displayName: string; identityMd: string }[];
  assistantName: string;
}): string {
  const identity = [p.persona.soulMd, p.persona.identityMd, p.persona.memoryMd].filter((s) => s.trim().length > 0).join('\n\n---\n\n');
  const roster = p.personas
    .map((x) => `- @agent:${x.name} — ${x.displayName}${x.identityMd.trim() ? ` : ${x.identityMd.trim().split('\n')[0]!.slice(0, 160)}` : ''}`)
    .join('\n');
  return `${identity ? `${identity}\n\n---\n\n` : ''}# Rôle : assistant du ticket (« ${p.assistantName} »)

Tu es l'interlocuteur de l'utilisateur sur ce ticket. Tu lis chaque message, puis tu choisis EXACTEMENT UNE action et tu réponds UNIQUEMENT avec un objet JSON conforme au schéma fourni.

## Actions
- "reply" : répondre à l'utilisateur dans le fil principal (\`message\`, + \`question\` {text, options} si tu attends un choix).
- "delegate" : ouvrir un thread avec une persona (\`personaName\` = clé après @agent:, \`brief\` une ligne, \`forward\` parmi ticket|worktrees|pr|deliverables, \`turn\` = le message complet adressé à l'agent avec tout le contexte utile, \`message\` optionnel = annonce dans le fil principal, ex. « Je vois ça avec The Builder »).
- "continue_thread" : envoyer un nouveau tour à l'agent d'un thread ouvert (\`threadId\`, \`turn\`). Si l'agent a posé une question et que le contexte du ticket contient la réponse, réponds-lui ici.
- "conclude_thread" : clore un thread (\`threadId\`, \`summary\` ≤ 3 lignes, + \`message\`/\`question\` optionnels pour le fil principal).

## Règles
- Délègue quand la demande exige du code, une analyse de dépôt ou l'expertise d'une persona ; réponds toi-même sinon.
- Un \`@agent:x\` dans le message de l'utilisateur est une consigne explicite de délégation à x.
- Un seul thread ouvert par persona et par ticket : s'il existe, utilise "continue_thread".
- Si l'agent attend une information que seul l'utilisateur détient, utilise "reply" avec une \`question\` ; ne l'invente jamais.
- Conclus dès que la réponse de l'agent est finale. Sur une demande de conclusion, la seule action valide est "conclude_thread".
- Réponds dans la langue de l'utilisateur. N'affirme rien sur l'état du ticket qui ne soit dans le contexte.

## Personas disponibles
${roster || '(aucune persona déléguable)'}`;
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
}): string {
  const t = p.context.ticket;
  const main = p.context.comments.filter((c) => !c.threadId).slice(-30).map(renderComment).join('\n');
  const threads = p.threads.length
    ? p.threads.map((th) => `- ${th.id} · @agent:${th.personaName} · ${th.status} · ${th.exchanges} tours · « ${th.brief} »`).join('\n')
    : '(aucun)';
  const turns = p.turns.length ? p.turns.map(renderComment).join('\n') : '(aucun)';
  const deliverables = p.context.deliverables.slice(-10).map((d) => `- ${d.title} (${d.status})`).join('\n') || '(aucun)';
  const trig = p.trigger;
  let trigger: string;
  switch (trig.kind) {
    case 'user_message': {
      const c = p.context.comments.find((x) => x.id === trig.commentId);
      trigger = `Nouveau message de l'utilisateur :\n${c ? c.body : '(introuvable)'}`;
      break;
    }
    case 'thread_reply':
      trigger = trig.mentionStatus === 'failed'
        ? `L'exécution de l'agent du thread ${trig.threadId} a échoué. Informe l'utilisateur ("reply") ou relance ("continue_thread").`
        : `L'agent du thread ${trig.threadId} a répondu (statut de sa mention : ${trig.mentionStatus}). Décide : continuer, conclure, ou relayer une question à l'utilisateur.`;
      break;
    case 'conclude_request':
      trigger = `L'utilisateur demande de conclure le thread ${trig.threadId} maintenant. Réponds avec "conclude_thread".`;
      break;
  }
  return `# Ticket #${t.displayId} — ${t.title}
Statut : ${t.status} · Type : ${t.type ?? '-'} · Priorité : ${t.priority}
${t.description ? `\n## Description\n${t.description}\n` : ''}
## Fil principal (30 derniers)
${main || '(vide)'}

## Threads du ticket
${threads}

## Tours du thread concerné
${turns}

## Livrables
${deliverables}

## Déclencheur
${trigger}`;
}
