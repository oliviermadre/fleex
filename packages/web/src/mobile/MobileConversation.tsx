import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EFFORT_LEVELS } from '@fleex/shared';
import type {
  ConversationMode,
  EffortLevel,
  Ticket,
  TicketComment,
  TicketDeliverable,
  TicketMention,
  TicketWsMessage,
} from '@fleex/shared';
import * as api from '../services/api';
import { appWs } from '../services/websocket';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { usePanelStore } from '../stores/panelStore';
import { useSkillStore } from '../stores/skillStore';
import { useWorkflowTemplateStore } from '../stores/workflowTemplateStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTicketStore } from '../stores/ticketStore';
import { useUnreadStore } from '../stores/unreadStore';
import { useAgentEventStore } from '../stores/agentEventStore';
import { useModels } from '../hooks/useModels';
import { useToastStore } from '../stores/toastStore';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { ModelSelect } from '../components/agents/ModelSelect';
import { MobileDeliverableReader } from './MobileDeliverableReader';

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

// Same option model as the desktop composer (TicketComments): every mention
// target the server understands — agents, panels, skills, workflows, the
// human name and tickets.
interface MentionOption {
  insertText: string;
  label: string;
  type: 'agent' | 'human' | 'panel' | 'skill' | 'workflow' | 'ticket';
}

const MENTION_TYPE_BADGE: Record<MentionOption['type'], { letter: string; className: string }> = {
  agent: { letter: 'A', className: 'bg-purple-500/20 text-purple-400' },
  panel: { letter: 'P', className: 'bg-blue-500/20 text-blue-400' },
  skill: { letter: 'S', className: 'bg-emerald-500/20 text-emerald-400' },
  workflow: { letter: 'W', className: 'bg-orange-500/20 text-orange-400' },
  ticket: { letter: 'T', className: 'bg-slate-500/20 text-slate-400' },
  human: { letter: 'H', className: 'bg-amber-500/20 text-amber-400' },
};

// Tickets can be numerous — only surface them once a query is typed, capped.
const MAX_TICKET_SUGGESTIONS = 8;

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
      className="flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-hover)] px-2.5 py-1.5 text-left"
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

  // Mention targets beyond personas — loaded lazily like the desktop composer
  const panels = usePanelStore((s) => s.panels);
  const panelsLoaded = usePanelStore((s) => s.loaded);
  const loadPanels = usePanelStore((s) => s.loadPanels);
  const skills = useSkillStore((s) => s.skills);
  const skillsLoaded = useSkillStore((s) => s.loaded);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const workflowTemplates = useWorkflowTemplateStore((s) => s.templates);
  const refreshWorkflowTemplates = useWorkflowTemplateStore((s) => s.refresh);
  const humanMentionName = useSettingsStore(
    (s) => (s.settings as unknown as Record<string, unknown>)['humanMentionName'] as string | undefined,
  );
  const allTickets = useTicketStore((s) => s.tickets);

  useEffect(() => {
    if (!panelsLoaded) loadPanels();
    if (!skillsLoaded) loadSkills();
    if (workflowTemplates.length === 0) void refreshWorkflowTemplates();
  }, [panelsLoaded, loadPanels, skillsLoaded, loadSkills, workflowTemplates.length, refreshWorkflowTemplates]);

  const [comments, setComments] = useState<TicketComment[]>([]);
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const [deliverables, setDeliverables] = useState<TicketDeliverable[]>([]);
  const [openDeliverable, setOpenDeliverable] = useState<TicketDeliverable | null>(null);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();

  // Seen-state drives the unread dot on each deliverable chip
  const seenDeliverables = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]);
  const loadSeenDeliverables = useUnreadStore((s) => s.loadSeenDeliverables);
  // Executions carry the explicit comment↔deliverable FK (workflow/panel/skill
  // sources never populate a mention) — already loaded/subscribed by the parent.
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticketId]);

  // ── Mention autocomplete (triggered by typing '@' in the textarea) ──
  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acTriggerPos, setAcTriggerPos] = useState(-1);

  const allMentionOptions = useMemo<MentionOption[]>(() => {
    const opts: MentionOption[] = personas.map((p) => ({
      insertText: `@agent:${p.name}`,
      label: p.displayName || p.name,
      type: 'agent' as const,
    }));
    for (const panel of panels) {
      if (panel.enabled) {
        opts.push({ insertText: `@panel:${panel.name}`, label: panel.displayName || panel.name, type: 'panel' });
      }
    }
    for (const skill of skills) {
      if (skill.enabled) {
        opts.push({ insertText: `@skill:${skill.commandName}`, label: skill.displayName || skill.commandName, type: 'skill' });
      }
    }
    for (const wf of workflowTemplates) {
      if (wf.enabled) {
        opts.push({ insertText: `@workflow:${wf.slug}`, label: wf.emoji ? `${wf.emoji} ${wf.name}` : wf.name, type: 'workflow' });
      }
    }
    if (humanMentionName) {
      opts.push({ insertText: `@${humanMentionName}`, label: humanMentionName, type: 'human' });
    }
    for (const t of allTickets) {
      opts.push({ insertText: `@ticket:${t.displayId}`, label: `#${t.displayId} ${t.title}`, type: 'ticket' });
    }
    return opts;
  }, [personas, panels, skills, workflowTemplates, humanMentionName, allTickets]);

  const filteredOptions = useMemo(() => {
    if (!acOpen) return [];
    const q = acQuery.toLowerCase();
    const matches = (o: MentionOption) =>
      o.label.toLowerCase().includes(q) || o.insertText.toLowerCase().includes(q);
    const nonTicket = allMentionOptions.filter((o) => o.type !== 'ticket' && matches(o));
    // Bare "@" would otherwise dump every ticket into the list
    if (q.length === 0) return nonTicket;
    const tickets = allMentionOptions
      .filter((o) => o.type === 'ticket' && matches(o))
      .slice(0, MAX_TICKET_SUGGESTIONS);
    return [...nonTicket, ...tickets];
  }, [acOpen, acQuery, allMentionOptions]);

  const closeMentionAc = useCallback(() => {
    setAcOpen(false);
    setAcQuery('');
    setAcTriggerPos(-1);
  }, []);

  // Same trigger detection as desktop: last '@' before the cursor, at the
  // start or after whitespace, with no space typed after it yet.
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      const cursor = e.target.selectionStart;
      setBody(val);

      const textBeforeCursor = val.slice(0, cursor);
      const atIdx = textBeforeCursor.lastIndexOf('@');
      if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]!))) {
        const fragment = textBeforeCursor.slice(atIdx + 1);
        if (!/\s/.test(fragment)) {
          setAcOpen(true);
          setAcTriggerPos(atIdx);
          setAcQuery(fragment.replace(/^(agent|panel|skill|workflow|ticket):/, ''));
          return;
        }
      }
      closeMentionAc();
    },
    [closeMentionAc],
  );

  const acceptMention = useCallback(
    (opt: MentionOption) => {
      const ta = textareaRef.current;
      if (!ta || acTriggerPos < 0) return;
      const before = body.slice(0, acTriggerPos);
      const after = body.slice(ta.selectionStart);
      const newBody = before + opt.insertText + ' ' + after;
      setBody(newBody);
      closeMentionAc();
      const newCursor = acTriggerPos + opt.insertText.length + 1;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      });
    },
    [body, acTriggerPos, closeMentionAc],
  );

  // '@' button: appends a trigger at the end of the draft and opens the list —
  // more discoverable on a phone keyboard than knowing to type '@'.
  const openMentionPicker = useCallback(() => {
    const ta = textareaRef.current;
    const sep = body.length === 0 || body.endsWith(' ') || body.endsWith('\n') ? '' : ' ';
    const newBody = `${body}${sep}@`;
    setBody(newBody);
    setAcOpen(true);
    setAcTriggerPos(newBody.length - 1);
    setAcQuery('');
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(newBody.length, newBody.length);
    });
  }, [body]);

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

  const patchExecConfig = useCallback(
    (req: import('@fleex/shared').UpdateTicketExecutionConfigRequest) => {
      api.updateTicketExecutionConfig(ticketId, req).catch(() => {});
    },
    [ticketId],
  );

  const setMode = useCallback(
    (mode: ConversationMode) => patchExecConfig({ conversationMode: mode }),
    [patchExecConfig],
  );

  // ── Execution config (model/effort/fast overrides) + mention actions ──
  const { models } = useModels();
  const [showConfig, setShowConfig] = useState(false);
  const [mentionSheet, setMentionSheet] = useState<TicketMention | null>(null);
  const overriddenModel = ticket.modelOverride
    ? models.find((m) => m.id === ticket.modelOverride)
    : undefined;
  const hasOverrides = !!(ticket.modelOverride || ticket.effortOverride || ticket.fastMode);

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
        {comments.length === 0 && deliverablesByComment.orphans.length === 0 ? (
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
                        <button
                          key={m.id}
                          onClick={() => setMentionSheet(m)}
                          className="rounded-full bg-[var(--theme-bg-hover)] px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)]"
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

      {/* Mention autocomplete */}
      {acOpen && filteredOptions.length > 0 && (
        <div className="max-h-52 shrink-0 overflow-y-auto border-t border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]">
          {filteredOptions.map((opt) => {
            const badge = MENTION_TYPE_BADGE[opt.type];
            return (
              <button
                key={opt.insertText}
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptMention(opt);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-[var(--theme-bg-hover)]"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold ${badge.className}`}
                >
                  {badge.letter}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--theme-text-primary)]">
                  {opt.label}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--theme-text-faint)]">{opt.type}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Composer */}
      <div
        className="shrink-0 border-t border-[var(--theme-border)] px-3 pb-2 pt-2"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
      >
        {/* Mode + mention trigger */}
        <div className="mb-2 flex items-center gap-1.5">
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
          <div className="flex-1" />
          <button
            onClick={() => setShowConfig(true)}
            className={`shrink-0 rounded-lg border px-3 py-1 text-sm ${
              hasOverrides
                ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]'
                : 'border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]'
            }`}
            aria-label="Config d'exécution (modèle, effort, fast)"
          >
            ⚙{hasOverrides ? '·' : ''}
          </button>
          <button
            onClick={openMentionPicker}
            className="shrink-0 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-3 py-1 text-sm font-semibold text-[var(--theme-text-muted)]"
            aria-label="Mentionner un agent, skill, panel ou workflow"
          >
            @
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={handleInputChange}
            onBlur={() => setTimeout(closeMentionAc, 200)}
            placeholder="Message… (@ pour mentionner)"
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

      {/* Deliverable reader */}
      {openDeliverable && (
        <MobileDeliverableReader
          ticketId={ticketId}
          deliverable={openDeliverable}
          onClose={() => setOpenDeliverable(null)}
        />
      )}

      {/* Execution config sheet — conversation-scoped overrides, like desktop */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setShowConfig(false)}>
          <div
            className="w-full rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
              Config d'exécution
            </p>
            <p className="mb-3 text-[11px] text-[var(--theme-text-faint)]">
              S'applique à la prochaine mention de cette conversation, sans modifier la config des agents.
            </p>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
              Modèle
            </label>
            <ModelSelect
              value={ticket.modelOverride ?? ''}
              onChange={(v) => patchExecConfig({ modelOverride: v === '' ? null : v })}
              leadingOption={{ value: '', label: 'Auto (persona)' }}
              className="mb-3"
              ariaLabel="Modèle"
            />
            {overriddenModel?.supportsEffort === true && (
              <>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
                  Effort de raisonnement
                </label>
                <select
                  value={ticket.effortOverride ?? ''}
                  onChange={(e) =>
                    patchExecConfig({ effortOverride: e.target.value === '' ? null : (e.target.value as EffortLevel) })
                  }
                  className="mb-3 w-full appearance-none rounded-lg bg-[var(--theme-bg-secondary)] px-3 py-2.5 text-sm text-[var(--theme-text-primary)]"
                >
                  <option value="">Défaut</option>
                  {EFFORT_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>{lvl}</option>
                  ))}
                </select>
              </>
            )}
            {overriddenModel?.supportsFastMode === true && (
              <button
                onClick={() => patchExecConfig({ fastMode: !ticket.fastMode })}
                className={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium ${
                  ticket.fastMode
                    ? 'border-amber-400/40 bg-amber-400/15 text-amber-400'
                    : 'border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]'
                }`}
              >
                ⚡ Fast mode {ticket.fastMode ? 'activé' : 'désactivé'}
              </button>
            )}
          </div>
        </div>
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
                  className="rounded-lg bg-[var(--theme-accent)] px-4 py-3 text-sm font-semibold text-white"
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
                className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400"
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
