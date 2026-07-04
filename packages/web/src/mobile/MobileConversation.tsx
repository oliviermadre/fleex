import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ConversationMode,
  Ticket,
  TicketComment,
  TicketMention,
  TicketWsMessage,
} from '@fleex/shared';
import * as api from '../services/api';
import { appWs } from '../services/websocket';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { useUnreadStore } from '../stores/unreadStore';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';

const MODES: { id: ConversationMode; label: string }[] = [
  { id: 'talk', label: '🗣 Talk' },
  { id: 'plan', label: '📋 Plan' },
  { id: 'edit', label: '📝 Edit' },
];

const MENTION_STATUS_LABEL: Record<TicketMention['status'], string> = {
  pending: '⏳ en attente',
  acknowledged: '⚙️ en cours',
  resolved: '✅ résolu',
  waiting_for_info: '❓ question posée',
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

export function MobileConversation({ ticket }: { ticket: Ticket }) {
  const ticketId = ticket.id;
  const personas = useAgentPersonaStore((s) => s.personas);
  const markCommentsRead = useUnreadStore((s) => s.markCommentsRead);

  const [comments, setComments] = useState<TicketComment[]>([]);
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();

  useEffect(() => {
    api.fetchTicketComments(ticketId).then(setComments).catch(() => {});
    api.fetchTicketMentions(ticketId).then(setMentions).catch(() => {});
  }, [ticketId]);

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

  const setMode = useCallback(
    (mode: ConversationMode) => {
      api.updateTicketExecutionConfig(ticketId, { conversationMode: mode }).catch(() => {});
    },
    [ticketId],
  );

  const insertMention = useCallback((name: string) => {
    setBody((prev) => {
      const sep = prev.length === 0 || prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ';
      return `${prev}${sep}@agent:${name} `;
    });
    textareaRef.current?.focus();
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
        setBody('');
        setConflict(null);
        scrollToBottom();
      } finally {
        setSubmitting(false);
      }
    },
    [body, ticketId, markCommentsRead, scrollToBottom],
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Comments */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {comments.length === 0 ? (
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
                    <MarkdownRenderer content={c.body} onToggleCheckbox={() => {}} />
                  </div>
                  {commentMentions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {commentMentions.map((m) => (
                        <span
                          key={m.id}
                          className="rounded-full bg-[var(--theme-bg-hover)] px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)]"
                        >
                          @{m.targetAgent} · {MENTION_STATUS_LABEL[m.status]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
                  className="flex-1 rounded-lg bg-[var(--theme-accent)] px-3 py-2 text-xs font-medium text-white"
                >
                  Répond à sa question
                </button>
                <button
                  onClick={() => resolveConflict('new_subject')}
                  className="flex-1 rounded-lg bg-[var(--theme-bg-hover)] px-3 py-2 text-xs font-medium text-[var(--theme-text-primary)]"
                >
                  Nouveau sujet
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => resolveConflict('queue')}
                  className="flex-1 rounded-lg bg-[var(--theme-accent)] px-3 py-2 text-xs font-medium text-white"
                >
                  Mettre en file
                </button>
                <button
                  onClick={() => resolveConflict('supersede')}
                  className="flex-1 rounded-lg bg-[var(--theme-bg-hover)] px-3 py-2 text-xs font-medium text-[var(--theme-text-primary)]"
                >
                  Remplacer le run
                </button>
              </>
            )}
            <button
              onClick={() => setConflict(null)}
              className="shrink-0 rounded-lg px-2 py-2 text-xs text-[var(--theme-text-muted)]"
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
        {/* Mode + persona chips */}
        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-[var(--theme-border)]">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-2.5 py-1 text-[11px] font-medium ${
                  ticket.conversationMode === m.id
                    ? 'bg-[var(--theme-accent)] text-white'
                    : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {personas.map((p) => (
            <button
              key={p.id}
              onClick={() => insertMention(p.name)}
              className="shrink-0 rounded-full bg-[var(--theme-bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--theme-text-muted)]"
            >
              @{p.displayName || p.name}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message… (@agent:nom pour lancer une session)"
            rows={2}
            className="min-h-0 flex-1 resize-none rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-3 text-base leading-snug text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
          />
          <button
            onClick={handleSubmit}
            disabled={!body.trim() || submitting}
            className="shrink-0 rounded-xl bg-[var(--theme-accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? '…' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}
