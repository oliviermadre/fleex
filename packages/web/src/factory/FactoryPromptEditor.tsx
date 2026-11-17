import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';

/**
 * A station's instructions, in a window large enough for a whole prompt. The
 * side panel only shows how they start.
 *
 * Closing the window keeps what was typed (the Close button, Escape, a click
 * outside): losing a long prompt to a stray key is worse than saving a draft.
 * "Discard changes" is the way to throw it away.
 */
export function FactoryPromptEditor({ title, value, onSave, onClose }: { title: string; value: string; onSave: (v: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);
  const done = () => { if (draft !== value) onSave(draft); onClose(); };
  const lines = draft ? draft.split('\n').length : 0;
  return (
    <Modal open onClose={done} maxWidth="max-w-5xl" variant="glass">
      <div className="flex h-[82vh] flex-col gap-3">
        <div className="flex flex-none items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-[var(--theme-text-primary)]">Instructions — {title}</div>
            <p className="text-xs text-[var(--theme-text-muted)]">What the agent should do with a ticket at this station. It is added to what the persona, the skill or the panel already knows, and comes with the ticket, its thread and where each outcome leads.</p>
          </div>
          <Button size="sm" variant="ghost" disabled={draft === value} onClick={onClose} title="Close and keep the instructions as they were">Discard changes</Button>
          <Button size="sm" variant="primary" onClick={done} title="Keep what is written and close (Ctrl+Enter)">Done</Button>
        </div>
        <textarea
          ref={area} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} aria-label="Instructions for this station"
          placeholder="What the agent should do here. Plain text or Markdown; as long as it needs to be."
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(); } }}
          className="min-h-0 w-full flex-1 resize-none rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2.5 font-mono text-[13px] leading-relaxed text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]" />
        <div className="flex flex-none items-center justify-between font-mono text-[11px] text-[var(--theme-text-muted)]">
          <span>{lines} line{lines === 1 ? '' : 's'} · {draft.length.toLocaleString('en-US')} characters{draft !== value ? ' · not saved yet' : ''}</span>
          <span>Ctrl+Enter or Escape keeps and closes</span>
        </div>
      </div>
    </Modal>
  );
}
