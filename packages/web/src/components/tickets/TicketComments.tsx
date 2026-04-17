import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import type { TicketComment, TicketMention, TicketWsMessage } from '@fleex/shared';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { appWs } from '../../services/websocket';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { FloatingExecutionPanel } from './ExecutionModal';
import { useUnreadStore } from '../../stores/unreadStore';
import * as api from '../../services/api';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useCommentDraft } from '../../hooks/useCommentDraft';
import { getProxiedImageSrc } from '../../lib/image';
import { ImageThumbnail } from '../shared/ImageThumbnail';

/**
 * Build a lookup: commentId -> mentionText -> mentionId
 */
function buildMentionLookup(mentions: TicketMention[]): Map<string, Map<string, string>> {
  const lookup = new Map<string, Map<string, string>>();
  for (const m of mentions) {
    let map = lookup.get(m.commentId);
    if (!map) {
      map = new Map();
      lookup.set(m.commentId, map);
    }
    const text = m.targetType === 'human' ? `@${m.targetAgent}` : m.targetType === 'panel' ? `@panel:${m.targetAgent}` : m.targetType === 'skill' ? `@skill:${m.targetAgent}` : `@agent:${m.targetAgent}`;
    map.set(text, m.id);
  }
  return lookup;
}

// ── Mention pre-processing ──

/**
 * Encode @mentions as markdown links with a custom href prefix so that
 * react-markdown can process the rest of the content normally, and we can
 * intercept mentions in the `a` component override.
 *
 * Content inside backtick code spans is left untouched.
 *
 * Mapping:
 *   @agent:name        →  [@agent:name](#fleex-agent:name)
 *   @panel:name        →  [@panel:name](#fleex-panel:name)
 *   @skill:name        →  [@skill:name](#fleex-skill:name)
 *   @username          →  [@username](#fleex-human:username)
 *   ~~@agent:name~~    →  [@agent:name](#fleex-struck:agent:name)
 *   ~~@skill:name~~    →  [@skill:name](#fleex-struck:skill:name)
 *   ~~@username~~      →  [@username](#fleex-struck:username)
 */
function preprocessMentions(body: string): string {
  return body.replace(
    // Group 1: code span (preserve verbatim)
    // Group 2: struck agent mention
    // Group 3: struck panel mention
    // Group 4: struck skill mention
    // Group 5: struck human mention
    // Group 6: active agent mention
    // Group 7: active panel mention
    // Group 8: active skill mention
    // Group 9: active human mention
    /(```[\s\S]*?```|`[^`]*`)|~~(@agent:[a-zA-Z0-9_-]+)~~|~~(@panel:[a-zA-Z0-9_-]+)~~|~~(@skill:[a-zA-Z0-9_-]+)~~|~~(@[a-zA-Z0-9_-]+)~~|(@agent:[a-zA-Z0-9_-]+)|(@panel:[a-zA-Z0-9_-]+)|(@skill:[a-zA-Z0-9_-]+)|(@[a-zA-Z0-9_-]+)/g,
    (_match, codeSpan, struckAgent, struckPanel, struckSkill, struckHuman, activeAgent, activePanel, activeSkill, activeHuman) => {
      if (codeSpan !== undefined) return codeSpan;
      if (struckAgent !== undefined) return `[${struckAgent}](#fleex-struck:${struckAgent.slice(1)})`;
      if (struckPanel !== undefined) return `[${struckPanel}](#fleex-struck:${struckPanel.slice(1)})`;
      if (struckSkill !== undefined) return `[${struckSkill}](#fleex-struck:${struckSkill.slice(1)})`;
      if (struckHuman !== undefined) return `[${struckHuman}](#fleex-struck:${struckHuman.slice(1)})`;
      if (activeAgent !== undefined) return `[${activeAgent}](#fleex-agent:${activeAgent.slice(1)})`;
      if (activePanel !== undefined) return `[${activePanel}](#fleex-panel:${activePanel.slice(1)})`;
      if (activeSkill !== undefined) return `[${activeSkill}](#fleex-skill:${activeSkill.slice(1)})`;
      if (activeHuman !== undefined) return `[${activeHuman}](#fleex-human:${activeHuman.slice(1)})`;
      return _match;
    },
  );
}

function MentionSpan({ text, mentionId, onRemove, className }: {
  text: string;
  mentionId: string | undefined;
  onRemove: (id: string) => void;
  className: string;
}) {
  return (
    <span className={`group/mention relative inline-flex items-center rounded-sm px-1 py-px ${className}`}>
      {text}
      {mentionId && (
        <button
          className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-red-500/30 group-hover/mention:opacity-100"
          onClick={(e) => { e.stopPropagation(); onRemove(mentionId); }}
          title="Remove mention"
        >
          <svg className="h-2 w-2 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

// ── Comment Markdown Renderer ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const commentRehypePlugins: any[] = [[rehypeHighlight, { detect: true }]];
const commentRemarkPlugins = [remarkGfm];

const CommentMarkdown = memo(function CommentMarkdown({
  body,
  commentId,
  mentionLookup,
  onRemoveMention,
}: {
  body: string;
  commentId: string;
  mentionLookup: Map<string, Map<string, string>>;
  onRemoveMention: (id: string) => void;
}) {
  const commentMentions = mentionLookup.get(commentId);

  // Normalize literal \n escape sequences from agent output, then encode mentions
  const processed = preprocessMentions(body.replace(/\\n/g, '\n'));

  const components: Components = {
    // ── Mentions & links ─────────────────────────────────────────────────────
    a: ({ href, children }) => {
      if (href?.startsWith('#fleex-struck:')) {
        // Struck-through mention (removed/resolved)
        return (
          <span className="rounded-sm px-1 py-px text-[var(--theme-text-faint)] line-through opacity-60">
            {children}
          </span>
        );
      }
      if (href?.startsWith('#fleex-agent:')) {
        const name = href.slice('#fleex-agent:'.length);
        const mentionText = `@${name}`;
        const mId = commentMentions?.get(mentionText);
        return (
          <MentionSpan
            text={mentionText}
            mentionId={mId}
            onRemove={onRemoveMention}
            className="bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]"
          />
        );
      }
      if (href?.startsWith('#fleex-panel:')) {
        const name = href.slice('#fleex-panel:'.length);
        const mentionText = `@${name}`;
        const mId = commentMentions?.get(mentionText);
        return (
          <MentionSpan
            text={mentionText}
            mentionId={mId}
            onRemove={onRemoveMention}
            className="bg-blue-500/15 text-blue-400"
          />
        );
      }
      if (href?.startsWith('#fleex-skill:')) {
        const name = href.slice('#fleex-skill:'.length);
        const mentionText = `@${name}`;
        const mId = commentMentions?.get(mentionText);
        return (
          <MentionSpan
            text={mentionText}
            mentionId={mId}
            onRemove={onRemoveMention}
            className="bg-emerald-500/15 text-emerald-400"
          />
        );
      }
      if (href?.startsWith('#fleex-human:')) {
        const name = href.slice('#fleex-human:'.length);
        const mentionText = `@${name}`;
        const mId = commentMentions?.get(mentionText);
        if (mId) {
          return (
            <MentionSpan
              text={mentionText}
              mentionId={mId}
              onRemove={onRemoveMention}
              className="bg-amber-500/15 text-amber-400"
            />
          );
        }
        // Not a tracked mention — render as plain text
        return <span>{children}</span>;
      }
      // Regular link
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--theme-accent)] underline underline-offset-2 hover:text-[var(--theme-accent-hover)] transition-colors break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </a>
      );
    },

    // ── Headings (slightly smaller than scratchpad — comments are denser) ────
    h1: ({ children }) => (
      <h1 className="text-base font-bold mt-3 mb-1 text-[var(--theme-text-primary)]">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-sm font-semibold mt-2 mb-0.5 text-[var(--theme-text-primary)]">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-sm font-medium mt-1.5 mb-0.5 text-[var(--theme-text-primary)]">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-xs font-medium mt-1.5 mb-0.5 text-[var(--theme-text-secondary)]">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-xs font-medium mt-1 text-[var(--theme-text-secondary)]">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-xs font-medium mt-1 text-[var(--theme-text-muted)]">{children}</h6>
    ),

    p: ({ children }) => (
      <p className="py-0.5 text-sm leading-relaxed text-[var(--theme-text-secondary)]">{children}</p>
    ),

    blockquote: ({ children }) => (
      <blockquote className="my-1 border-l-2 border-[var(--theme-accent)] pl-3 text-[var(--theme-text-secondary)] italic">
        {children}
      </blockquote>
    ),

    hr: () => <hr className="my-2 border-t border-[var(--theme-border)]" />,

    ul: ({ children, className }) => (
      <ul
        className={`my-1 ${
          className?.includes('contains-task-list') ? 'list-none pl-0' : 'list-disc pl-5'
        }`}
      >
        {children}
      </ul>
    ),
    ol: ({ children }) => <ol className="my-1 pl-5 list-decimal">{children}</ol>,
    li: ({ children }) => (
      <li className="py-0.5 text-sm leading-relaxed text-[var(--theme-text-secondary)] marker:text-[var(--theme-text-muted)]">
        {children}
      </li>
    ),

    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => (
      <del className="line-through text-[var(--theme-text-muted)]">{children}</del>
    ),

    // Inline code
    code: ({ children, className }) => {
      if (className?.includes('hljs')) {
        return <code className={className}>{children}</code>;
      }
      return (
        <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 font-mono text-xs text-[var(--theme-accent)]">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-1.5 overflow-x-auto rounded-md bg-[var(--theme-bg-overlay)] p-3 text-xs leading-relaxed font-mono">
        {children}
      </pre>
    ),

    // Tables
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-md border border-[var(--theme-border)]">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-[var(--theme-bg-overlay)]">{children}</thead>,
    tbody: ({ children }) => (
      <tbody className="divide-y divide-[var(--theme-border)]">{children}</tbody>
    ),
    tr: ({ children }) => <tr className="even:bg-[var(--theme-bg-hover)]">{children}</tr>,
    th: ({ children }) => (
      <th className="px-3 py-1.5 text-left text-xs font-semibold text-[var(--theme-text-primary)] border-r border-[var(--theme-border)] last:border-r-0 whitespace-nowrap">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] border-r border-[var(--theme-border)] last:border-r-0">
        {children}
      </td>
    ),

    // ── Images ───────────────────────────────────────────────────────────────
    img: ({ src, alt }) => {
      return <ImageThumbnail src={getProxiedImageSrc(src)} alt={alt ?? ''} />;
    },
  };

  return (
    <Markdown
      remarkPlugins={commentRemarkPlugins}
      rehypePlugins={commentRehypePlugins}
      components={components}
    >
      {processed}
    </Markdown>
  );
});

// ── Utilities ──

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Mention Autocomplete ──

interface MentionOption {
  /** The text inserted into the textarea (e.g. "@agent:catalyst" or "@olivier") */
  insertText: string;
  /** Display label shown in the dropdown */
  label: string;
  /** Secondary text (e.g. "agent" or "human") */
  type: 'agent' | 'human' | 'panel' | 'skill';
}

function MentionAutocomplete({
  options,
  selectedIndex,
  onSelect,
  position,
}: {
  options: MentionOption[];
  selectedIndex: number;
  onSelect: (opt: MentionOption) => void;
  position: { bottom: number; left: number };
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (options.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute z-30 max-h-48 min-w-[200px] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
      style={{ bottom: position.bottom, left: position.left }}
    >
      {options.map((opt, i) => (
        <button
          key={opt.insertText}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
            i === selectedIndex
              ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-text-primary)]'
              : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
          }`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(opt); }}
        >
          <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold ${
            opt.type === 'agent' ? 'bg-purple-500/20 text-purple-400' : opt.type === 'panel' ? 'bg-blue-500/20 text-blue-400' : opt.type === 'skill' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
          }`}>
            {opt.type === 'agent' ? 'A' : opt.type === 'panel' ? 'P' : opt.type === 'skill' ? 'S' : 'H'}
          </span>
          <span className="flex-1 truncate font-medium">{opt.label}</span>
          <span className="text-[10px] text-[var(--theme-text-faint)]">{opt.type}</span>
        </button>
      ))}
    </div>
  );
}

// ── Main Component ──

export function TicketComments({ ticketId }: { ticketId: string }) {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const { draft: body, setDraft: setBody, clearDraft } = useCommentDraft(ticketId);
  const [modalExecutionId, setModalExecutionId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autocomplete state
  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acIndex, setAcIndex] = useState(0);
  const [acTriggerPos, setAcTriggerPos] = useState(-1); // cursor position of the '@'
  const inputWrapperRef = useRef<HTMLDivElement>(null);

  // Execution mode toggle (Talk / Plan / Edit)
  // Default to the most recent user-created mention's mode, or 'plan' if none
  const [executionMode, setExecutionMode] = useState<'talk' | 'plan' | 'edit'>('plan');
  const modeInitialised = useRef(false);

  const commentFileUpload = useFileUpload({
    textareaRef,
    value: body,
    onChange: setBody,
  });

  // Build mention options from personas + panels + skills + human
  const personas = useAgentPersonaStore((s) => s.personas);
  const panels = usePanelStore((s) => s.panels);
  const panelsLoaded = usePanelStore((s) => s.loaded);
  const loadPanels = usePanelStore((s) => s.loadPanels);
  const skills = useSkillStore((s) => s.skills);
  const skillsLoaded = useSkillStore((s) => s.loaded);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const humanMentionName = useSettingsStore(
    (s) => (s.settings as unknown as Record<string, unknown>)['humanMentionName'] as string | undefined,
  );

  useEffect(() => {
    if (!panelsLoaded) loadPanels();
    if (!skillsLoaded) loadSkills();
  }, [panelsLoaded, loadPanels, skillsLoaded, loadSkills]);

  // Agent "is working" indicator
  const executionsByTicket = useAgentEventStore((s) => s.executionsByTicket);
  const loadExecutionsForTicket = useAgentEventStore((s) => s.loadExecutionsForTicket);
  const subscribeTicket = useAgentEventStore((s) => s.subscribeTicket);
  const unsubscribeTicket = useAgentEventStore((s) => s.unsubscribeTicket);

  useEffect(() => {
    loadExecutionsForTicket(ticketId);
    subscribeTicket(ticketId);
    return () => { unsubscribeTicket(ticketId); };
  }, [ticketId, loadExecutionsForTicket, subscribeTicket, unsubscribeTicket]);

  const runningAgents = useMemo(() => {
    const execs = executionsByTicket[ticketId] ?? [];
    return execs
      .filter((e) => e.status === 'running')
      .map((e) => {
        const persona = personas.find((p) => p.id === e.personaId);
        return { name: persona?.displayName || persona?.name || 'Agent', executionId: e.id };
      });
  }, [executionsByTicket, ticketId, personas]);

  const waitingAgents = useMemo(() => {
    return mentions
      .filter((m) => m.status === 'waiting_for_info' && m.targetType === 'agent')
      .map((m) => {
        const persona = personas.find((p) => p.name === m.targetAgent);
        return { name: persona?.displayName || persona?.name || m.targetAgent, mentionId: m.id, mode: m.executionMode };
      });
  }, [mentions, personas]);

  const allMentionOptions = useMemo<MentionOption[]>(() => {
    const opts: MentionOption[] = personas.map((p) => ({
      insertText: `@agent:${p.name}`,
      label: p.displayName || p.name,
      type: 'agent' as const,
    }));
    for (const panel of panels) {
      if (panel.enabled) {
        opts.push({
          insertText: `@panel:${panel.name}`,
          label: panel.displayName || panel.name,
          type: 'panel' as const,
        });
      }
    }
    for (const skill of skills) {
      if (skill.enabled) {
        opts.push({
          insertText: `@skill:${skill.commandName}`,
          label: skill.displayName || skill.commandName,
          type: 'skill' as const,
        });
      }
    }
    if (humanMentionName) {
      opts.push({
        insertText: `@${humanMentionName}`,
        label: humanMentionName,
        type: 'human' as const,
      });
    }
    return opts;
  }, [personas, panels, skills, humanMentionName]);

  const filteredOptions = useMemo(() => {
    if (!acOpen) return [];
    const q = acQuery.toLowerCase();
    return allMentionOptions.filter((o) =>
      o.label.toLowerCase().includes(q) || o.insertText.toLowerCase().includes(q),
    );
  }, [acOpen, acQuery, allMentionOptions]);

  // Read cursor for "new messages" line
  const loadCursors = useUnreadStore((s) => s.loadCursors);
  const markCommentsRead = useUnreadStore((s) => s.markCommentsRead);
  const cursorsByTicket = useUnreadStore((s) => s.cursorsByTicket);
  const commentLastSeenAt = cursorsByTicket[ticketId]?.commentLastSeenAt ?? null;
  const listContainerRef = useRef<HTMLDivElement>(null);
  // When user option+clicks to pin cursor, suppress auto-mark-read
  const cursorPinnedRef = useRef(false);

  useEffect(() => {
    modeInitialised.current = false;
    api.fetchTicketComments(ticketId).then(setComments).catch(() => {});
    api.fetchTicketMentions(ticketId).then((fetched) => {
      setMentions(fetched);
      // Initialise mode selector to the most recent mention's mode
      if (!modeInitialised.current && fetched.length > 0) {
        const sorted = [...fetched].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setExecutionMode(sorted[0]!.executionMode);
        modeInitialised.current = true;
      }
    }).catch(() => {});
    loadCursors(ticketId).catch(() => {});
  }, [ticketId, loadCursors]);

  const mentionLookup = useMemo(() => buildMentionLookup(mentions), [mentions]);

  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      try {
        const msg = raw as TicketWsMessage;
        if (msg.type === 'comment:created') {
          const comment = msg.data as TicketComment;
          if (comment.ticketId === ticketId) {
            setComments((prev) => {
              if (prev.some((c) => c.id === comment.id)) return prev;
              return [...prev, comment];
            });
          }
        } else if (msg.type === 'comment:updated') {
          const comment = msg.data as TicketComment;
          if (comment.ticketId === ticketId) {
            setComments((prev) => prev.map((c) => (c.id === comment.id ? comment : c)));
          }
        } else if (msg.type === 'mention:created') {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => {
              if (prev.some((x) => x.id === m.id)) return prev;
              return [...prev, m];
            });
          }
        } else if (msg.type === 'comment:deleted') {
          const d = msg.data as { id: string; ticketId: string };
          if (d.ticketId === ticketId) {
            setComments((prev) => prev.filter((c) => c.id !== d.id));
          }
        } else if (msg.type === 'mention:deleted') {
          const d = msg.data as { id: string; ticketId: string };
          if (d.ticketId === ticketId) {
            setMentions((prev) => prev.filter((x) => x.id !== d.id));
          }
        } else if (msg.type === 'mention:updated' || msg.type === 'mention:acknowledged' || msg.type === 'mention:resolved' || msg.type === 'mention:waiting_for_info') {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => prev.map((x) => (x.id === m.id ? m : x)));
            // Fallback: if execution_end was missed (WS reconnect, etc.), reconcile on mention resolution
            if (msg.type === 'mention:resolved') {
              useAgentEventStore.getState().reconcileOnMentionResolved(m.ticketId, m.id);
            }
          }
        }
      } catch {
        // ignore
      }
    });
    return unsub;
  }, [ticketId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [comments.length]);

  // Auto-mark comments as read when scrolled to the bottom.
  // Skipped when the cursor is pinned (user option+clicked to set a manual cursor).
  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (cursorPinnedRef.current) return; // user pinned the cursor, don't auto-advance
        if (entry?.isIntersecting && comments.length > 0) {
          const lastComment = comments[comments.length - 1];
          if (lastComment && (!commentLastSeenAt || lastComment.createdAt > commentLastSeenAt)) {
            markCommentsRead(ticketId, lastComment.createdAt).catch(() => {});
          }
        }
      },
      { root: container.parentElement, threshold: 0.5 },
    );
    const sentinel = listEndRef.current;
    if (sentinel) observer.observe(sentinel);
    return () => observer.disconnect();
  }, [comments, commentLastSeenAt, ticketId, markCommentsRead]);

  // Reset pin when navigating to a different ticket
  useEffect(() => {
    cursorPinnedRef.current = false;
  }, [ticketId]);

  // Option+click (Alt+click) on a comment to pin read cursor just before that comment
  const handleCommentClick = useCallback((e: React.MouseEvent, comment: TicketComment) => {
    if (e.altKey) {
      e.preventDefault();
      cursorPinnedRef.current = true; // prevent auto-mark from overriding
      // Set cursor to the previous comment's timestamp so the "new messages" line appears above the clicked one
      const idx = comments.findIndex((c) => c.id === comment.id);
      const cursorTimestamp = idx > 0 ? comments[idx - 1]!.createdAt : new Date(0).toISOString();
      markCommentsRead(ticketId, cursorTimestamp).catch(() => {});
    }
  }, [ticketId, markCommentsRead, comments]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    try {
      await api.deleteTicketComment(ticketId, commentId);
      // WS comment:deleted will update the list; optimistically remove too
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      // ignore — comment stays visible on failure
    }
  }, [ticketId]);

  const handleRemoveMention = useCallback(async (mentionId: string) => {
    try {
      await api.deleteMentionFromComment(mentionId);
    } catch {
      // ignore
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      const comment = await api.postTicketComment(ticketId, trimmed, executionMode);
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
      // Posting a comment means we're caught up — mark everything as read
      markCommentsRead(ticketId, comment.createdAt).catch(() => {});
      clearDraft();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch {
      // keep body so user can retry
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }, [body, submitting, ticketId, executionMode, markCommentsRead, clearDraft]);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  const closeMentionAc = useCallback(() => {
    setAcOpen(false);
    setAcQuery('');
    setAcIndex(0);
    setAcTriggerPos(-1);
  }, []);

  const acceptMention = useCallback((opt: MentionOption) => {
    const ta = textareaRef.current;
    if (!ta || acTriggerPos < 0) return;
    // Replace from '@' trigger to current cursor with the insert text + trailing space
    const before = body.slice(0, acTriggerPos);
    const after = body.slice(ta.selectionStart);
    const newBody = before + opt.insertText + ' ' + after;
    setBody(newBody);
    closeMentionAc();
    // Restore cursor position after React re-render
    const newCursor = acTriggerPos + opt.insertText.length + 1;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    });
  }, [body, acTriggerPos, closeMentionAc]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart;
    setBody(val);
    autoResize();

    // Detect mention trigger: scan backwards from cursor for '@'
    const textBeforeCursor = val.slice(0, cursor);
    // Find the last '@' that's either at the start or preceded by whitespace
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]!))) {
      const fragment = textBeforeCursor.slice(atIdx + 1);
      // Only trigger if there's no space after the @ (user is still typing the name)
      if (!/\s/.test(fragment)) {
        setAcOpen(true);
        setAcTriggerPos(atIdx);
        // Strip "agent:" prefix for filtering so typing "@agent:cat" matches "catalyst"
        const q = fragment.replace(/^(agent|panel|skill):/, '');
        setAcQuery(q);
        setAcIndex(0);
        return;
      }
    }
    closeMentionAc();
  }, [autoResize, closeMentionAc]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Autocomplete navigation
      if (acOpen && filteredOptions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setAcIndex((i) => (i + 1) % filteredOptions.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setAcIndex((i) => (i - 1 + filteredOptions.length) % filteredOptions.length);
          return;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          acceptMention(filteredOptions[acIndex]!);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMentionAc();
          return;
        }
      }
      // Execution mode toggle: Ctrl+1/2/3
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.key === '1') { e.preventDefault(); setExecutionMode('talk'); return; }
        if (e.key === '2') { e.preventDefault(); setExecutionMode('plan'); return; }
        if (e.key === '3') { e.preventDefault(); setExecutionMode('edit'); return; }
      }
      // Normal submit: Enter without shift
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [acOpen, filteredOptions, acIndex, acceptMention, closeMentionAc, handleSubmit],
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* Comment list */}
      <div className="flex-1 overflow-y-auto" ref={listContainerRef}>
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-[var(--theme-text-muted)]">No comments yet</p>
            <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
              Use <span className="font-mono text-[var(--theme-accent)]">@agent:name</span> to mention an agent
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--theme-border)]/50">
            {comments.map((c, idx) => {
              // Show "New messages" divider before the first unseen comment
              const prevComment = idx > 0 ? comments[idx - 1] : null;
              const showNewLine = commentLastSeenAt != null
                && c.createdAt > commentLastSeenAt
                && (prevComment == null || prevComment.createdAt <= commentLastSeenAt);

              return (
                <div key={c.id}>
                  {showNewLine && (
                    <div className="flex items-center gap-2 px-1 py-2">
                      <div className="h-px flex-1 bg-red-500/60" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">New messages</span>
                      <div className="h-px flex-1 bg-red-500/60" />
                    </div>
                  )}
                  <div className="group relative px-1 py-3 first:pt-0" onClick={(e) => handleCommentClick(e, c)}>
                {/* Header: author + timestamp */}
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      c.authorType === 'agent' ? 'text-purple-400' : 'text-blue-400'
                    }`}
                  >
                    {c.authorName}
                  </span>
                  <span className="text-[10px] text-[var(--theme-text-faint)]">
                    {c.authorType === 'agent' ? 'agent' : 'you'}
                  </span>
                  <span className="text-[10px] text-[var(--theme-text-faint)]">
                    {relativeTime(c.createdAt)}
                  </span>
                </div>
                {/* Body — rendered as markdown */}
                <CommentMarkdown
                  body={c.body}
                  commentId={c.id}
                  mentionLookup={mentionLookup}
                  onRemoveMention={handleRemoveMention}
                />
                {/* Delete button — all comments */}
                <button
                    className="absolute right-2 top-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/20 text-[var(--theme-text-faint)] hover:text-red-400"
                    onClick={() => handleDeleteComment(c.id)}
                    title="Delete comment"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
              </div>
                </div>
              );
            })}
            {runningAgents.map((agent) => (
              <button
                key={agent.executionId}
                className="flex w-full items-center gap-2 px-1 py-3 text-left transition-colors hover:bg-[var(--theme-bg-hover)] rounded"
                onClick={() => { setModalTitle(`${agent.name} execution`); setModalExecutionId(agent.executionId); }}
              >
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                </span>
                <span className="text-xs text-purple-400">
                  {agent.name} is working…
                </span>
                <svg className="h-3 w-3 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
            ))}
            {waitingAgents.map((agent) => (
              <div
                key={agent.mentionId}
                className="flex w-full items-center gap-2 px-1 py-3"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
                <span className="text-xs text-orange-400">
                  {agent.name} is waiting for your reply…
                </span>
                <span className="rounded bg-orange-400/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-400">
                  {agent.mode}
                </span>
              </div>
            ))}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div ref={inputWrapperRef} className="relative flex flex-shrink-0 items-end gap-2 border-t border-[var(--theme-border)] pt-3" {...commentFileUpload.dragProps}>
        {/* Mention autocomplete popup */}
        {acOpen && filteredOptions.length > 0 && (
          <MentionAutocomplete
            options={filteredOptions}
            selectedIndex={acIndex}
            onSelect={acceptMention}
            position={{ bottom: (textareaRef.current?.offsetHeight ?? 36) + 8, left: 0 }}
          />
        )}
        <textarea
          ref={textareaRef}
          className={`max-h-40 min-h-[36px] flex-1 resize-none overflow-y-auto rounded-lg border bg-[var(--theme-bg-surface)] px-3 py-2 text-sm leading-snug text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none ${
            commentFileUpload.isDragOver
              ? 'border-[var(--theme-accent)] ring-2 ring-[var(--theme-accent)]/30'
              : 'border-[var(--theme-border)]'
          }`}
          rows={1}
          placeholder="Write a comment... (@ to mention)"
          value={body}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={commentFileUpload.pasteHandler}
          onBlur={() => { setTimeout(closeMentionAc, 150); }}
          disabled={submitting}
        />
        {/* Execution mode toggle [Talk|Plan|Edit] */}
        <div className="flex h-[36px] flex-shrink-0 items-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] overflow-hidden">
          {(['talk', 'plan', 'edit'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setExecutionMode(mode)}
              title={`${mode.charAt(0).toUpperCase() + mode.slice(1)} mode (Ctrl+${{ talk: '1', plan: '2', edit: '3' }[mode]})`}
              className={`flex h-full items-center justify-center px-1.5 transition-colors ${
                executionMode === mode
                  ? 'bg-[var(--theme-accent)]/20 text-[var(--theme-accent)]'
                  : 'text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]'
              }`}
            >
              {mode === 'talk' && (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              )}
              {mode === 'plan' && (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              )}
              {mode === 'edit' && (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-lg text-[var(--theme-text-muted)] transition-opacity hover:text-[var(--theme-accent)] hover:opacity-90"
          onClick={commentFileUpload.openFilePicker}
          title="Attach file"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <button
          className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--theme-accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-30"
          onClick={handleSubmit}
          disabled={submitting || !body.trim()}
          title="Send (Enter)"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </div>

      {/* Floating execution panel */}
      {modalExecutionId && (
        <FloatingExecutionPanel
          executionId={modalExecutionId}
          title={modalTitle}
          onClose={() => setModalExecutionId(null)}
        />
      )}
    </div>
  );
}
