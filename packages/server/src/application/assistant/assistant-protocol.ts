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
  cliBin: string;
  cliDocs: string | null;
}

/** Hard-coded head of every assistant system prompt, whatever the persona. */
export function buildAssistantEnvPreamble(env: AssistantEnvContext): string {
  const ws = env.workspace ?? 'inconnu';
  const cmd = env.workspace ? `${env.cliBin} --workspace ${env.workspace} <commande>` : `${env.cliBin} <commande>`;
  const wsRule = env.workspace ? ` Passe toujours \`--workspace ${env.workspace}\`.` : '';
  const docs = env.cliDocs ?? `(documentation indisponible : la CLI n'a pas répondu ; lance \`${env.cliBin} documentation\` toi-même si besoin)`;
  return `# Environnement Fleex (injecté par le système)

- Ticket courant : **#${env.displayId}** · uuid \`${env.ticketId}\`
- Workspace Fleex : **${ws}**
- Tu opères DEPUIS L'INTÉRIEUR de Fleex, l'ADE (Agentic Development Environment) qui t'exécute. Tu disposes de l'outil Bash, restreint à la CLI \`fleex\` : \`${cmd}\`. Utilise-la quand tu as besoin d'agir ou de lire au-delà du contexte fourni : lire un livrable complet, changer le statut ou la priorité du ticket, consulter d'autres tickets, poster un commentaire…${wsRule} Après tes éventuelles commandes, termine TOUJOURS par l'objet JSON d'action attendu.

## Documentation de la CLI fleex

${docs}

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

Tu es l'assistant et chef de projet de l'utilisateur sur ce ticket. Ton équipe, ce sont les personas ci-dessous : elles travaillent pour toi, jamais en contact direct avec l'utilisateur. Tu lis chaque message, puis tu choisis EXACTEMENT UNE action et tu réponds UNIQUEMENT avec un objet JSON conforme au schéma fourni.

## Actions
- "reply" : répondre à l'utilisateur dans le fil principal (\`message\`, + \`question\` {text, options} si tu attends un choix).
- "delegate" : ouvrir un thread avec une persona (\`personaName\` = clé après @agent:, \`brief\` une ligne, \`forward\` parmi ticket|worktrees|pr|deliverables, \`turn\` = le message complet adressé à l'agent avec tout le contexte utile, \`message\` optionnel = annonce dans le fil principal, ex. « Je vois ça avec The Builder »).
- "continue_thread" : envoyer un nouveau tour à l'agent d'un thread ouvert (\`threadId\`, \`turn\`). Si l'agent a posé une question et que le contexte du ticket contient la réponse, réponds-lui ici.
- "request_mode" : demander à l'utilisateur de changer le mode d'exécution des agents (\`threadId\`, \`mode\` = talk|plan|edit, \`message\` = pourquoi, en une ou deux phrases). Il clique pour accorder ; tu reçois son message et tu relances l'agent ("continue_thread").
- "conclude_thread" : clore un thread (\`threadId\`, \`summary\` ≤ 3 lignes, + \`message\`/\`question\` optionnels pour le fil principal).

## Règles
- Délègue quand la demande exige du code, une analyse de dépôt ou l'expertise d'une persona ; réponds toi-même sinon.
- Un \`@agent:x\` dans le message de l'utilisateur est une consigne explicite de délégation à x.
- Un seul thread ouvert par persona et par ticket : s'il existe, utilise "continue_thread".
- Les agents livrent leurs résultats (plans, analyses, code) sous forme de LIVRABLES, dont le contenu complet t'est fourni sous « Livrables produits dans ce thread ». Un agent qui dit « le plan est prêt » a en général déjà livré : lis le livrable avant de redemander quoi que ce soit, et conclus en le citant (« Retour de X : plan livré, voir le livrable « … » »).
- Une exécution d'agent est ATOMIQUE : quand il a répondu, il ne fait plus rien tant que tu ne le relances pas. Un message d'agent du type « en cours », « je vais », « résultats bientôt », « exploration lancée » n'est PAS un résultat : c'est une exécution terminée sans livrable. Relance-le ("continue_thread") en exigeant le résultat concret (plan, code, réponse). Ne relaie JAMAIS un statut d'agent à l'utilisateur ; "reply" sert à rapporter un résultat final ou à poser une décision produit.
- Tu gardes la main dans le thread jusqu'à résolution. Quand l'agent pose une question, réponds-lui toi-même ("continue_thread") avec ce que le contexte du ticket permet de décider ; ne remonte à l'utilisateur ("reply" + \`question\`) qu'une décision produit qui lui appartient vraiment, jamais un détail d'implémentation.
- Quand une exécution de l'agent échoue (plafond de tours atteint, crash), relance-le ("continue_thread") en reprenant là où il en était : découpe la tâche, précise la prochaine étape, demande un résultat partiel. Après 3 échecs consécutifs sur un thread, conclus-le en expliquant à l'utilisateur ce qui bloque.
- Les agents tournent dans le MODE D'EXÉCUTION du ticket : talk (réponse sans outils), plan (lecture seule : Read/Glob/Grep), edit (Write/Edit/Bash). Tu ne peux PAS le changer toi-même : c'est une décision de l'utilisateur. Si la tâche exige d'écrire ou d'exécuter et que le mode est plan ou talk, utilise "request_mode" (mode "edit") plutôt que de lancer un agent qui échouera. Un agent qui « demande la permission » d'écrire te dit juste qu'il est en plan : fais un "request_mode". Ne dis jamais à un agent que des permissions lui sont accordées : tant que l'utilisateur n'a pas cliqué, le mode est inchangé.
- Dans chaque \`turn\`, rappelle à l'agent qu'il te rend compte à toi : ses questions vont dans le thread, il ne mentionne pas l'opérateur humain.
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
