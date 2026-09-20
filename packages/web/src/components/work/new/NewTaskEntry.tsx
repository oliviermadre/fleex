import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { detectSource, getSource, type SourceMatch } from '@fleex/shared';
import { useWorkStore } from '../../../stores/workStore';
import { BrowseSources } from './BrowseSources';

/**
 * The entry screen: "Where does this task come from?". A single focused field
 * whose value IS the draft title (so a reload keeps the typed text). Plain text
 * + ↵ names the task and moves to the composer; a recognized link announces its
 * source and ↵ imports it, while Esc refuses the recognition (keeping the field).
 */
export function NewTaskEntry({
  onImport,
  onOpenTicket,
  disabled = false,
}: {
  onImport: (match: SourceMatch) => void;
  onOpenTicket: (ticketId: string) => void;
  /** Frozen backdrop while an import resolves on top (avoids a blank flash). */
  disabled?: boolean;
}) {
  const draft = useWorkStore((s) => s.draft);
  const updateDraft = useWorkStore((s) => s.updateDraft);
  const setView = useWorkStore((s) => s.setView);
  const [refused, setRefused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const value = draft.title;
  const match = useMemo(() => detectSource(value), [value]);
  const recognized = match && !refused ? match : null;

  function onChange(raw: string) {
    // Collapse a multi-line paste into a single line; any keystroke re-arms a
    // recognition that was refused.
    setRefused(false);
    updateDraft({ title: raw.replace(/[\r\n]+/g, ' ') });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (recognized) {
        onImport(recognized);
        return;
      }
      const trimmed = value.trim();
      if (trimmed !== '') {
        updateDraft({ title: trimmed, stage: 'compose' });
      }
    } else if (e.key === 'Escape') {
      if (recognized) {
        // Refuse the recognition: treat the link as plain text, keep the field.
        setRefused(true);
        return;
      }
      setView('task');
    }
  }

  return (
    <div className={`flex flex-1 items-start justify-center overflow-y-auto p-6${disabled ? ' pointer-events-none' : ''}`}>
      <div className="w-full max-w-2xl rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
        <h2 className="mb-2 text-[13px] font-semibold text-[var(--theme-text-primary)]">Where does this task come from?</h2>
        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Paste a link, or name the task…"
          className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 py-1.5 text-[14px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
        />

        {recognized && (
          <div className="mt-2 flex flex-col gap-0.5 rounded-md bg-[var(--theme-bg-base)] px-2 py-1.5">
            <span className="text-[12px] text-[var(--theme-text-secondary)]">
              ◆ {getSource(recognized.sourceId).name} · <span className="font-mono">{recognized.display}</span>
            </span>
            <span className="text-[11px] text-[var(--theme-text-faint)]">↵ import · Esc use as plain text</span>
          </div>
        )}
        {match && refused && (
          <div className="mt-2 px-2 text-[11px] text-[var(--theme-text-faint)]">Treated as plain text</div>
        )}

        <BrowseSources onImport={onImport} onOpenTicket={onOpenTicket} />

        <div className="mt-3 flex items-center gap-2 border-t border-[var(--theme-border-subtle)] pt-3">
          <span className="text-[11px] text-[var(--theme-text-faint)]">⏎ continue</span>
          <button
            type="button"
            onClick={() => setView('task')}
            className="ml-auto rounded-md px-3 py-1 text-[12px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
