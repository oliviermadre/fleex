import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react';
import type { TicketComment, TicketDeliverable, TicketMention, TicketWsMessage, ConversationMode, EffortLevel, StepRun, WorkflowStep, WorkflowRun } from '@fleex/shared';
import { EFFORT_LEVELS } from '@fleex/shared';
import { tint, tintText, tintClasses } from '../../lib/tints';
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
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useWorkflowRunStore, ACTIVE_STATUSES } from '../../stores/workflowRunStore';
import { HumanGateResolvePanel } from '../workflows/HumanGateResolvePanel';
import { ModelSelect } from '../agents/ModelSelect';
import { useTicketStore } from '../../stores/ticketStore';
import { useModels } from '../../hooks/useModels';
import { useStickToBottom } from '../../hooks/useStickToBottom';
import { FloatingExecutionPanel } from './ExecutionModal';
import { useUnreadStore } from '../../stores/unreadStore';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { MentionTypeBadge } from '../ui/MentionTypeBadge';
import * as api from '../../services/api';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useCommentDraft } from '../../hooks/useCommentDraft';
import { ImageGalleryStrip, ImagePlaceholder, extractMarkdownImages } from '../shared/ImageThumbnail';
import { MermaidDiagram, isMermaidCode, codeNodeToString } from '../shared/MermaidDiagram';
import { useColorMode } from '../../hooks/useActiveTheme';
import { preprocessMentions, TICKET_MENTION_HREF_PREFIX } from '../markdown/mentions';
import { TicketMentionChip } from '../markdown/TicketMentionChip';

/** Per-mode color for the conversation execution-mode pill. */
const MODE_PILL_CLASS: Record<ConversationMode, string> = {
  talk: tint('teal'),
  plan: tint('purple'),
  edit: tint('green'),
};

/**
 * Small filled info icon that surfaces an explanatory tooltip on hover/focus.
 * Used next to the execution-bar labels (Mode / Model) to clarify what each
 * control does. Uses a custom CSS tooltip (not the native `title`) so it appears
 * instantly instead of after the browser's ~1s delay.
 */
function InfoHint({ text }: { text: string }) {
  return (
    <span className="group/info relative inline-flex">
      <span
        tabIndex={0}
        role="button"
        aria-label={text}
        className="inline-flex cursor-help items-center text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-secondary)] focus:outline-none focus-visible:text-[var(--theme-text-secondary)]"
      >
        <svg className="h-[15px] w-[15px]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9zm1-4.25a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 w-72 max-w-[18rem] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-[var(--theme-text-primary)] opacity-0 shadow-lg transition-opacity duration-75 group-hover/info:opacity-100 group-focus-within/info:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

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

/**
 * Extract the agent names mentioned in a comment body (`@agent:name`),
 * mirroring the server parser: struck-through mentions (`~~@agent:name~~`)
 * are ignored, since they're treated as cancelled.
 */
function parseAgentMentions(body: string): string[] {
  const withoutStruck = body.replace(/~~[\s\S]*?~~/g, '');
  const names = new Set<string>();
  for (const match of withoutStruck.matchAll(/@agent:([a-zA-Z0-9_-]+)/g)) {
    names.add(match[1]!);
  }
  return [...names];
}

// ── Mention pre-processing ──
// `preprocessMentions` lives in ../markdown/mentions (shared with the generic
// MarkdownRenderer, which uses the ticket-only variant). It now also encodes
// @ticket:<id> mentions, handled below in the `a` override via #fleex-ticket:.

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
          className={`ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/mention:opacity-100 ${tintClasses('red').hoverBg}`}
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

// ── Deliverable attachment chip ──

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text.trim());
}

function deliverableTypeLabel(type: string): string {
  switch (type) {
    case 'prd': return 'PRD';
    case 'spec': return 'SPEC';
    case 'url': return 'URL';
    case 'pr': return 'PR';
    case 'plan': return 'PLAN';
    default: return type.toUpperCase().slice(0, 4);
  }
}

/**
 * Gmail-style attachment chip materialising a deliverable linked to a comment
 * (via its mention's resolvedDeliverableId). Clicking opens the same overlay as
 * the Deliverables tab.
 */
function DeliverableChip({ deliverable, onOpen }: {
  deliverable: TicketDeliverable;
  onOpen: (d: TicketDeliverable) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(deliverable); }}
      title={deliverable.title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
    >
      <span className="flex-shrink-0 rounded bg-[var(--theme-accent)]/15 px-1 py-0.5 text-[10px] font-bold tracking-wider text-[var(--theme-accent)]">
        {deliverableTypeLabel(deliverable.type)}
      </span>
      <span className="truncate font-medium text-[var(--theme-text-primary)]">{deliverable.title}</span>
      {isUrl(deliverable.content) ? (
        <svg className="h-3 w-3 flex-shrink-0 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      ) : (
        <svg className="h-3 w-3 flex-shrink-0 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
    </button>
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
  const colorMode = useColorMode();

  // Normalize literal \n escape sequences from agent output, then encode mentions
  const normalized = body.replace(/\\n/g, '\n');

  // Extract images before markdown processing — they become a gallery strip + inline placeholders
  const { images, cleaned } = useMemo(() => extractMarkdownImages(normalized), [normalized]);

  const processed = preprocessMentions(cleaned);

  const components: Components = {
    // ── Mentions & links ─────────────────────────────────────────────────────
    a: ({ href, children }) => {
      // Image placeholder — clickable pill that opens lightbox
      if (href?.startsWith('#fleex-img:')) {
        const idx = parseInt(href.slice('#fleex-img:'.length), 10);
        const img = images[idx];
        if (img) {
          return <ImagePlaceholder src={img.src} alt={img.alt} index={idx} />;
        }
      }
      if (href?.startsWith('#fleex-struck:')) {
        // Struck-through mention (removed/resolved)
        return (
          <span className="rounded-sm px-1 py-px text-[var(--theme-text-faint)] line-through opacity-60">
            {children}
          </span>
        );
      }
      if (href?.startsWith(TICKET_MENTION_HREF_PREFIX)) {
        // Ticket reference — purely referential chip, navigates to the ticket.
        return <TicketMentionChip idRef={href.slice(TICKET_MENTION_HREF_PREFIX.length)} />;
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
            className={tint('blue')}
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
            className={tint('green')}
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
              className={tint('yellow')}
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
      if (isMermaidCode(className)) {
        return <MermaidDiagram code={codeNodeToString(children)} colorMode={colorMode} />;
      }
      if (className?.includes('hljs')) {
        return <code className={className}>{children}</code>;
      }
      return (
        <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 font-mono text-xs text-[var(--theme-accent)]">
          {children}
        </code>
      );
    },
    pre: ({ children, node }) => {
      // Mermaid blocks render a block-level diagram — don't wrap in <pre>.
      const firstChild = node?.children?.[0];
      const codeClass =
        firstChild?.type === 'element' ? firstChild.properties?.className : undefined;
      if (isMermaidCode(Array.isArray(codeClass) ? codeClass.join(' ') : String(codeClass ?? ''))) {
        return <>{children}</>;
      }
      return (
        <pre className="my-1.5 overflow-x-auto rounded-md bg-[var(--theme-bg-overlay)] p-3 text-xs leading-relaxed font-mono">
          {children}
        </pre>
      );
    },

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

  };

  return (
    <>
      <ImageGalleryStrip images={images} />
      <Markdown
        remarkPlugins={commentRemarkPlugins}
        rehypePlugins={commentRehypePlugins}
        components={components}
      >
        {processed}
      </Markdown>
    </>
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
  type: 'agent' | 'human' | 'panel' | 'skill' | 'workflow' | 'ticket';
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
          <MentionTypeBadge type={opt.type} />
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
  const [deliverables, setDeliverables] = useState<TicketDeliverable[]>([]);
  const { draft: body, setDraft: setBody, clearDraft } = useCommentDraft(ticketId);
  const [modalExecutionId, setModalExecutionId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // When the user mentions an agent that already has an unresolved mention, we
  // hold the comment and ask how to proceed. Two kinds of ambiguity:
  //  - 'busy'    : agent has a queued/in-flight run → supersede vs queue.
  //  - 'waiting' : agent is waiting_for_info → is this the answer, or a new subject?
  const [conflictModal, setConflictModal] = useState<
    | { kind: 'busy'; agents: Array<{ agent: string; displayName: string; status: TicketMention['status'] }> }
    | { kind: 'waiting'; agents: Array<{ agent: string; displayName: string }> }
    | null
  >(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autocomplete state
  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acIndex, setAcIndex] = useState(0);
  const [acTriggerPos, setAcTriggerPos] = useState(-1); // cursor position of the '@'
  const inputWrapperRef = useRef<HTMLDivElement>(null);

  // Conversation-scoped execution config lives on the ticket (persisted server
  // side, synced via the ticket:updated WS broadcast). The composer reads it
  // from the ticket store — it is NO LONGER initialised from the latest mention
  // (that was the "mode changes by itself" bug). Changing any control PATCHes
  // /execution-config and sends no message.
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));
  const { models } = useModels();
  const executionMode: ConversationMode = ticket?.conversationMode ?? 'plan';
  const modelOverride: string | null = ticket?.modelOverride ?? null;
  const effortOverride: EffortLevel | null = ticket?.effortOverride ?? null;
  const fastMode: boolean = ticket?.fastMode ?? false;

  // The model whose capabilities drive the Effort/Fast controls. In "Auto"
  // (no override) we can't know which persona will run, so we hide those
  // controls — they degrade cleanly and only appear for an explicit, capable
  // model override.
  const overriddenModel = useMemo(
    () => (modelOverride ? models.find((m) => m.id === modelOverride) : undefined),
    [models, modelOverride],
  );
  const showEffort = overriddenModel?.supportsEffort === true;
  const showFast = overriddenModel?.supportsFastMode === true;

  const patchExecConfig = useCallback(
    (req: import('@fleex/shared').UpdateTicketExecutionConfigRequest) => {
      void api.updateTicketExecutionConfig(ticketId, req).catch(() => {});
    },
    [ticketId],
  );

  const cycleMode = useCallback(() => {
    const order: ConversationMode[] = ['talk', 'plan', 'edit'];
    const next = order[(order.indexOf(executionMode) + 1) % order.length]!;
    patchExecConfig({ conversationMode: next });
  }, [executionMode, patchExecConfig]);

  const setExecutionMode = useCallback(
    (mode: ConversationMode) => patchExecConfig({ conversationMode: mode }),
    [patchExecConfig],
  );

  const commentFileUpload = useFileUpload({
    textareaRef,
    value: body,
    onChange: setBody,
  });

  // Build mention options from personas + panels + skills + workflows + human
  const personas = useAgentPersonaStore((s) => s.personas);
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
  // All loaded tickets — powers the @ticket: autocomplete (filtered client-side).
  const allTickets = useTicketStore((s) => s.tickets);

  useEffect(() => {
    if (!panelsLoaded) loadPanels();
    if (!skillsLoaded) loadSkills();
    // No `loaded` flag on the workflow template store, so we just fetch once
    // when the comments mount. Cheap and avoids stale autocomplete data after
    // creating a new workflow elsewhere in the session.
    if (workflowTemplates.length === 0) void refreshWorkflowTemplates();
  }, [panelsLoaded, loadPanels, skillsLoaded, loadSkills, workflowTemplates.length, refreshWorkflowTemplates]);

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
    for (const wf of workflowTemplates) {
      if (wf.enabled) {
        opts.push({
          insertText: `@workflow:${wf.slug}`,
          label: wf.emoji ? `${wf.emoji} ${wf.name}` : wf.name,
          type: 'workflow' as const,
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
    for (const t of allTickets) {
      opts.push({
        insertText: `@ticket:${t.displayId}`,
        label: `#${t.displayId} ${t.title}`,
        type: 'ticket' as const,
      });
    }
    return opts;
  }, [personas, panels, skills, workflowTemplates, humanMentionName, allTickets]);

  // Max ticket suggestions shown at once — tickets can be numerous, so we surface
  // them only once the user has typed a query and cap the list to stay usable.
  const MAX_TICKET_SUGGESTIONS = 8;

  const filteredOptions = useMemo(() => {
    if (!acOpen) return [];
    const q = acQuery.toLowerCase();
    const matches = (o: MentionOption) =>
      o.label.toLowerCase().includes(q) || o.insertText.toLowerCase().includes(q);
    const nonTicket = allMentionOptions.filter((o) => o.type !== 'ticket' && matches(o));
    // Bare "@" (empty query) would otherwise dump every ticket into the dropdown.
    if (q.length === 0) return nonTicket;
    const tickets = allMentionOptions
      .filter((o) => o.type === 'ticket' && matches(o))
      .slice(0, MAX_TICKET_SUGGESTIONS);
    return [...nonTicket, ...tickets];
  }, [acOpen, acQuery, allMentionOptions]);

  // Deliverable overlay opening (chips linked to comments via mentions)
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const floatingDeliverableIds = useUIStore((s) => s.floatingDeliverableIds);
  const bringDeliverableToFront = useUIStore((s) => s.bringDeliverableToFront);
  const seenDeliverables = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]);
  const toggleDeliverableSeen = useUnreadStore((s) => s.toggleDeliverableSeen);

  const handleOpenDeliverable = useCallback((d: TicketDeliverable) => {
    if (!seenDeliverables?.has(d.id)) {
      toggleDeliverableSeen(ticketId, d.id, true).catch(() => {});
    }
    if (isUrl(d.content)) {
      window.open(d.content.trim(), '_blank', 'noopener');
    } else if (floatingDeliverableIds.includes(d.id)) {
      bringDeliverableToFront(d.id);
    } else {
      openDeliverableOverlay(d);
    }
  }, [ticketId, seenDeliverables, toggleDeliverableSeen, floatingDeliverableIds, bringDeliverableToFront, openDeliverableOverlay]);

  // Map each comment (the agent's resolved/result comment) to its linked deliverables.
  // Two link paths are unioned so chips appear regardless of what produced the comment:
  //   1. mention.resolvedCommentId ← mention.resolvedDeliverableId (persona/@-mention flow).
  //   2. execution.commentId ← execution.deliverableId (explicit FK, covers ALL sources:
  //      workflow steps, panels, skills — which never populate a mention). This replaces the
  //      old agentName pattern-matching, so a Human Gate draft's deliverable chip shows up too.
  const deliverablesByComment = useMemo(() => {
    const deliverableById = new Map(deliverables.map((d) => [d.id, d]));
    const map = new Map<string, TicketDeliverable[]>();
    const addLink = (commentId: string, d: TicketDeliverable) => {
      const arr = map.get(commentId);
      if (!arr) { map.set(commentId, [d]); return; }
      if (!arr.some((x) => x.id === d.id)) arr.push(d); // dedup: both paths can name the same pair
    };
    for (const m of mentions) {
      if (!m.resolvedCommentId || !m.resolvedDeliverableId) continue;
      const d = deliverableById.get(m.resolvedDeliverableId);
      if (d) addLink(m.resolvedCommentId, d);
    }
    for (const e of executionsByTicket[ticketId] ?? []) {
      if (!e.commentId || !e.deliverableId) continue;
      const d = deliverableById.get(e.deliverableId);
      if (d) addLink(e.commentId, d);
    }
    return map;
  }, [deliverables, mentions, executionsByTicket, ticketId]);

  // ── Inline Human Gate card (B.2 / B.3) ──────────────────────────────────────
  // Surface a workflow's Human Gate directly in the Comments thread so an
  // approve/reject decision no longer requires a detour to the Workflow tab.
  // Subscribe to the RAW per-ticket runs array (store helpers return fresh arrays
  // and would break Zustand's equality check → render loop). The parent
  // (TicketDetail) already calls loadForTicket + wires workflow:* events into
  // applyEvent, so runsByTicket + detail stay fresh in real time.
  const workflowRuns = useWorkflowRunStore((s) => s.runsByTicket[ticketId]);
  const workflowDetail = useWorkflowRunStore((s) => s.detail);
  const loadWorkflowDetail = useWorkflowRunStore((s) => s.loadDetail);
  const resolveGate = useWorkflowRunStore((s) => s.resolveGate);

  // Ensure the step-run detail is loaded for every active run on this ticket.
  // Detection (like WorkflowRunView) reads step-run status, which lives in the
  // detail — not in the runs list. Once a run is in `detail`, applyEvent keeps it
  // fresh on later workflow:* events (that's what makes the card live-update).
  useEffect(() => {
    for (const r of workflowRuns ?? []) {
      if (ACTIVE_STATUSES.has(r.status)) void loadWorkflowDetail(r.id);
    }
    // workflowDetail intentionally excluded: loadWorkflowDetail writes to it, so
    // depending on it would re-fire this effect in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowRuns, loadWorkflowDetail]);

  interface GateCard {
    run: WorkflowRun;
    step: WorkflowStep;
    stepRun: StepRun;
    outcomes: string[];
    reviewDeliverables: TicketDeliverable[];
  }

  // One card per human_gate step run currently in `needs_review` (concurrent runs
  // ⇒ multiple cards). The deliverables "to review" are those produced by the
  // run's step executions, resolved via the explicit execution→deliverable FK
  // (executionsByTicket), most recent first — never via agentName matching.
  const gateCards = useMemo<GateCard[]>(() => {
    const cards: GateCard[] = [];
    const execById = new Map((executionsByTicket[ticketId] ?? []).map((e) => [e.id, e]));
    const deliverableById = new Map(deliverables.map((d) => [d.id, d]));
    for (const run of workflowRuns ?? []) {
      if (!ACTIVE_STATUSES.has(run.status)) continue;
      const d = workflowDetail[run.id];
      if (!d) continue;
      const stepById = new Map(run.templateSnapshot.steps.map((s) => [s.id, s]));

      // Deliverables produced anywhere in this run, most recent first, deduped.
      const orderedStepRuns = [...d.stepRuns].sort((a, b) => {
        const ta = a.completedAt ?? a.startedAt ?? a.createdAt;
        const tb = b.completedAt ?? b.startedAt ?? b.createdAt;
        return tb.localeCompare(ta);
      });
      const reviewDeliverables: TicketDeliverable[] = [];
      const seen = new Set<string>();
      for (const sr of orderedStepRuns) {
        if (!sr.executionId) continue;
        const exec = execById.get(sr.executionId);
        if (!exec?.deliverableId) continue;
        const del = deliverableById.get(exec.deliverableId);
        if (del && !seen.has(del.id)) { seen.add(del.id); reviewDeliverables.push(del); }
      }

      // Only the latest attempt of each step can be "awaiting" a decision.
      const latestPerStep = new Map<string, StepRun>();
      for (const sr of d.stepRuns) {
        const cur = latestPerStep.get(sr.stepId);
        if (!cur || sr.attempt > cur.attempt) latestPerStep.set(sr.stepId, sr);
      }
      for (const sr of latestPerStep.values()) {
        if (sr.status !== 'needs_review') continue;
        const step = stepById.get(sr.stepId);
        if (!step || step.executorType !== 'human_gate') continue;
        const outcomes = (sr.output?.schemaFields?.outcomes as string[] | undefined)
          ?? step.humanGateOutcomes ?? [];
        cards.push({ run, step, stepRun: sr, outcomes, reviewDeliverables });
      }
    }
    return cards;
  }, [workflowRuns, workflowDetail, executionsByTicket, ticketId, deliverables]);

  // Read cursor for "new messages" line
  const loadCursors = useUnreadStore((s) => s.loadCursors);
  const markCommentsRead = useUnreadStore((s) => s.markCommentsRead);
  const cursorsByTicket = useUnreadStore((s) => s.cursorsByTicket);
  const commentLastSeenAt = cursorsByTicket[ticketId]?.commentLastSeenAt ?? null;
  // Stick-to-bottom: follow new comments / "is working" indicators only when
  // already scrolled to the bottom. containerRef is the scrollable list element.
  const {
    containerRef: listContainerRef,
    scrollToBottom,
    maybeStick,
  } = useStickToBottom<HTMLDivElement>();
  // Set when the user posts a comment themselves → force scroll to bottom on next render.
  const forceScrollRef = useRef(false);
  // When user option+clicks to pin cursor, suppress auto-mark-read
  const cursorPinnedRef = useRef(false);

  useEffect(() => {
    api.fetchTicketComments(ticketId).then(setComments).catch(() => {});
    api.fetchTicketMentions(ticketId).then(setMentions).catch(() => {});
    api.fetchTicketDeliverables(ticketId).then(setDeliverables).catch(() => {});
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
        } else if (msg.type === 'deliverable:created') {
          const d = msg.data as TicketDeliverable;
          if (d.ticketId === ticketId) {
            setDeliverables((prev) => (prev.some((x) => x.id === d.id) ? prev : [...prev, d]));
          }
        } else if (msg.type === 'deliverable:updated') {
          const d = msg.data as TicketDeliverable;
          if (d.ticketId === ticketId) {
            setDeliverables((prev) => prev.map((x) => (x.id === d.id ? d : x)));
          }
        } else if (msg.type === 'deliverable:deleted') {
          const { deliverableId, ticketId: tid } = msg.data as { deliverableId: string; ticketId: string };
          if (tid === ticketId) {
            setDeliverables((prev) => prev.filter((x) => x.id !== deliverableId));
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

  // Follow new content (comments + "is working" / "waiting" indicators) only
  // when already at the bottom. Exception: when the user just posted, force a
  // scroll to the bottom so they immediately see their comment + the agent ack.
  useLayoutEffect(() => {
    if (forceScrollRef.current) {
      forceScrollRef.current = false;
      scrollToBottom();
    } else {
      maybeStick();
    }
  }, [comments.length, runningAgents.length, waitingAgents.length, scrollToBottom, maybeStick]);

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

  // Actually post the comment. `mentionConflicts` tells the server how to
  // handle agents that already have an unresolved mention on this ticket.
  const doPost = useCallback(async (mentionConflicts: api.MentionConflictResolution[]) => {
    const trimmed = body.trim();
    if (!trimmed) return;

    setSubmitting(true);
    try {
      // No per-message mode is sent: the effective mode/model/effort/fast are
      // resolved from the ticket's conversation-scoped config at acknowledge.
      const comment = await api.postTicketComment(
        ticketId,
        trimmed,
        undefined,
        mentionConflicts.length > 0 ? mentionConflicts : undefined,
      );
      // The user just posted: force the view to the bottom so they see their
      // comment and the agent's "is working" acknowledgement without scrolling.
      forceScrollRef.current = true;
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
  }, [body, ticketId, markCommentsRead, clearDraft]);

  const handleSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;

    // Detect re-mentions of an agent that already has an unresolved mention, and
    // disambiguate. A WAITING agent is ambiguous (answer vs new subject) → ask.
    // A pending/acknowledged agent (queued/in-flight run) → supersede vs queue.
    const mentioned = parseAgentMentions(trimmed);
    if (mentioned.length > 0) {
      const waiting: Array<{ agent: string; displayName: string }> = [];
      const busy: Array<{ agent: string; displayName: string; status: TicketMention['status'] }> = [];
      for (const agent of mentioned) {
        const unresolved = mentions.find(
          (m) => m.targetType === 'agent' && m.targetAgent === agent && m.status !== 'resolved',
        );
        if (!unresolved) continue;
        const persona = personas.find((p) => p.name === agent);
        const displayName = persona?.displayName || persona?.name || agent;
        if (unresolved.status === 'waiting_for_info') {
          waiting.push({ agent, displayName });
        } else if (unresolved.status === 'pending' || unresolved.status === 'acknowledged') {
          busy.push({ agent, displayName, status: unresolved.status });
        }
      }

      // Waiting takes priority: that's the ambiguity the user most needs to resolve.
      if (waiting.length > 0) {
        setConflictModal({ kind: 'waiting', agents: waiting });
        return;
      }
      if (busy.length > 0) {
        setConflictModal({ kind: 'busy', agents: busy });
        return;
      }
    }

    await doPost([]);
  }, [body, submitting, mentions, personas, doPost]);

  const confirmConflict = useCallback(async (action: api.MentionConflictAction) => {
    if (!conflictModal) return;
    const conflicts: api.MentionConflictResolution[] = conflictModal.agents.map(
      (a) => ({ agent: a.agent, action }),
    );
    setConflictModal(null);
    await doPost(conflicts);
  }, [conflictModal, doPost]);

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
        // Strip the type prefix for filtering so typing "@agent:cat" matches
        // "catalyst" and "@ticket:37" matches ticket #37 by displayId/title.
        const q = fragment.replace(/^(agent|panel|skill|workflow|ticket):/, '');
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
      // Execution mode cycle: Shift+Tab (Talk→Plan→Edit→Talk), à la Claude Code.
      if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        cycleMode();
        return;
      }
      // Execution mode toggle: Ctrl+1/2/3 (direct selection, conservés)
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
    [acOpen, filteredOptions, acIndex, acceptMention, closeMentionAc, handleSubmit, cycleMode, setExecutionMode],
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
                      <div className={`h-px flex-1 ${tintClasses('red').solid}`} />
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${tintClasses('red').text}`}>New messages</span>
                      <div className={`h-px flex-1 ${tintClasses('red').solid}`} />
                    </div>
                  )}
                  <div className="group relative px-1 py-3 first:pt-0" onClick={(e) => handleCommentClick(e, c)}>
                {/* Header: author + timestamp */}
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      c.authorType === 'agent' ? tintText('purple') : tintText('blue')
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
                {/* Linked deliverables — Gmail-style attachment chips */}
                {(() => {
                  const linked = deliverablesByComment.get(c.id);
                  if (!linked || linked.length === 0) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {linked.map((d) => (
                        <DeliverableChip key={d.id} deliverable={d} onOpen={handleOpenDeliverable} />
                      ))}
                    </div>
                  );
                })()}
                {/* Delete button — all comments */}
                <button
                    className={`absolute right-2 top-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 text-[var(--theme-text-faint)] ${tintClasses('red').hoverBg} ${tintClasses('red').hoverText}`}
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
                  <span className={`inline-block h-1.5 w-1.5 rounded-full animate-pulse ${tintClasses('purple').solid}`} />
                </span>
                <span className={`text-xs ${tintClasses('purple').text}`}>
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
                <span className={`inline-block h-1.5 w-1.5 rounded-full animate-pulse ${tintClasses('orange').solid}`} />
                <span className={`text-xs ${tintClasses('orange').text}`}>
                  {agent.name} is waiting for your reply…
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tint('orange')}`}>
                  {agent.mode}
                </span>
              </div>
            ))}
            {/* Inline Human Gate action card(s) — approve/reject without leaving Comments.
                The gate's own "🚪 Human Gate…" comment stays above as a trace. */}
            {gateCards.map(({ run, step, stepRun, outcomes, reviewDeliverables }) => (
              <div
                key={stepRun.id}
                className="my-3 rounded-lg border border-[var(--theme-accent)]/40 bg-[var(--theme-accent)]/5 p-3"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-base leading-none">🚪</span>
                  <div className="text-xs font-semibold text-[var(--theme-text-primary)]">
                    Human Gate — {run.templateSnapshot.emoji} {run.templateSnapshot.name}
                    <span className="font-normal text-[var(--theme-text-muted)]"> › {step.name}</span>
                  </div>
                </div>
                {reviewDeliverables.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">
                      To review
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {reviewDeliverables.map((d) => (
                        <DeliverableChip key={d.id} deliverable={d} onOpen={handleOpenDeliverable} />
                      ))}
                    </div>
                  </div>
                )}
                {outcomes.length > 0 ? (
                  <HumanGateResolvePanel
                    runId={run.id}
                    stepRunId={stepRun.id}
                    outcomes={outcomes}
                    onResolve={(outcome, notes) => resolveGate(run.id, stepRun.id, outcome, notes)}
                  />
                ) : (
                  // Degraded state (invalid config) — no orphan CTA; point to the Workflow tab.
                  <div className="text-xs text-[var(--theme-text-muted)]">
                    No outcomes configured — resolve this gate from the Workflow tab.
                  </div>
                )}
              </div>
            ))}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      {/* Composer: line 1 = input + attach + send, line 2 = execution bar */}
      <div className="flex flex-shrink-0 flex-col gap-2 border-t border-[var(--theme-border)] pt-3">
        {/* Line 1 — input + actions */}
        <div ref={inputWrapperRef} className="relative flex items-end gap-2" {...commentFileUpload.dragProps}>
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
            className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-30"
            onClick={handleSubmit}
            disabled={submitting || !body.trim()}
            title="Send (Enter)"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>

        {/* Line 2 — conversation execution bar (mode / model / effort / fast) */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Mode: single pill, cycles Talk→Plan→Edit on click (or Shift+Tab) */}
          <span className="flex items-center gap-1 text-[var(--theme-text-secondary)]">
            Mode :
            <InfoHint text="Le mode définit les droits de l'agent au prochain acknowledge : Talk = réponse sans outils, Plan = lecture seule, Edit = écriture (Write/Edit/Bash). Il appartient à la conversation et s'applique à la prochaine exécution, sans envoyer de message." />
          </span>
          <button
            type="button"
            onClick={cycleMode}
            title="Conversation mode — click or Shift+Tab to cycle (Ctrl+1/2/3 to set). Applies to the next agent acknowledge, sends no message."
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition-colors ${MODE_PILL_CLASS[executionMode]}`}
          >
            <span className="capitalize">{executionMode}</span>
            <span className="text-[10px] opacity-60">⇧⇥</span>
          </button>

          {/* Model override dropdown — default "Auto (persona)" */}
          <span className="ml-1 flex items-center gap-1 text-[var(--theme-text-secondary)]">
            Model :
            <InfoHint text="Le modèle utilisé pour la prochaine exécution de l'agent mentionné. Auto = chaque agent garde le modèle de sa config. Choisir un modèle ici est un override de conversation : il s'applique à la prochaine mention sans modifier la config de l'agent." />
          </span>
          <ModelSelect
            variant="inline"
            icon="🤖"
            value={modelOverride ?? ''}
            onChange={(v) => patchExecConfig({ modelOverride: v === '' ? null : v })}
            leadingOption={{ value: '', label: 'Auto (persona)' }}
            title="Model for the next agent run. Auto = inherit the agent's own model. An override applies to the next mention without changing the agent config."
            ariaLabel="Model override"
          />

          {/* Effort dropdown — shown only when the resolved model supports it */}
          {showEffort && (
            <label className="flex items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-[var(--theme-text-secondary)]">
              <span className="opacity-60">◐</span>
              <select
                value={effortOverride ?? ''}
                onChange={(e) => patchExecConfig({ effortOverride: e.target.value === '' ? null : (e.target.value as EffortLevel) })}
                title="Reasoning effort for the next agent run."
                className="cursor-pointer bg-transparent pr-1 text-xs text-[var(--theme-text-secondary)] focus:outline-none"
              >
                <option value="">Effort: default</option>
                {EFFORT_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>Effort: {lvl}</option>
                ))}
              </select>
            </label>
          )}

          {/* Fast toggle — shown only when the resolved model supports it */}
          {showFast && (
            <button
              type="button"
              onClick={() => patchExecConfig({ fastMode: !fastMode })}
              title="Fast (low-latency) mode for the next agent run."
              className={`flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition-colors ${
                fastMode
                  ? tint('yellow')
                  : 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]'
              }`}
            >
              <span>⚡</span>
              <span>Fast</span>
            </button>
          )}
        </div>
      </div>

      {/* Floating execution panel */}
      {modalExecutionId && (
        <FloatingExecutionPanel
          executionId={modalExecutionId}
          title={modalTitle}
          onClose={() => setModalExecutionId(null)}
        />
      )}

      {/* Mention conflict: agent waiting for a reply — answer vs new subject */}
      {conflictModal?.kind === 'waiting' && (
        <Modal open onClose={() => setConflictModal(null)} maxWidth="max-w-md">
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">
            {conflictModal.agents.map((a) => a.displayName).join(', ')} attend ta réponse
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-[var(--theme-text-secondary)]">
            Tu mentionnes un agent qui attend ta réponse à sa question. Ce message est&nbsp;:
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="primary" onClick={() => void confirmConflict('answer')}>
              Ma réponse à sa question
            </Button>
            <Button variant="secondary" onClick={() => void confirmConflict('new_subject')}>
              Un autre sujet à traiter
            </Button>
            <Button variant="ghost" onClick={() => setConflictModal(null)}>
              Annuler
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-[var(--theme-text-secondary)]">
            « Autre sujet » : l'agent continue d'attendre ta réponse (à donner dans un autre
            message) et ta nouvelle demande sera traitée ensuite.
          </p>
        </Modal>
      )}

      {/* Mention conflict: agent already has a queued/in-flight run here */}
      {conflictModal?.kind === 'busy' && (
        <Modal open onClose={() => setConflictModal(null)} maxWidth="max-w-md">
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">
            Agent déjà sollicité sur ce ticket
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-[var(--theme-text-secondary)]">
            {conflictModal.agents.map((c) => c.displayName).join(', ')}{' '}
            {conflictModal.agents.length > 1 ? 'ont' : 'a'} déjà une demande{' '}
            {conflictModal.agents.some((c) => c.status === 'acknowledged') ? 'en cours' : 'en file'}{' '}
            sur ce ticket. Deux exécutions en parallèle sur le même worktree se gêneraient.
            Comment veux-tu enchaîner&nbsp;?
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="primary" onClick={() => void confirmConflict('supersede')}>
              Arrêter l'exécution en cours et reprendre avec ce message
            </Button>
            <Button variant="secondary" onClick={() => void confirmConflict('queue')}>
              Laisser finir, puis enchaîner avec ce message
            </Button>
            <Button variant="ghost" onClick={() => setConflictModal(null)}>
              Annuler
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
