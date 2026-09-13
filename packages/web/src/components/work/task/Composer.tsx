/**
 * The conversation composer: a growing textarea that posts a comment on Enter
 * (Shift+Enter inserts a newline). Carries the same @-mention autocomplete as the
 * ticket / scratchpad composers (useMentionAutocomplete + MentionMenu), so
 * `@agent:`, `@skill:`, `@panel:`, `@workflow:`, `@ticket:` all complete. The
 * value is controlled by the parent so suggestion chips can seed an @mention.
 */
import { useEffect, useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { usePanelStore } from '../../../stores/panelStore';
import { useSkillStore } from '../../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../../stores/workflowTemplateStore';
import { useMentionAutocomplete } from '../../markdown/useMentionAutocomplete';
import { useAllMentionOptions } from '../../markdown/useAllMentionOptions';
import { MentionMenu } from '../../markdown/MentionMenu';

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  posting?: boolean;
  onSend: (body: string) => void | Promise<void>;
}

export function Composer({ value, onChange, disabled, posting, onSend }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Populate the mention stores so the @-menu isn't sparse (tickets, personas
  // and scratchpads are primed elsewhere in the app).
  const loadPanels = usePanelStore((s) => s.loadPanels);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const refreshWorkflows = useWorkflowTemplateStore((s) => s.refresh);
  useEffect(() => {
    void loadPanels();
    void loadSkills();
    void refreshWorkflows();
  }, [loadPanels, loadSkills, refreshWorkflows]);

  const options = useAllMentionOptions();
  const mentionAc = useMentionAutocomplete({ options, value, onChange, textareaRef: ref });

  const send = useCallback(async () => {
    const body = value.trim();
    if (!body || disabled || posting) return;
    onChange('');
    await onSend(body);
    ref.current?.focus();
  }, [value, disabled, posting, onSend, onChange]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Let the mention menu consume Arrow/Tab/Enter/Escape first.
    if (mentionAc.onKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="shrink-0 border-t border-[var(--theme-border)] p-3">
      <div className="relative rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] focus-within:border-[var(--theme-accent)]">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            mentionAc.onScan(e);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(mentionAc.close, 150)}
          disabled={disabled}
          rows={2}
          placeholder="Reply, or @ to bring in agents, skills, panels, workflows, tickets…"
          className="max-h-40 w-full resize-none bg-transparent px-3 py-2 text-[13px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:outline-none"
        />
        {mentionAc.open && mentionAc.filtered.length > 0 && (
          <MentionMenu
            options={mentionAc.filtered}
            selectedIndex={mentionAc.index}
            onSelect={mentionAc.accept}
            position={{ bottom: (ref.current?.offsetHeight ?? 44) + 34, left: 8 }}
          />
        )}
        <div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-[var(--theme-text-faint)]">
          <span>Auto (persona)</span>
          <span>·</span>
          <span>⇧⏎ newline</span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={disabled || posting || !value.trim()}
            className="ml-auto rounded-md bg-[var(--theme-accent)] px-3 py-1 text-[12px] font-medium text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:opacity-40"
          >
            {posting ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
