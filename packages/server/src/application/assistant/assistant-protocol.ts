import type { AgentThread, ConversationMode, TicketComment, TicketContext, TicketDeliverable } from '@fleex/shared';

export interface AssistantQuestion { text: string; options: string[] }

export type AssistantTrigger =
  | { kind: 'user_message'; commentId: string }
  | { kind: 'ticket_created' }
  | { kind: 'thread_reply'; threadId: string; mentionStatus: 'resolved' | 'waiting_for_info' | 'failed' }
  | { kind: 'conclude_request'; threadId: string };

export type AssistantAction =
  | { action: 'reply'; message: string; question: AssistantQuestion | null }
  | { action: 'delegate'; personaName: string; brief: string; forward: string[]; turn: string; message: string | null }
  | { action: 'continue_thread'; threadId: string; turn: string }
  | { action: 'request_mode'; threadId: string; mode: ConversationMode; message: string }
  | { action: 'conclude_thread'; threadId: string; summary: string; message: string | null; question: AssistantQuestion | null };

export const FORWARD_KEYS = ['ticket', 'worktrees', 'pr', 'deliverables'] as const;

/** The thread actions, as Messages-API tools. Names map 1:1 to `AssistantAction['action']`. */
export const ACTION_TOOL_NAMES = {
  delegate_to_persona: 'delegate',
  continue_thread: 'continue_thread',
  conclude_thread: 'conclude_thread',
  request_mode: 'request_mode',
} as const;

export const ACTION_TOOLS: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [
  {
    name: 'delegate_to_persona',
    description: "Ouvre un thread avec une persona de l'équipe et lui envoie le premier tour. Une seule délégation par tour.",
    input_schema: {
      type: 'object',
      properties: {
        personaName: { type: 'string', description: "Clé de la persona (après @agent:)" },
        brief: { type: 'string', description: 'Une ligne : ce que la persona doit produire' },
        forward: { type: 'array', items: { type: 'string', enum: [...FORWARD_KEYS] }, description: 'Contexte transmis' },
        turn: { type: 'string', description: "Le message complet adressé à l'agent, avec tout le contexte utile" },
        message: { type: 'string', description: "Annonce dans le fil principal, ex. « Je vois ça avec The Builder »" },
      },
      required: ['personaName', 'brief', 'turn'],
    },
  },
  {
    name: 'continue_thread',
    description: "Envoie un nouveau tour à l'agent d'un thread ouvert (relance, réponse à sa question, précision).",
    input_schema: {
      type: 'object',
      properties: { threadId: { type: 'string' }, turn: { type: 'string', description: "Le message adressé à l'agent" } },
      required: ['threadId', 'turn'],
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
];

/** Validates a thread-action tool call into an `AssistantAction`, or null when unusable. */
export function parseActionToolInput(toolName: string, input: Record<string, unknown>): AssistantAction | null {
  const action = (ACTION_TOOL_NAMES as Record<string, string>)[toolName];
  if (!action) return null;
  return parseAssistantOutput({ ...input, action }, '');
}

export const ASSISTANT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['reply', 'delegate', 'continue_thread', 'conclude_thread', 'request_mode'] },
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
    mode: { type: ['string', 'null'], enum: ['talk', 'plan', 'edit', null] },
    threadId: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
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

/** The bullet-list shape `parseInlineOptions` (web) recognises as an inline question. */
export function renderQuestion(q: AssistantQuestion | null | undefined): string {
  if (!q || q.options.length < 2) return '';
  return `\n\n${q.text}\n${q.options.map((o) => `- ${o}`).join('\n')}`;
}

export interface AssistantEnvContext {
  ticketId: string;
  displayId: number;
  workspace: string | null;
  /** Number of `fleex_*` tools available this turn (0 = CLI unreachable). */
  cliToolCount: number;
}

/** Hard-coded head of every assistant system prompt, whatever the persona. */
export function buildAssistantEnvPreamble(env: AssistantEnvContext): string {
  const ws = env.workspace ?? 'inconnu';
  const cli = env.cliToolCount > 0
    ? `Tu disposes de ${env.cliToolCount} outils \`fleex_*\` : ce sont les commandes de la CLI \`fleex\` de cet ADE (lire un ticket ou un livrable complet, changer le statut ou la priorité, commenter, lister…). Elles ciblent déjà le workspace **${ws}**. Les actions destructives (suppression, arrêt d'instance) ne te sont pas proposées : elles restent à l'utilisateur.`
    : `La CLI \`fleex\` n'a pas répondu : aucun outil \`fleex_*\` ce tour-ci, appuie-toi sur le contexte fourni.`;
  return `# Environnement Fleex (injecté par le système)

- Ticket courant : **#${env.displayId}** · uuid \`${env.ticketId}\`
- Workspace Fleex : **${ws}**
- Tu opères DEPUIS L'INTÉRIEUR de Fleex, l'ADE (Agentic Development Environment) qui t'exécute. ${cli}

---

`;
}

export function buildAssistantSystemPrompt(p: {
  persona: { soulMd: string; identityMd: string; memoryMd: string };
  personas: { name: string; displayName: string; identityMd: string }[];
  assistantName: string;
  /** When given, the environment block is the very first thing in the prompt. */
  env?: AssistantEnvContext;
}): string {
  const preamble = p.env ? buildAssistantEnvPreamble(p.env) : '';
  const identity = [p.persona.soulMd, p.persona.identityMd, p.persona.memoryMd].filter((s) => s.trim().length > 0).join('\n\n---\n\n');
  const roster = p.personas
    .map((x) => `- @agent:${x.name} — ${x.displayName}${x.identityMd.trim() ? ` : ${x.identityMd.trim().split('\n')[0]!.slice(0, 160)}` : ''}`)
    .join('\n');
  return `${preamble}${identity ? `${identity}\n\n---\n\n` : ''}# Rôle : assistant du ticket (« ${p.assistantName} »)

Tu es le chef de projet de l'utilisateur sur ce ticket : tu parles vite et court, tu ne fais pas le travail toi-même, tu le confies à ton équipe (les personas ci-dessous) et tu en rends compte. Ton équipe ne parle jamais à l'utilisateur : c'est toi qui parles.

## Comment tu agis
- **Ton texte** est ton message à l'utilisateur, streamé en direct dans le fil du ticket : deux à quatre phrases, pas de rapport. Pour poser un choix, termine par une liste à puces d'options (2 à 4). Laisse ton texte vide si tu as seulement délégué ou relancé un agent : la carte du thread suffit.
- **Tes outils** :
  - \`delegate_to_persona\` : ouvrir un thread avec une persona (brief d'une ligne, \`turn\` = le message complet à l'agent avec tout le contexte utile, \`message\` = l'annonce dans le fil, ex. « Je vois ça avec The Builder »).
  - \`continue_thread\` : envoyer un nouveau tour à l'agent d'un thread ouvert (relance, réponse à sa question, précision).
  - \`conclude_thread\` : clore un thread avec un résumé ≤ 3 lignes ; le résumé est posté dans le fil (« Retour de X : … »).
  - \`request_mode\` : demander à l'utilisateur de changer le mode d'exécution des agents (talk | plan | edit) — tu ne peux PAS le changer toi-même.
  - \`fleex_*\` : la CLI Fleex (lire, lister, commenter, mettre à jour…). Utilise-les pour vérifier plutôt que supposer.
- Une seule intention par tour : réponds, OU délègue, OU relance, OU conclus. N'enchaîne pas plusieurs actions de thread dans le même tour.

## Règles
- Délègue quand la demande exige du code, une analyse de dépôt ou l'expertise d'une persona ; réponds toi-même sinon. Ne lis pas le code toi-même, ne planifie pas à la place de l'agent : ton rôle est de cadrer, déléguer, suivre, rapporter.
- Un \`@agent:x\` dans le message de l'utilisateur est une consigne explicite de délégation à x.
- Un seul thread ouvert par persona et par ticket : s'il existe, utilise \`continue_thread\`.
- Les agents tournent dans le mode d'exécution du ticket : talk (sans outils), plan (lecture seule), edit (Write/Edit/Bash). Si la tâche exige d'écrire et que le mode est plan ou talk, \`request_mode\` AVANT de lancer un agent qui échouera. Un agent qui « demande la permission » d'écrire est en plan : \`request_mode\`. Ne dis jamais à un agent que des permissions lui sont accordées.
- Les agents livrent leurs résultats en LIVRABLES, fournis en entier sous « Livrables produits dans ce thread ». Un agent qui dit « le plan est prêt » a en général déjà livré : lis le livrable avant de redemander, et conclus en le citant.
- Une exécution d'agent est ATOMIQUE : quand il a répondu, il ne fait plus rien tant que tu ne le relances pas. « En cours », « je vais », « résultats bientôt » n'est PAS un résultat : relance-le en exigeant le livrable. Ne relaie JAMAIS un statut d'agent à l'utilisateur.
- Tu gardes la main dans le thread jusqu'à résolution. Quand l'agent pose une question, réponds-lui toi-même (\`continue_thread\`) avec ce que le contexte permet de décider ; ne remonte à l'utilisateur qu'une décision produit qui lui appartient vraiment.
- Quand une exécution échoue (plafond de tours, crash), relance l'agent en reprenant là où il en était : découpe, précise l'étape suivante, demande un résultat partiel. Après 3 échecs consécutifs, conclus en expliquant ce qui bloque.
- Dans chaque \`turn\`, rappelle à l'agent qu'il te rend compte à toi : ses questions vont dans le thread, il ne mentionne pas l'opérateur humain.
- Réponds dans la langue de l'utilisateur. N'affirme rien sur l'état du ticket qui ne soit dans le contexte ou vérifié par un outil.

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
  /** Deliverables produced inside the thread concerned: shown in full, they ARE the agent's results. */
  threadDeliverables?: TicketDeliverable[];
}): string {
  const t = p.context.ticket;
  const main = p.context.comments.filter((c) => !c.threadId).slice(-30).map(renderComment).join('\n');
  const threads = p.threads.length
    ? p.threads.map((th) => `- ${th.id} · @agent:${th.personaName} · ${th.status} · ${th.exchanges} tours · « ${th.brief} »`).join('\n')
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
      trigger = `Nouveau message de l'utilisateur :\n${c ? c.body : '(introuvable)'}`;
      break;
    }
    case 'thread_reply':
      trigger = trig.mentionStatus === 'failed'
        ? `L'exécution de l'agent du thread ${trig.threadId} a échoué (${p.threads.find((t) => t.id === trig.threadId)?.failures ?? 1} échec(s) consécutif(s)). Relance-le ("continue_thread") en reprenant sa progression et en découpant ce qui reste ; ne préviens l'utilisateur qu'après 3 échecs.`
        : trig.mentionStatus === 'resolved'
          ? `L'agent du thread ${trig.threadId} a terminé son exécution et a répondu (voir ses tours). Il ne fera plus rien sans toi. Si sa réponse est un résultat final, conclus ("conclude_thread") ; sinon relance-le ("continue_thread") en exigeant le livrable attendu. Ne relaie pas un simple statut à l'utilisateur.`
          : `L'agent du thread ${trig.threadId} attend une information (statut waiting_for_info). Réponds-lui toi-même ("continue_thread") si le contexte le permet, sinon pose la décision à l'utilisateur ("reply" + question) ou demande un changement de mode ("request_mode").`;
      break;
    case 'ticket_created':
      trigger = `Le ticket vient d'être créé et l'utilisateur te le confie. Prends-le en charge à partir de sa description : délègue à la bonne persona ("delegate") ou, si la description ne suffit pas, pose LA question qui débloque ("reply" + question).`;
      break;
    case 'conclude_request':
      trigger = `L'utilisateur demande de conclure le thread ${trig.threadId} maintenant. Réponds avec "conclude_thread".`;
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

## Déclencheur
${trigger}`;
}
