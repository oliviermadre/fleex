import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { TicketComment, TicketMention, TicketWsMessage } from '@asm/shared';
import { ticketWs } from '../../services/websocket';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import * as api from '../../services/api';

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
    const text = m.targetType === 'human' ? `@${m.targetAgent}` : `@agent:${m.targetAgent}`;
    map.set(text, m.id);
  }
  return lookup;
}

// ── Inline markdown + mention rendering ──

const MENTION_PATTERN = /(~~@agent:[a-zA-Z0-9_-]+~~|@agent:[a-zA-Z0-9_-]+|~~@[a-zA-Z0-9_-]+~~|@[a-zA-Z0-9_-]+)/;
const INLINE_MD = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\~\~[^~]+\~\~)/g;

/** Render inline markdown (bold, italic, code, strikethrough) for a plain text segment */
function renderInlineMd(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(INLINE_MD.source, 'g');

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`${keyPrefix}-t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const full = match[0];
    if (full.startsWith('`')) {
      nodes.push(
        <code key={`${keyPrefix}-c${match.index}`} className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 font-mono text-xs text-[var(--theme-accent)]">
          {full.slice(1, -1)}
        </code>,
      );
    } else if (full.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${match.index}`} className="font-semibold">{full.slice(2, -2)}</strong>);
    } else if (full.startsWith('*')) {
      nodes.push(<em key={`${keyPrefix}-i${match.index}`} className="italic">{full.slice(1, -1)}</em>);
    } else if (full.startsWith('~~')) {
      nodes.push(
        <span key={`${keyPrefix}-s${match.index}`} className="text-[var(--theme-text-muted)] line-through">{full.slice(2, -2)}</span>,
      );
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    nodes.push(<span key={`${keyPrefix}-t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return nodes.length > 0 ? nodes : [<span key={`${keyPrefix}-raw`}>{text}</span>];
}

/** Render a line's inline content with mentions + markdown */
function renderInlineWithMentions(
  text: string,
  keyPrefix: string,
  commentMentions: Map<string, string> | undefined,
  onRemoveMention: (id: string) => void,
): React.ReactNode[] {
  const parts = text.split(MENTION_PATTERN);
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!part) continue;
    const pk = `${keyPrefix}-${i}`;

    // Struck-through agent mention
    if (/^~~@agent:[a-zA-Z0-9_-]+~~$/.test(part)) {
      nodes.push(
        <span key={pk} className="rounded-sm px-1 py-px text-[var(--theme-text-faint)] line-through opacity-60">{part.slice(2, -2)}</span>,
      );
      continue;
    }
    // Active agent mention
    if (/^@agent:[a-zA-Z0-9_-]+$/.test(part)) {
      const mId = commentMentions?.get(part);
      nodes.push(
        <MentionSpan key={pk} text={part} mentionId={mId} onRemove={onRemoveMention} className="bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]" />,
      );
      continue;
    }
    // Struck-through human mention
    if (/^~~@[a-zA-Z0-9_-]+~~$/.test(part)) {
      nodes.push(
        <span key={pk} className="rounded-sm px-1 py-px text-[var(--theme-text-faint)] line-through opacity-60">{part.slice(2, -2)}</span>,
      );
      continue;
    }
    // Active human mention (only highlight if tracked)
    if (/^@[a-zA-Z0-9_-]+$/.test(part)) {
      const mId = commentMentions?.get(part);
      if (mId) {
        nodes.push(
          <MentionSpan key={pk} text={part} mentionId={mId} onRemove={onRemoveMention} className="bg-amber-500/15 text-amber-400" />,
        );
        continue;
      }
    }
    // Plain text segment → apply inline markdown
    nodes.push(...renderInlineMd(part, pk));
  }
  return nodes;
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

function CommentMarkdown({
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
  // Normalize literal \n sequences (common in agent output) to real newlines
  const normalized = body.replace(/\\n/g, '\n');
  const lines = normalized.split('\n');
  const elements: React.ReactNode[] = [];

  const inline = (text: string, kp: string) =>
    renderInlineWithMentions(text, kp, commentMentions, onRemoveMention);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const lk = `l${i}`;

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      elements.push(
        <pre key={lk} className="my-1.5 overflow-x-auto rounded-md bg-[var(--theme-bg-overlay)] p-3 text-xs leading-relaxed">
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      elements.push(<div key={lk} className="h-1.5" />);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      elements.push(<hr key={lk} className="my-2 border-t border-[var(--theme-border)]" />);
      i++;
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1]!.length;
      const sizes = ['text-base font-bold mt-3 mb-1', 'text-sm font-semibold mt-2 mb-0.5', 'text-sm font-medium mt-1.5 mb-0.5'];
      elements.push(
        <div key={lk} className={`${sizes[level - 1]} text-[var(--theme-text-primary)]`}>
          {inline(hMatch[2]!, lk)}
        </div>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        qLines.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <blockquote key={lk} className="my-1 border-l-2 border-[var(--theme-accent)] pl-3 text-[var(--theme-text-secondary)] italic">
          {qLines.map((ql, qi) => <div key={qi}>{inline(ql, `${lk}q${qi}`)}</div>)}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (ulMatch) {
      const indent = ulMatch[1]!.length;
      elements.push(
        <div key={lk} className="flex items-start gap-2 py-0.5" style={{ paddingLeft: `${indent * 8 + 4}px` }}>
          <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--theme-text-muted)]" />
          <span className="text-sm leading-relaxed text-[var(--theme-text-secondary)]">{inline(ulMatch[2]!, lk)}</span>
        </div>,
      );
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      const indent = olMatch[1]!.length;
      elements.push(
        <div key={lk} className="flex items-start gap-2 py-0.5" style={{ paddingLeft: `${indent * 8 + 4}px` }}>
          <span className="min-w-[1.2em] flex-shrink-0 text-right text-sm text-[var(--theme-text-muted)]">{olMatch[2]}.</span>
          <span className="text-sm leading-relaxed text-[var(--theme-text-secondary)]">{inline(olMatch[3]!, lk)}</span>
        </div>,
      );
      i++;
      continue;
    }

    // Plain paragraph
    elements.push(
      <p key={lk} className="py-0.5 text-sm leading-relaxed text-[var(--theme-text-secondary)]">
        {inline(line, lk)}
      </p>,
    );
    i++;
  }

  return <div>{elements}</div>;
}

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
  type: 'agent' | 'human';
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
            opt.type === 'agent' ? 'bg-purple-500/20 text-purple-400' : 'bg-amber-500/20 text-amber-400'
          }`}>
            {opt.type === 'agent' ? 'A' : 'H'}
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
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autocomplete state
  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acIndex, setAcIndex] = useState(0);
  const [acTriggerPos, setAcTriggerPos] = useState(-1); // cursor position of the '@'
  const inputWrapperRef = useRef<HTMLDivElement>(null);

  // Build mention options from personas + human
  const personas = useAgentPersonaStore((s) => s.personas);
  const humanMentionName = useSettingsStore(
    (s) => (s.settings as unknown as Record<string, unknown>)['humanMentionName'] as string | undefined,
  );

  const allMentionOptions = useMemo<MentionOption[]>(() => {
    const opts: MentionOption[] = personas.map((p) => ({
      insertText: `@agent:${p.name}`,
      label: p.displayName || p.name,
      type: 'agent' as const,
    }));
    if (humanMentionName) {
      opts.push({
        insertText: `@${humanMentionName}`,
        label: humanMentionName,
        type: 'human' as const,
      });
    }
    return opts;
  }, [personas, humanMentionName]);

  const filteredOptions = useMemo(() => {
    if (!acOpen) return [];
    const q = acQuery.toLowerCase();
    return allMentionOptions.filter((o) =>
      o.label.toLowerCase().includes(q) || o.insertText.toLowerCase().includes(q),
    );
  }, [acOpen, acQuery, allMentionOptions]);

  useEffect(() => {
    api.fetchTicketComments(ticketId).then(setComments).catch(() => {});
    api.fetchTicketMentions(ticketId).then(setMentions).catch(() => {});
  }, [ticketId]);

  const mentionLookup = useMemo(() => buildMentionLookup(mentions), [mentions]);

  useEffect(() => {
    const decoder = new TextDecoder();
    const unsub = ticketWs.onMessage((buf: ArrayBuffer) => {
      try {
        const msg = JSON.parse(decoder.decode(buf)) as TicketWsMessage;
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
        } else if (msg.type === 'mention:deleted') {
          const d = msg.data as { id: string; ticketId: string };
          if (d.ticketId === ticketId) {
            setMentions((prev) => prev.filter((x) => x.id !== d.id));
          }
        } else if (msg.type === 'mention:updated' || msg.type === 'mention:acknowledged' || msg.type === 'mention:resolved' || msg.type === 'mention:waiting_for_info') {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          }
        }
      } catch {
        // ignore
      }
    });
    return unsub;
  }, [ticketId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

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
      const comment = await api.postTicketComment(ticketId, trimmed);
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
      setBody('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch {
      // keep body so user can retry
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }, [body, submitting, ticketId]);

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
        const q = fragment.replace(/^agent:/, '');
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
      <div className="flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-[var(--theme-text-muted)]">No comments yet</p>
            <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
              Use <span className="font-mono text-[var(--theme-accent)]">@agent:name</span> to mention an agent
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--theme-border)]/50">
            {comments.map((c) => (
              <div key={c.id} className="px-1 py-3 first:pt-0">
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
              </div>
            ))}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div ref={inputWrapperRef} className="relative flex flex-shrink-0 items-end gap-2 border-t border-[var(--theme-border)] pt-3">
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
          className="max-h-40 min-h-[36px] flex-1 resize-none overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm leading-snug text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
          rows={1}
          placeholder="Write a comment... (@ to mention)"
          value={body}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={() => { setTimeout(closeMentionAc, 150); }}
          disabled={submitting}
        />
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
    </div>
  );
}
