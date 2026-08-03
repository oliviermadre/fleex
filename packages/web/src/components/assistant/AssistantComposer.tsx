import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useAssistantStore } from '../../stores/assistantStore';
import { MentionTypeIcon } from '../../lib/primitives';
import { cn } from '../../lib/cn';

/**
 * The assistant input, isolated from the transcript (#518).
 *
 * The draft lives HERE and nowhere else. It is deliberately not lifted into a
 * store and not debounced: keeping it local is what makes a keystroke re-render
 * this component only, instead of the whole assistant subtree. Every store
 * subscription the composer needs is read here too, for the same reason —
 * pushing them up would re-render the transcript on unrelated updates.
 */

// Same option model as the ticket composer: every mention target the
// assistant can act on — agents, panels, skills, workflows, human, tickets.
interface MentionOption {
  insertText: string;
  label: string;
  type: 'agent' | 'human' | 'panel' | 'skill' | 'workflow' | 'ticket';
}

const MAX_TICKET_SUGGESTIONS = 8;

interface AssistantComposerProps {
  /** Active conversation — sending is a no-op without one. */
  sessionId: string;
  busy: boolean;
  /** Called after a message left the composer, so the parent can stick to bottom. */
  onSent: () => void;
}

export function AssistantComposer({ sessionId, busy, onSent }: AssistantComposerProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Image / file upload — same engine as everywhere else ──
  const { isUploading, isDragOver, pasteHandler, dragProps, openFilePicker } = useFileUpload({
    textareaRef,
    value: draft,
    onChange: setDraft,
  });

  // ── Mention autocomplete ──
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
  const allTickets = useTicketStore((s) => s.tickets);
  const fetchTickets = useTicketStore((s) => s.fetchTickets);

  useEffect(() => {
    if (!panelsLoaded) loadPanels();
    if (!skillsLoaded) loadSkills();
    if (workflowTemplates.length === 0) void refreshWorkflowTemplates();
    if (allTickets.length === 0) void fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelsLoaded, loadPanels, skillsLoaded, loadSkills]);

  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acIndex, setAcIndex] = useState(0);
  const [acTriggerPos, setAcTriggerPos] = useState(-1);

  // Tickets are deliberately NOT materialised here: an instance can hold
  // hundreds, and this array would then be rescanned in full on every keystroke.
  // They are matched lazily below, only once the user has typed something.
  const staticMentionOptions = useMemo<MentionOption[]>(() => {
    const opts: MentionOption[] = personas.map((p) => ({
      insertText: `@agent:${p.name}`,
      label: p.displayName || p.name,
      type: 'agent' as const,
    }));
    for (const panel of panels) {
      if (panel.enabled) opts.push({ insertText: `@panel:${panel.name}`, label: panel.displayName || panel.name, type: 'panel' });
    }
    for (const skill of skills) {
      if (skill.enabled) opts.push({ insertText: `@skill:${skill.commandName}`, label: skill.displayName || skill.commandName, type: 'skill' });
    }
    for (const wf of workflowTemplates) {
      if (wf.enabled) opts.push({ insertText: `@workflow:${wf.slug}`, label: wf.emoji ? `${wf.emoji} ${wf.name}` : wf.name, type: 'workflow' });
    }
    if (humanMentionName) opts.push({ insertText: `@${humanMentionName}`, label: humanMentionName, type: 'human' });
    return opts;
  }, [personas, panels, skills, workflowTemplates, humanMentionName]);

  const filteredOptions = useMemo(() => {
    if (!acOpen) return [];
    const q = acQuery.toLowerCase();
    const matches = (o: MentionOption) =>
      o.label.toLowerCase().includes(q) || o.insertText.toLowerCase().includes(q);
    const nonTicket = staticMentionOptions.filter(matches);
    if (q.length === 0) return nonTicket;
    const tickets: MentionOption[] = [];
    for (const t of allTickets) {
      const opt: MentionOption = {
        insertText: `@ticket:${t.displayId}`,
        label: `#${t.displayId} ${t.title}`,
        type: 'ticket',
      };
      if (matches(opt)) tickets.push(opt);
      if (tickets.length === MAX_TICKET_SUGGESTIONS) break;
    }
    return [...nonTicket, ...tickets];
  }, [acOpen, acQuery, staticMentionOptions, allTickets]);

  const closeMentionAc = useCallback(() => {
    setAcOpen(false);
    setAcQuery('');
    setAcIndex(0);
    setAcTriggerPos(-1);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      const cursor = e.target.selectionStart;
      setDraft(val);
      const textBeforeCursor = val.slice(0, cursor);
      const atIdx = textBeforeCursor.lastIndexOf('@');
      if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]!))) {
        const fragment = textBeforeCursor.slice(atIdx + 1);
        if (!/\s/.test(fragment)) {
          setAcOpen(true);
          setAcTriggerPos(atIdx);
          setAcQuery(fragment.replace(/^(agent|panel|skill|workflow|ticket):/, ''));
          setAcIndex(0);
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
      const before = draft.slice(0, acTriggerPos);
      const after = draft.slice(ta.selectionStart);
      const newDraft = before + opt.insertText + ' ' + after;
      setDraft(newDraft);
      closeMentionAc();
      const newCursor = acTriggerPos + opt.insertText.length + 1;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      });
    },
    [draft, acTriggerPos, closeMentionAc],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || !sessionId || busy || isUploading) return;
    // Read the action off the store rather than subscribing: one less
    // dependency that could invalidate this callback on every keystroke.
    useAssistantStore.getState().sendUser(text);
    setDraft('');
    closeMentionAc();
    onSent();
  }, [draft, sessionId, busy, isUploading, closeMentionAc, onSent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [acOpen, filteredOptions, acIndex, acceptMention, closeMentionAc, handleSend],
  );

  return (
    <div className="shrink-0 border-t border-[var(--theme-border)] px-6 py-3">
      <div className="relative mx-auto max-w-3xl">
        {/* Autocomplete dropdown */}
        {acOpen && filteredOptions.length > 0 && (
          <div className="absolute bottom-full left-0 z-30 mb-1 max-h-56 min-w-[280px] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl">
            {filteredOptions.map((opt, i) => (
              <button
                key={opt.insertText}
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptMention(opt);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                  i === acIndex
                    ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                )}
              >
                <MentionTypeIcon type={opt.type} />
                <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
                <span className="shrink-0 text-[10px] text-[var(--theme-text-faint)]">{opt.type}</span>
              </button>
            ))}
          </div>
        )}
        <div
          className={cn(
            'flex items-end gap-2 rounded-xl border bg-[var(--theme-bg-surface)] p-2',
            isDragOver ? 'border-[var(--theme-accent)]' : 'border-[var(--theme-border)]',
          )}
          {...dragProps}
        >
          <button
            onClick={openFilePicker}
            className="shrink-0 rounded-md p-2 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            title="Joindre une image ou un fichier"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={pasteHandler}
            onBlur={() => setTimeout(closeMentionAc, 200)}
            placeholder={
              busy
                ? 'Assistant au travail…'
                : 'Demande quelque chose… (@ pour référencer agents, skills, panels, workflows, tickets — ⇧⏎ pour une nouvelle ligne)'
            }
            rows={2}
            className="min-h-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed text-[var(--theme-text-primary)] outline-none placeholder:text-[var(--theme-text-faint)]"
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || busy || isUploading}
            className="shrink-0 rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-[var(--theme-accent-fg)] transition-colors hover:bg-[var(--theme-accent-hover)] disabled:opacity-50"
          >
            {isUploading ? '…' : '➤'}
          </button>
        </div>
        {isUploading && <p className="mt-1 text-[10px] text-[var(--theme-text-faint)]">Upload en cours…</p>}
      </div>
    </div>
  );
}
