import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { FactoryConsolePopup, Plate } from './FactoryConsolePopup';
import { KBD } from './FactoryPopup';

/**
 * A station's instructions, in a window large enough for a whole prompt, stacked over the station's popup. The
 * station's Setup only shows how they start.
 *
 * Closing the window keeps what was typed (the Close button, Escape, a click
 * outside): losing a long prompt to a stray key is worse than saving a draft.
 * "Discard changes" is the way to throw it away.
 */
export function FactoryPromptEditor({ title, value, onSave, onClose, colour = 'var(--theme-accent)' }: { title: string; value: string; onSave: (v: string) => void; onClose: () => void; colour?: string }) {
  const [draft, setDraft] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);
  const done = () => { if (draft !== value) onSave(draft); onClose(); };
  const lines = draft ? draft.split('\n').length : 0;
  const plate = (
    <Plate small icon="edit" name="Instructions" kind={`${title} · ${lines} line${lines === 1 ? '' : 's'} · ${draft.length.toLocaleString('en-US')} characters${draft !== value ? ' · not saved yet' : ''}`}
      actions={<>
        <Button size="sm" variant="ghost" disabled={draft === value} onClick={onClose} title="Close and keep the instructions as they were">Discard changes</Button>
        <Button size="sm" variant="primary" onClick={done} title="Keep what is written and close (Ctrl+Enter)">Save</Button>
        <Button size="sm" variant="ghost" onClick={done} title="Keep what is written and close">Close <kbd className={KBD}>Esc</kbd></Button>
      </>} />
  );
  return (
    <FactoryConsolePopup label="Instructions" colour={colour} plate={plate} onClose={done} size="full" maxWidth="max-w-5xl" zIndexClass="z-50" guardEscape={false}>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
        <p className="text-xs text-[var(--theme-text-muted)]">What the agent should do with a ticket at this station. It is added to what the persona, the skill or the panel already knows, and comes with the ticket, its thread and where each outcome leads.</p>
        <textarea
          ref={area} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} aria-label="Instructions for this station" rows={16}
          placeholder="What the agent should do here. Plain text or Markdown; as long as it needs to be."
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(); } }}
          className="min-h-0 w-full flex-1 resize-none rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2.5 font-mono text-[13px] leading-relaxed text-[var(--theme-text-primary)] outline-none focus:border-[var(--mc)]" />
        <div className="flex-none text-right font-mono text-[11px] text-[var(--theme-text-muted)]">Ctrl+Enter or Escape keeps and closes</div>
      </div>
    </FactoryConsolePopup>
  );
}
