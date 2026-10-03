import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { NOOP } from './noop';
import type {
  Ticket,
  TicketComment,
  TicketDeliverable,
  TicketMention,
  TicketWsMessage,
} from '@fleex/shared';
import * as api from '../services/api';
import { appWs } from '../services/websocket';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { useUnreadStore } from '../stores/unreadStore';
import { useAgentEventStore } from '../stores/agentEventStore';
import { useCommentDraft } from '../hooks/useCommentDraft';
import { useToastStore } from '../stores/toastStore';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { MobileDeliverableReader } from './MobileDeliverableReader';
import { MobileComposer } from './MobileComposer';
import { tint } from '../lib/tints';

const MENTION_STATUS_LABEL: Record<TicketMention['status'], string> = {
  pending: '⏳ en attente',
  acknowledged: '⚙️ en cours',
  resolved: '✅ résolu',
  waiting_for_info: '❓ question posée',
  failed: '❌ échec',
};

function parseAgentMentions(body: string): string[] {
  const withoutStruck = body.replace(/~~[\s\S]*?~~/g, '');
  const names = new Set<string>();
  for (const match of withoutStruck.matchAll(/@agent:([a-zA-Z0-9_-]+)/g)) {
    names.add(match[1]!);
  }
  return [...names];
}

type Conflict = {
  kind: 'waiting' | 'busy';
  agents: { agent: string; displayName: string }[];
};

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text.trim());
}

function DeliverableChip({
  deliverable,
  seen,
  onOpen,
}: {
  deliverable: TicketDeliverable;
  seen: boolean;
  onOpen: (d: TicketDeliverable) => void;
}) {
  return (
    <button
      onClick={() => onOpen(deliverable)}
      className="flex max-w-full items-center gap-1.5 min-h-11 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-hover)] px-3 py-1.5 text-left"
    >
      {!seen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--theme-accent)]" />}
      <span className="shrink-0 text-xs">📄</span>
      <span className="min-w-0 truncate text-[11px] font-medium text-[var(--theme-text-primary)]">
        {deliverable.title}
      </span>
      <span className="shrink-0 text-[9px] uppercase tracking-wide text-[var(--theme-text-faint)]">
        {deliverable.type}
        {deliverable.status === 'draft' ? ' · draft' : ''}
      </span>
    </button>
  );
}

export function MobileConversation({ ticket }: { ticket: Ticket }) {
  const ticketId = ticket.id;
  const personas = useAgentPersonaStore((s) => s.personas);
  const markCommentsRead = useUnreadStore((s) => s.markCommentsRead);

  const [comments, setComments] = useState<TicketComment[]>([]);
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const [deliverables, setDeliverables] = useState<TicketDeliverable[]>([]);
  const [openDeliverable, setOpenDeliverable] = useState<TicketDeliverable | null>(null);
  // Per-ticket draft in localStorage (same key as desktop), survives tab switches and reloads
  const { draft: body, setDraft: setBody, clearDraft } = useCommentDraft(ticketId);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();

  // Seen-state drives the unread dot on each deliverable chip
  const seenDeliverables = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]);
  const loadSeenDeliverables = useUnreadStore((s) => s.loadSeenDeliverables);
  // Executions carry the explicit comment↔deliverable FK (workflow/panel/skill
  // sources never populate a mention) — already loaded/subscribed by the parent.
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticketId]);

  useEffect(() => {
    api.fetchTicketComments(ticketId).then(setComments).catch(() => {});
    api.fetchTicketMentions(ticketId).then(setMentions).catch(() => {});
    api.fetchTicketDeliverables(ticketId).then(setDeliverables).catch(() => {});
    loadSeenDeliverables(ticketId).catch(() => {});
  }, [ticketId, loadSeenDeliverables]);

  // Opening the conversation on the phone = caught up
  useEffect(() => {
    const last = comments[comments.length - 1];
    if (last) markCommentsRead(ticketId, last.createdAt).catch(() => {});
  }, [ticketId, comments, markCommentsRead]);

  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'comment:created') {
        const c = msg.data as TicketComment;
        if (c.ticketId !== ticketId) return;
        setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
      } else if (msg.type === 'comment:updated') {
        const c = msg.data as TicketComment;
        if (c.ticketId !== ticketId) return;
        setComments((prev) => prev.map((x) => (x.id === c.id ? c : x)));
      } else if (msg.type === 'comment:deleted') {
        const d = msg.data as { id: string; ticketId: string };
        if (d.ticketId !== ticketId) return;
        setComments((prev) => prev.filter((x) => x.id !== d.id));
      } else if (msg.type === 'mention:created') {
        const m = msg.data as TicketMention;
        if (m.ticketId !== ticketId) return;
        setMentions((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      } else if (
        msg.type === 'mention:updated' ||
        msg.type === 'mention:acknowledged' ||
        msg.type === 'mention:resolved' ||
        msg.type === 'mention:waiting_for_info'
      ) {
        const m = msg.data as TicketMention;
        if (m.ticketId !== ticketId) return;
        setMentions((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      } else if (msg.type === 'mention:deleted') {
        const d = msg.data as { id: string; ticketId: string };
        if (d.ticketId !== ticketId) return;
        setMentions((prev) => prev.filter((x) => x.id !== d.id));
      } else if (msg.type === 'deliverable:created') {
        const d = msg.data as TicketDeliverable;
        if (d.ticketId !== ticketId) return;
        setDeliverables((prev) => (prev.some((x) => x.id === d.id) ? prev : [...prev, d]));
      } else if (msg.type === 'deliverable:updated') {
        const d = msg.data as TicketDeliverable;
        if (d.ticketId !== ticketId) return;
        setDeliverables((prev) => prev.map((x) => (x.id === d.id ? d : x)));
        setOpenDeliverable((cur) => (cur?.id === d.id ? d : cur));
      } else if (msg.type === 'deliverable:deleted') {
        const d = msg.data as { id: string; ticketId: string };
        if (d.ticketId !== ticketId) return;
        setDeliverables((prev) => prev.filter((x) => x.id !== d.id));
        setOpenDeliverable((cur) => (cur?.id === d.id ? null : cur));
      }
    });
    return unsub;
  }, [ticketId]);

  useLayoutEffect(() => {
    maybeStick();
  }, [comments.length, maybeStick]);

  const mentionsByComment = useMemo(() => {
    const map: Record<string, TicketMention[]> = {};
    for (const m of mentions) {
      (map[m.commentId] ??= []).push(m);
    }
    return map;
  }, [mentions]);

  // Same union as desktop TicketComments: a deliverable is attached to the
  // comment that delivered it, through either link path —
  //   1. mention.resolvedCommentId ↔ mention.resolvedDeliverableId (@-mention flow)
  //   2. execution.commentId ↔ execution.deliverableId (explicit FK — covers
  //      workflow steps, panels and skills, which never populate a mention)
  const deliverablesByComment = useMemo(() => {
    const byId = new Map(deliverables.map((d) => [d.id, d]));
    const map = new Map<string, TicketDeliverable[]>();
    const linked = new Set<string>();
    const addLink = (commentId: string, d: TicketDeliverable) => {
      linked.add(d.id);
      const arr = map.get(commentId);
      if (!arr) {
        map.set(commentId, [d]);
        return;
      }
      if (!arr.some((x) => x.id === d.id)) arr.push(d);
    };
    for (const m of mentions) {
      if (!m.resolvedCommentId || !m.resolvedDeliverableId) continue;
      const d = byId.get(m.resolvedDeliverableId);
      if (d) addLink(m.resolvedCommentId, d);
    }
    for (const e of executions ?? []) {
      if (!e.commentId || !e.deliverableId) continue;
      const d = byId.get(e.deliverableId);
      if (d) addLink(e.commentId, d);
    }
    const orphans = deliverables.filter((d) => !linked.has(d.id));
    return { map, orphans };
  }, [deliverables, mentions, executions]);

  const isSeen = (d: TicketDeliverable) => seenDeliverables?.has(d.id) ?? false;

  // URL deliverables (e.g. a PR link) open externally, like on desktop
  const handleOpenDeliverable = useCallback((d: TicketDeliverable) => {
    if (isUrl(d.content)) {
      window.open(d.content.trim(), '_blank', 'noopener');
    } else {
      setOpenDeliverable(d);
    }
  }, []);

  const [mentionSheet, setMentionSheet] = useState<TicketMention | null>(null);
  const runMention = useCallback(async (m: TicketMention) => {
    setMentionSheet(null);
    try {
      const result = await api.runMention(m.id);
      if (result.status === 'no_work') {
        useToastStore.getState().addToast('info', `Rien à exécuter pour ${m.targetAgent}`);
      } else if (result.status === 'already_running') {
        useToastStore.getState().addToast('info', `${m.targetAgent} tourne déjà`);
      }
    } catch {
      // toast raised by the api layer
    }
  }, []);

  const resolveMention = useCallback(async (m: TicketMention) => {
    setMentionSheet(null);
    try {
      const updated = await api.updateMentionStatus(m.id, 'resolved');
      setMentions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch {
      // toast raised by the api layer
    }
  }, []);

  const removeMention = useCallback(async (m: TicketMention) => {
    setMentionSheet(null);
    try {
      await api.deleteMentionFromComment(m.id);
      setMentions((prev) => prev.filter((x) => x.id !== m.id));
    } catch {
      // toast raised by the api layer
    }
  }, []);

  const doPost = useCallback(
    async (conflicts: api.MentionConflictResolution[]) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      setSubmitting(true);
      try {
        const comment = await api.postTicketComment(
          ticketId,
          trimmed,
          undefined,
          conflicts.length > 0 ? conflicts : undefined,
        );
        setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
        markCommentsRead(ticketId, comment.createdAt).catch(() => {});
        clearDraft();
        setConflict(null);
        scrollToBottom();
      } finally {
        setSubmitting(false);
      }
    },
    [body, ticketId, markCommentsRead, scrollToBottom, clearDraft],
  );

  // Same disambiguation as desktop: re-mentioning an agent that is waiting for
  // info (answer vs new subject) or already running (supersede vs queue).
  const handleSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;

    const mentioned = parseAgentMentions(trimmed);
    const waiting: Conflict['agents'] = [];
    const busy: Conflict['agents'] = [];
    for (const agent of mentioned) {
      const unresolved = mentions.find(
        (m) => m.targetType === 'agent' && m.targetAgent === agent && m.status !== 'resolved',
      );
      if (!unresolved) continue;
      const persona = personas.find((p) => p.name === agent);
      const displayName = persona?.displayName || agent;
      if (unresolved.status === 'waiting_for_info') waiting.push({ agent, displayName });
      else if (unresolved.status === 'pending' || unresolved.status === 'acknowledged')
        busy.push({ agent, displayName });
    }
    if (waiting.length > 0) {
      setConflict({ kind: 'waiting', agents: waiting });
      return;
    }
    if (busy.length > 0) {
      setConflict({ kind: 'busy', agents: busy });
      return;
    }
    await doPost([]);
  }, [body, submitting, mentions, personas, doPost]);

  const resolveConflict = useCallback(
    (action: api.MentionConflictAction) => {
      if (!conflict) return;
      doPost(conflict.agents.map((a) => ({ agent: a.agent, action })));
    },
    [conflict, doPost],
  );

  // The transcript only depends on server data. Keeping it out of the render
  // path of `body` means a keystroke in the composer doesn't rebuild every
  // comment (dates, markdown, chips) — that was the typing latency.
  const transcript = useMemo(
    () => (
        comments.length === 0 && deliverablesByComment.orphans.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--theme-text-faint)]">
            Aucun commentaire — mentionne un agent pour lancer une session.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {comments.map((c) => {
              const isAgent = c.authorType === 'agent';
              const commentMentions = mentionsByComment[c.id] ?? [];
              return (
                <div
                  key={c.id}
                  className={`rounded-xl border p-3 text-sm ${
                    isAgent
                      ? 'border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]'
                      : 'border-transparent bg-[var(--theme-accent)]/10'
                  }`}
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-[var(--theme-text-primary)]">
                      {isAgent ? `🤖 ${c.authorName}` : c.authorName}
                    </span>
                    <span className="text-[10px] text-[var(--theme-text-faint)]">
                      {new Date(c.createdAt).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="overflow-x-auto text-[13px]">
                    <MarkdownRenderer content={c.body} onToggleCheckbox={NOOP} />
                  </div>
                  {commentMentions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {commentMentions.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setMentionSheet(m)}
                          className="inline-flex min-h-11 items-center rounded-full bg-[var(--theme-bg-hover)] px-3 text-xs text-[var(--theme-text-muted)]"
                        >
                          @{m.targetAgent} · {MENTION_STATUS_LABEL[m.status]}
                        </button>
                      ))}
                    </div>
                  )}
                  {(deliverablesByComment.map.get(c.id) ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(deliverablesByComment.map.get(c.id) ?? []).map((d) => (
                        <DeliverableChip key={d.id} deliverable={d} seen={isSeen(d)} onOpen={handleOpenDeliverable} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Deliverables not linked to any comment stay reachable */}
            {deliverablesByComment.orphans.length > 0 && (
              <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-3">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
                  Autres deliverables
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {deliverablesByComment.orphans.map((d) => (
                    <DeliverableChip key={d.id} deliverable={d} seen={isSeen(d)} onOpen={handleOpenDeliverable} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comments, mentionsByComment, deliverablesByComment, seenDeliverables, handleOpenDeliverable],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Comments */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {transcript}
      </div>

      {/* Conflict banner */}
      {conflict && (
        <div className="shrink-0 border-t border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-3 py-2.5">
          <p className="mb-2 text-xs text-[var(--theme-text-primary)]">
            {conflict.agents.map((a) => a.displayName).join(', ')}{' '}
            {conflict.kind === 'waiting'
              ? 'attend ta réponse. Ce message :'
              : 'a déjà un run en cours. Ce message :'}
          </p>
          <div className="flex gap-2">
            {conflict.kind === 'waiting' ? (
              <>
                <button
                  onClick={() => resolveConflict('answer')}
                  className="flex-1 min-h-11 rounded-xl bg-[var(--theme-accent)] px-3 text-sm font-medium text-[var(--theme-accent-fg)]"
                >
                  Répond à sa question
                </button>
                <button
                  onClick={() => resolveConflict('new_subject')}
                  className="flex-1 min-h-11 rounded-xl bg-[var(--theme-bg-hover)] px-3 text-sm font-medium text-[var(--theme-text-primary)]"
                >
                  Nouveau sujet
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => resolveConflict('queue')}
                  className="flex-1 min-h-11 rounded-xl bg-[var(--theme-accent)] px-3 text-sm font-medium text-[var(--theme-accent-fg)]"
                >
                  Mettre en file
                </button>
                <button
                  onClick={() => resolveConflict('supersede')}
                  className="flex-1 min-h-11 rounded-xl bg-[var(--theme-bg-hover)] px-3 text-sm font-medium text-[var(--theme-text-primary)]"
                >
                  Remplacer le run
                </button>
              </>
            )}
            <button
              onClick={() => setConflict(null)}
              className="min-h-11 min-w-11 shrink-0 rounded-lg px-2 text-sm text-[var(--theme-text-muted)]"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      <div
        className="shrink-0 border-t border-[var(--theme-border)] px-3 pb-2 pt-2"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
      >
        <MobileComposer ticket={ticket} value={body} onChange={setBody} onSubmit={handleSubmit} submitting={submitting} />
      </div>

      {/* Deliverable reader */}
      {openDeliverable && (
        <MobileDeliverableReader
          ticketId={ticketId}
          deliverable={openDeliverable}
          onClose={() => setOpenDeliverable(null)}
        />
      )}

      {/* Mention actions sheet */}
      {mentionSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setMentionSheet(null)}>
          <div
            className="w-full rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
              @{mentionSheet.targetAgent} · {MENTION_STATUS_LABEL[mentionSheet.status]}
            </p>
            <div className="flex flex-col gap-2">
              {mentionSheet.status !== 'resolved' && mentionSheet.targetType === 'agent' && (
                <button
                  onClick={() => runMention(mentionSheet)}
                  className="rounded-lg bg-[var(--theme-accent)] px-4 py-3 text-sm font-semibold text-[var(--theme-accent-fg)]"
                >
                  ▶ Relancer l'exécution
                </button>
              )}
              {mentionSheet.status !== 'resolved' && (
                <button
                  onClick={() => resolveMention(mentionSheet)}
                  className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-4 py-3 text-sm font-medium text-[var(--theme-text-primary)]"
                >
                  ✓ Marquer résolu
                </button>
              )}
              <button
                onClick={() => removeMention(mentionSheet)}
                className={`rounded-lg border px-4 py-3 text-sm font-medium ${tint('red')}`}
              >
                Supprimer la mention
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
