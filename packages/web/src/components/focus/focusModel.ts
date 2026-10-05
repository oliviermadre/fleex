import type { FocusItem, FocusItemKind, Ticket, TicketPriority, TicketStatus } from '@fleex/shared';
import { FOCUS_KIND_ORDER } from '@fleex/shared';
import type { TintHue } from '../../lib/tints';
import * as api from '../../services/api';

/**
 * Pure model of the Focus page: labels, ordering, and — above all — the actions
 * each item offers. Rows, the detail popup and the 1/2/3 shortcuts all read the
 * same `focusActions()` list, so a shortcut always does what the button says.
 */

export const KIND_META: Record<FocusItemKind, { label: string; plural: string; hue: TintHue }> = {
  gate: { label: 'Gate', plural: 'Gates', hue: 'yellow' },
  question: { label: 'Question', plural: 'Questions', hue: 'orange' },
  error: { label: 'Erreur', plural: 'Erreurs', hue: 'red' },
  idle: { label: 'Idle', plural: 'Idle', hue: 'gray' },
};

/** Past this wait an item is flagged (orange age). */
export const STALE_MS = 4 * 3600_000;

export function waitedMs(item: Pick<FocusItem, 'since'>, now: number): number | null {
  if (!item.since) return null;
  const t = Date.parse(item.since);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/** "à l’instant", "12 min", "2 h 05", "3 j 4 h". */
export function formatWait(ms: number | null): string {
  if (ms === null) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}

export type FocusSort = 'age' | 'priority' | 'kind';

const PRIORITY_RANK: Record<TicketPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };

/** Oldest first by default — the longest wait is the most expensive one. */
export function sortFocusItems(
  items: readonly FocusItem[],
  sort: FocusSort,
  ticketById: ReadonlyMap<string, Pick<Ticket, 'priority'>>,
): FocusItem[] {
  const since = (i: FocusItem) => (i.since ? Date.parse(i.since) : Number.POSITIVE_INFINITY);
  const byAge = (a: FocusItem, b: FocusItem) => since(a) - since(b);
  const prio = (i: FocusItem) => PRIORITY_RANK[ticketById.get(i.ticketId)?.priority ?? 'none'];
  return [...items].sort((a, b) => {
    if (sort === 'priority') return prio(a) - prio(b) || byAge(a, b);
    if (sort === 'kind') return FOCUS_KIND_ORDER[a.kind] - FOCUS_KIND_ORDER[b.kind] || byAge(a, b);
    return byAge(a, b);
  });
}

/** One-line context shown under the title. */
export function focusSummary(item: FocusItem): string {
  switch (item.kind) {
    case 'gate':
      return item.gate?.context?.split('\n').find((l) => l.trim())?.trim()
        ?? `${item.workflow?.name ?? 'Workflow'} en attente de ta décision`;
    case 'question':
      if (item.question?.source === 'session') {
        const what = item.question.sessionWait === 'permission' ? 'attend ton autorisation' : 'te pose une question';
        const msg = item.question.text?.replace(/\s+/g, ' ').trim();
        return `Session Claude dans le terminal : ${what}${msg ? ` · ${msg}` : ''}`;
      }
      return item.question?.text?.replace(/\s+/g, ' ').trim() || 'Question sans texte — ouvre le détail';
    case 'error':
      return item.error?.source === 'step'
        ? `Étape « ${item.error.label} » en échec${item.error.message ? ` · ${item.error.message}` : ''}`
        : `La session de ${item.error?.label ?? 'l’agent'} s’est interrompue`;
    case 'idle':
      if (item.idle?.cliRestAt) return 'Session Claude au repos : elle attend ta prochaine instruction';
      return item.idle?.lastActivityAt
        ? 'Aucun agent ne travaille dessus'
        : 'Aucun agent n’a encore travaillé dessus';
  }
}

export interface FocusAction {
  /** Stable within the item. */
  id: string;
  label: string;
  /** Where the choice leads, or what it does. */
  hint?: string;
  primary?: boolean;
  /** Runs at once, outside the undo window, and leaves the row in place (opening a terminal). */
  immediate?: boolean;
  /** Toast shown while the undo window is open. */
  toast: string;
  /** `notes` = the optional comment typed in the popup (gates) or the answer text (questions). */
  run: (notes?: string) => Promise<unknown>;
}

export interface FocusActionContext {
  ticket: Pick<Ticket, 'id' | 'displayId' | 'status'>;
  moveTicket: (ticketId: string, status: TicketStatus) => Promise<unknown>;
  /** Open a session as a floating terminal. */
  openSession?: (sessionId: string) => void;
}

/** The step an idle ticket is nudged to: Doing → Reviewing → Done, never straight to Done. */
const NEXT_STATUS: Partial<Record<TicketStatus, { status: TicketStatus; label: string; hint: string }>> = {
  doing: { status: 'reviewing', label: 'Reviewing', hint: 'le travail est prêt à relire' },
  reviewing: { status: 'done', label: 'Done', hint: 'le ticket sort de Focus' },
};

/**
 * Answer an agent. A plain comment wakes every agent waiting on the ticket
 * (server auto-wake); a paused workflow step additionally needs its retry, with
 * the answer recorded on the step so the retried attempt reads it.
 */
export function answerQuestion(item: FocusItem, text: string): Promise<unknown> {
  const q = item.question;
  if (q?.source === 'step' && q.runId && q.stepRunId) {
    const { runId, stepRunId } = q;
    return api.postTicketComment(item.ticketId, text).then(() => api.retryWorkflowStep(runId, stepRunId, text));
  }
  return api.postTicketComment(item.ticketId, text);
}

/**
 * The one-click actions of an item, primary first. Questions list the agent's
 * proposed answers (free text is typed separately); other kinds list their CTAs.
 */
export function focusActions(item: FocusItem, ctx: FocusActionContext): FocusAction[] {
  const ref = `#${ctx.ticket.displayId}`;
  switch (item.kind) {
    case 'gate': {
      const g = item.gate;
      if (!g) return [];
      return g.options.map((o, i) => ({
        id: `opt:${o.value}`,
        label: o.label,
        hint: o.targetStepName ? `→ ${o.targetStepName}` : undefined,
        primary: i === 0,
        toast: `${ref} · ${g.stepName} : ${o.label}`,
        run: (notes?: string) =>
          g.mode === 'route'
            ? api.resolveWorkflowRoute(g.runId, g.stepRunId, { edgeId: o.value, notes: notes || undefined })
            : api.resolveWorkflowGate(g.runId, g.stepRunId, { outcome: o.value, notes: notes || undefined }),
      }));
    }
    case 'question': {
      const q = item.question;
      if (q?.source === 'session') {
        const { sessionId } = q;
        const open = ctx.openSession;
        if (!sessionId || !open) return [];
        return [{
          id: 'open-session', label: 'Ouvrir CLI', hint: 'réponds dans le terminal', primary: true, immediate: true,
          toast: `${ref} · session ouverte`,
          run: async () => open(sessionId),
        }];
      }
      // Declared choices are answered in the detail (QuestionPicker); anything else is a free reply.
      return [];
    }
    case 'error': {
      const e = item.error;
      if (!e) return [];
      if (e.source === 'step' && e.runId && e.stepRunId) {
        const { runId, stepRunId } = e;
        return [{
          id: 'retry', label: 'Relancer', hint: 'même étape', primary: true,
          toast: `${ref} · étape « ${e.label} » relancée`,
          run: () => api.retryWorkflowStep(runId, stepRunId),
        }];
      }
      if (e.mentionId) {
        const mentionId = e.mentionId;
        return [{
          id: 'retry', label: 'Relancer', hint: `même agent (${e.label})`, primary: true,
          toast: `${ref} · ${e.label} relancé`,
          run: () => api.runMention(mentionId),
        }];
      }
      return [];
    }
    case 'idle': {
      const out: FocusAction[] = [];
      // A Claude session at rest in a terminal: pick the conversation back up there.
      const cliSession = item.idle?.cliSessionId;
      const open = ctx.openSession;
      if (cliSession && open) {
        out.push({
          id: 'open-session', label: 'Ouvrir CLI', hint: 'reprendre la conversation', primary: true, immediate: true,
          toast: `${ref} · session ouverte`,
          run: async () => open(cliSession),
        });
      }
      // No bare "relaunch the agent": without a comment it wouldn't know what to do next.
      // Waking it goes through a comment; a crashed run is an error item, with its own retry.
      const next = NEXT_STATUS[ctx.ticket.status];
      if (next) {
        out.push({
          id: 'advance', label: `Passer en ${next.label}`, hint: next.hint, primary: out.length === 0,
          toast: `${ref} · passé en ${next.label}`,
          run: () => ctx.moveTicket(item.ticketId, next.status),
        });
      }
      return out;
    }
  }
}
