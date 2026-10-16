/**
 * Timeline annotations, per ticket — shared by the Timeline drawer (cards,
 * composer) and the conversation (the "📌 Épinglé" badge on a pinned comment).
 *
 * Live over the `tickets` WS channel (annotation:created/updated/deleted).
 * Creation is optimistic: the card shows at once in a `saving` state, and on
 * failure turns `error` with the draft kept, so the text is never lost.
 * The composer request lives here too, so the conversation can open it in the
 * drawer (pin a comment) without the two components knowing each other.
 */
import { create } from 'zustand';
import type { AnnotationTone, TicketWsMessage, TimelineAnnotation } from '@fleex/shared';
import * as api from '../services/api';
import { appWs } from '../services/websocket';

export type AnnotationUiState = 'saving' | 'error';

/** An annotation as displayed: a saved one, or an optimistic draft being saved / that failed. */
export interface UiAnnotation extends TimelineAnnotation {
  uiState?: AnnotationUiState;
}

export interface AnnotationDraft {
  /** ISO instant. */
  at: string;
  title: string;
  body: string;
  tone: AnnotationTone;
}

/** What the composer is opened for. */
export type ComposerRequest =
  | { mode: 'create'; ticketId: string; draft: AnnotationDraft }
  | { mode: 'promote'; ticketId: string; commentId: string; draft: AnnotationDraft }
  | { mode: 'edit'; ticketId: string; annotationId: string; draft: AnnotationDraft }
  /** A failed optimistic create, reopened to retry. */
  | { mode: 'retry'; ticketId: string; tempId: string; commentId: string | null; draft: AnnotationDraft };

interface AnnotationState {
  byTicket: Record<string, UiAnnotation[]>;
  composer: ComposerRequest | null;
  /** Card to pulse once (e.g. after clicking a comment's "Épinglé" badge). */
  highlight: { id: string; nonce: number } | null;

  load: (ticketId: string) => Promise<void>;
  openComposer: (req: ComposerRequest) => void;
  closeComposer: () => void;
  /** Save what the composer holds. Resolves once settled (the card shows meanwhile). */
  submit: (req: ComposerRequest) => Promise<void>;
  update: (ticketId: string, annotationId: string, patch: Partial<AnnotationDraft>) => Promise<void>;
  remove: (ticketId: string, annotationId: string) => Promise<void>;
  /** Drop a failed optimistic card. */
  discard: (ticketId: string, tempId: string) => void;
  pulse: (annotationId: string) => void;
}

const byAt = (a: TimelineAnnotation, b: TimelineAnnotation) => Date.parse(a.at) - Date.parse(b.at) || a.createdAt.localeCompare(b.createdAt);

function upsert(list: UiAnnotation[] | undefined, a: UiAnnotation, replaceId = a.id): UiAnnotation[] {
  const rest = (list ?? []).filter((x) => x.id !== replaceId && x.id !== a.id);
  return [...rest, a].sort(byAt);
}

let wsInstalled = false;

export const useAnnotationStore = create<AnnotationState>((set, get) => {
  const setList = (ticketId: string, fn: (list: UiAnnotation[] | undefined) => UiAnnotation[]) =>
    set((s) => ({ byTicket: { ...s.byTicket, [ticketId]: fn(s.byTicket[ticketId]) } }));

  const installWs = () => {
    if (wsInstalled) return;
    wsInstalled = true;
    appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'annotation:created' || msg.type === 'annotation:updated') {
        const a = msg.data as TimelineAnnotation;
        if (get().byTicket[a.ticketId]) setList(a.ticketId, (l) => upsert(l, a));
      } else if (msg.type === 'annotation:deleted') {
        const d = msg.data as { id: string; ticketId: string };
        if (get().byTicket[d.ticketId]) setList(d.ticketId, (l) => (l ?? []).filter((x) => x.id !== d.id));
      }
    });
  };

  return {
    byTicket: {},
    composer: null,
    highlight: null,

    load: async (ticketId) => {
      installWs();
      const list = await api.fetchTicketAnnotations(ticketId).catch(() => null);
      if (!list) return;
      // Keep optimistic drafts still in flight.
      setList(ticketId, (prev) => [...list, ...(prev ?? []).filter((x) => x.uiState)].sort(byAt));
    },

    openComposer: (req) => set({ composer: req }),
    closeComposer: () => set({ composer: null }),

    submit: async (req) => {
      set({ composer: null });
      const { ticketId, draft } = req;
      if (req.mode === 'edit') {
        await get().update(ticketId, req.annotationId, draft);
        return;
      }
      const commentId = req.mode === 'promote' ? req.commentId : req.mode === 'retry' ? req.commentId : null;
      const tempId = req.mode === 'retry' ? req.tempId : `draft-${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();
      const optimistic: UiAnnotation = {
        id: tempId, ticketId, ...draft, sourceCommentId: commentId, authorType: 'user', authorName: '',
        createdAt: nowIso, updatedAt: nowIso, uiState: 'saving',
      };
      setList(ticketId, (l) => upsert(l, optimistic));
      try {
        const saved = commentId
          ? await api.annotateComment(ticketId, commentId, draft)
          : await api.createTicketAnnotation(ticketId, draft);
        setList(ticketId, (l) => upsert(l, saved, tempId));
        get().pulse(saved.id);
      } catch {
        setList(ticketId, (l) => (l ?? []).map((x) => (x.id === tempId ? { ...x, uiState: 'error' as const } : x)));
      }
    },

    update: async (ticketId, annotationId, patch) => {
      const saved = await api.updateTicketAnnotation(ticketId, annotationId, patch).catch(() => null);
      if (saved) setList(ticketId, (l) => upsert(l, saved));
    },

    remove: async (ticketId, annotationId) => {
      await api.deleteTicketAnnotation(ticketId, annotationId);
      setList(ticketId, (l) => (l ?? []).filter((x) => x.id !== annotationId));
    },

    discard: (ticketId, tempId) => setList(ticketId, (l) => (l ?? []).filter((x) => x.id !== tempId)),

    pulse: (id) => set({ highlight: { id, nonce: Date.now() } }),
  };
});

/** The annotation pinned from this comment, if any. */
export function annotationForComment(list: readonly UiAnnotation[] | undefined, commentId: string): UiAnnotation | undefined {
  return list?.find((a) => a.sourceCommentId === commentId && !a.uiState);
}
