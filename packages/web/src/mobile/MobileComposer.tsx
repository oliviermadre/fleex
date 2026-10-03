import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inferModelCapabilities, resolveEffortLevel } from '@fleex/shared';
import type { ConversationMode, EffortLevel, Ticket, UpdateTicketExecutionConfigRequest } from '@fleex/shared';
import * as api from '../services/api';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { usePanelStore } from '../stores/panelStore';
import { useSkillStore } from '../stores/skillStore';
import { useWorkflowTemplateStore } from '../stores/workflowTemplateStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTicketStore } from '../stores/ticketStore';
import { useModels } from '../hooks/useModels';
import { useFileUpload } from '../hooks/useFileUpload';
import { ModelSelect } from '../components/agents/ModelSelect';
import { MentionTypeIcon } from '../lib/primitives';
import { tint } from '../lib/tints';
import { MarkdownEditor } from '../components/markdown/MarkdownEditor';

const MODES: { id: ConversationMode; label: string }[] = [
  { id: 'talk', label: '🗣 Talk' },
  { id: 'plan', label: '📋 Plan' },
  { id: 'edit', label: '📝 Edit' },
];

// Same option model as the desktop composer (TicketComments): every mention
// target the server understands — agents, panels, skills, workflows, the
// human name and tickets.
interface MentionOption {
  insertText: string;
  label: string;
  type: 'agent' | 'human' | 'panel' | 'skill' | 'workflow' | 'ticket';
}

// Tickets can be numerous — only surface them once a query is typed, capped.
const MAX_TICKET_SUGGESTIONS = 8;

/**
 * The phone's comment composer, shared by the ticket conversation and the
 * Focus sheet: conversation mode (Talk/Plan/Edit), execution config (model,
 * effort, fast), '@' mentions with autocomplete, file attachments and the
 * markdown editor. The draft is owned by the caller (`value`/`onChange`);
 * `onSubmit` sends it.
 */
export function MobileComposer({
  ticket,
  value,
  onChange,
  onSubmit,
  submitting = false,
  placeholder = 'Message… (@ pour mentionner)',
}: {
  ticket: Ticket;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  placeholder?: string;
}) {
  const ticketId = ticket.id;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Paste an image/file from the clipboard, or attach one with the paperclip (photo library on iOS)
  const fileUpload = useFileUpload({ textareaRef, value, onChange });

  // Mention targets beyond personas — loaded lazily like the desktop composer
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

  useEffect(() => {
    if (!panelsLoaded) loadPanels();
    if (!skillsLoaded) loadSkills();
    if (workflowTemplates.length === 0) void refreshWorkflowTemplates();
  }, [panelsLoaded, loadPanels, skillsLoaded, loadSkills, workflowTemplates.length, refreshWorkflowTemplates]);

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
  // The editor owns the value; this handler only scans for the '@' trigger.
  const handleMentionScan = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      const cursor = e.target.selectionStart;

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
      const before = value.slice(0, acTriggerPos);
      const after = value.slice(ta.selectionStart);
      onChange(before + opt.insertText + ' ' + after);
      closeMentionAc();
      const newCursor = acTriggerPos + opt.insertText.length + 1;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      });
    },
    [value, onChange, acTriggerPos, closeMentionAc],
  );

  // '@' button: appends a trigger at the end of the draft and opens the list —
  // more discoverable on a phone keyboard than knowing to type '@'.
  const openMentionPicker = useCallback(() => {
    const ta = textareaRef.current;
    const sep = value.length === 0 || value.endsWith(' ') || value.endsWith('\n') ? '' : ' ';
    const next = `${value}${sep}@`;
    onChange(next);
    setAcOpen(true);
    setAcTriggerPos(next.length - 1);
    setAcQuery('');
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(next.length, next.length);
    });
  }, [value, onChange]);

  // ── Conversation mode + execution config (model/effort/fast overrides) ──
  const patchExecConfig = useCallback(
    (req: UpdateTicketExecutionConfigRequest) => {
      api.updateTicketExecutionConfig(ticketId, req).catch(() => {});
    },
    [ticketId],
  );
  const { models } = useModels();
  const [showConfig, setShowConfig] = useState(false);
  const overriddenModel = ticket.modelOverride
    ? models.find((m) => m.id === ticket.modelOverride)
    : undefined;
  // Only the levels this model accepts (xhigh/max don't exist on every model and
  // an unsupported level is a 400); `effectiveEffort` is what will really run,
  // since a stored level above the model's ceiling gets clamped down.
  const effortLevels = ticket.modelOverride
    ? overriddenModel?.effortLevels ?? inferModelCapabilities(ticket.modelOverride).effortLevels
    : [];
  const effectiveEffort = ticket.modelOverride
    ? resolveEffortLevel(ticket.modelOverride, ticket.effortOverride) ?? ''
    : '';
  const hasOverrides = !!(ticket.modelOverride || ticket.effortOverride || ticket.fastMode);

  return (
    <>
      {/* Mention autocomplete */}
      {acOpen && filteredOptions.length > 0 && (
        <div className="mb-2 max-h-52 overflow-y-auto overscroll-contain rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]">
          {filteredOptions.map((opt) => (
            <button
              key={opt.insertText}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptMention(opt);
              }}
              className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-[var(--theme-bg-hover)]"
            >
              <MentionTypeIcon type={opt.type} size="lg" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--theme-text-primary)]">
                {opt.label}
              </span>
              <span className="shrink-0 text-[10px] text-[var(--theme-text-faint)]">{opt.type}</span>
            </button>
          ))}
        </div>
      )}

      {/* Mode + mention trigger */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex shrink-0 overflow-hidden rounded-xl border border-[var(--theme-border)]">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => patchExecConfig({ conversationMode: m.id })}
              className={`min-h-11 px-3 text-[13px] font-medium ${
                ticket.conversationMode === m.id
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
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
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-xl ${
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
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-lg font-semibold text-[var(--theme-text-muted)]"
          aria-label="Mentionner un agent, skill, panel ou workflow"
        >
          @
        </button>
      </div>
      <div className="flex items-end gap-2">
        <MarkdownEditor
          variant="composer"
          surfaceKind="comment"
          className="min-w-0 flex-1"
          value={value}
          onChange={onChange}
          textareaRef={textareaRef}
          minRows={2}
          placeholder={placeholder}
          textareaProps={{
            onChange: handleMentionScan,
            onPaste: fileUpload.pasteHandler,
            onBlur: () => setTimeout(closeMentionAc, 200),
            className: 'rounded-xl bg-[var(--theme-bg-secondary)] p-3 text-base text-[var(--theme-text-primary)]',
          }}
        />
        <button
          type="button"
          onClick={fileUpload.openFilePicker}
          disabled={fileUpload.isUploading}
          aria-label="Joindre une image ou un fichier"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--theme-text-muted)] disabled:opacity-50"
        >
          {fileUpload.isUploading ? '…' : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </button>
        <button
          onClick={onSubmit}
          disabled={!value.trim() || submitting || fileUpload.isUploading}
          aria-label="Envoyer"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--theme-accent)] text-base font-semibold text-[var(--theme-accent-fg)] disabled:opacity-50"
        >
          {submitting ? '…' : '➤'}
        </button>
      </div>

      {/* Execution config sheet — conversation-scoped overrides, like desktop. On body: the
          composer may sit in a transformed container (the Focus sheet), which would trap a fixed layer. */}
      {showConfig &&
        createPortal(
          <div className="fixed inset-0 z-[55] flex items-end bg-black/60" onClick={() => setShowConfig(false)}>
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
              {effortLevels.length > 0 && (
                <>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
                    Effort de raisonnement
                  </label>
                  <select
                    value={effectiveEffort}
                    onChange={(e) =>
                      patchExecConfig({ effortOverride: e.target.value === '' ? null : (e.target.value as EffortLevel) })
                    }
                    className="mb-3 w-full appearance-none rounded-lg bg-[var(--theme-bg-secondary)] px-3 py-2.5 text-sm text-[var(--theme-text-primary)]"
                  >
                    <option value="">Défaut</option>
                    {effortLevels.map((lvl) => (
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
                      ? tint('yellow')
                      : 'border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]'
                  }`}
                >
                  ⚡ Fast mode {ticket.fastMode ? 'activé' : 'désactivé'}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
