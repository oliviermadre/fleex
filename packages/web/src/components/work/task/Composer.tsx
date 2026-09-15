/**
 * The Work-stream conversation composer. Built on the shared MarkdownEditor
 * (write/preview/split toggle), so it has feature parity with the ticket
 * Comments composer: draft persistence (owned by the parent via useCommentDraft),
 * the conversation execution bar (mode / model / effort / fast), inline image
 * paste + paperclip upload, and the same @-mention autocomplete. Posts on Enter
 * (Shift+Enter inserts a newline); the value is controlled by the parent so a
 * suggestion chip can seed an @mention.
 */
import { useEffect, useRef, useCallback } from 'react';
import { usePanelStore } from '../../../stores/panelStore';
import { useSkillStore } from '../../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../../stores/workflowTemplateStore';
import { MarkdownEditor } from '../../markdown/MarkdownEditor';
import { ComposerExecBar } from '../../markdown/ComposerExecBar';
import { useMentionAutocomplete } from '../../markdown/useMentionAutocomplete';
import { useAllMentionOptions } from '../../markdown/useAllMentionOptions';
import { MentionMenu } from '../../markdown/MentionMenu';
import { useFileUpload } from '../../../hooks/useFileUpload';
import { useExecConfig } from '../../../hooks/useExecConfig';

interface Props {
  ticketId: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  posting?: boolean;
  onSend: (body: string) => void | Promise<void>;
}

export function Composer({ ticketId, value, onChange, disabled, posting, onSend }: Props) {
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

  const exec = useExecConfig(ticketId);
  const options = useAllMentionOptions();
  const mentionAc = useMentionAutocomplete({ options, value, onChange, textareaRef: ref });
  const fileUpload = useFileUpload({ textareaRef: ref, value, onChange });

  const send = useCallback(async () => {
    const body = value.trim();
    if (!body || disabled || posting) return;
    await onSend(body);
    // Clear only after a successful post, so an error keeps the draft.
    onChange('');
    ref.current?.focus();
  }, [value, disabled, posting, onSend, onChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Let the mention menu consume Arrow/Tab/Enter/Escape first.
    if (mentionAc.onKeyDown(e)) return;
    // Execution mode cycle: Shift+Tab (Talk→Plan→Edit→Talk), à la Claude Code.
    if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      exec.cycleMode();
      return;
    }
    // Execution mode toggle: Ctrl+1/2/3 (direct selection).
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      if (e.key === '1') { e.preventDefault(); exec.setExecutionMode('talk'); return; }
      if (e.key === '2') { e.preventDefault(); exec.setExecutionMode('plan'); return; }
      if (e.key === '3') { e.preventDefault(); exec.setExecutionMode('edit'); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div
      className="shrink-0 border-t border-[var(--theme-border)] p-3"
      {...fileUpload.dragProps}
    >
      <MarkdownEditor
        variant="composer"
        surfaceKind="comment"
        value={value}
        onChange={onChange}
        disabled={disabled}
        // The drop target is the wrapper above, so the editor can't detect the
        // drag itself — it just mirrors the highlight.
        dragOver={fileUpload.isDragOver}
        placeholder="Reply, or @ to bring in agents, skills, panels, workflows, tickets…"
        textareaRef={ref}
        maxRows={10}
        textareaProps={{
          onChange: mentionAc.onScan,
          onKeyDown,
          onPaste: fileUpload.pasteHandler,
          onBlur: () => { setTimeout(mentionAc.close, 150); },
        }}
        overlay={
          mentionAc.open && mentionAc.filtered.length > 0 ? (
            <MentionMenu
              options={mentionAc.filtered}
              selectedIndex={mentionAc.index}
              onSelect={mentionAc.accept}
              position={{ bottom: (ref.current?.offsetHeight ?? 36) + 8, left: 0 }}
            />
          ) : null
        }
        trailing={
          <>
            <button
              type="button"
              className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-lg text-[var(--theme-text-muted)] transition-opacity hover:text-[var(--theme-accent)] hover:opacity-90"
              onClick={fileUpload.openFilePicker}
              title="Attach file"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              type="button"
              className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-30"
              onClick={() => void send()}
              disabled={disabled || posting || !value.trim()}
              title="Send (Enter)"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </>
        }
        actions={
          <>
            <ComposerExecBar exec={exec} />
            <span className="ml-auto text-[11px] text-[var(--theme-text-faint)]">⇧⏎ newline</span>
          </>
        }
      />
    </div>
  );
}
