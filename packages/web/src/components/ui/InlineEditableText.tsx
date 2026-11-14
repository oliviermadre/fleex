import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

interface InlineEditableTextProps {
  value: string;
  /** Called with the trimmed, changed value. A rejection restores `value` (the caller reports the error). */
  onCommit: (next: string) => Promise<void> | void;
  /** Classes of the text shown when not editing (a button). */
  className?: string;
  /** Classes of the input shown while editing. */
  inputClassName?: string;
  maxLength?: number;
  ariaLabel?: string;
  /** Tooltip of the text shown when not editing. */
  title?: string;
}

type Mode = 'idle' | 'editing' | 'saving';

/**
 * A single-line text that turns into an input on click (epic name, ticket title).
 *
 *   idle ──click──▶ editing ──Esc──▶ idle (value unchanged)
 *                     ├─ Enter|blur, trimmed empty or unchanged ─▶ idle, no call
 *                     └─ Enter|blur, valid ─▶ saving (input disabled, shows the new value)
 *                                              ├─ resolves ─▶ idle
 *                                              └─ rejects  ─▶ idle, `value` restored
 */
export function InlineEditableText({
  value, onCommit, className, inputClassName, maxLength, ariaLabel, title = 'Click to rename',
}: InlineEditableTextProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter then the blur it may cause, or Esc then the unmount blur: settle once.
  const settledRef = useRef(false);

  useEffect(() => {
    if (mode !== 'editing') return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [mode]);

  const start = () => {
    settledRef.current = false;
    setDraft(value);
    setMode('editing');
  };

  const cancel = () => {
    settledRef.current = true;
    setDraft(value);
    setMode('idle');
  };

  const commit = async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    if (!next || next === value) {
      setMode('idle');
      return;
    }
    setMode('saving');
    try {
      await onCommit(next);
    } catch {
      // The caller reported it; going back to idle shows `value` again.
    } finally {
      setMode('idle');
    }
  };

  if (mode === 'idle') {
    return (
      <button type="button" className={className} onClick={start} title={title}>
        {value}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      className={cn('min-w-0', inputClassName)}
      value={draft}
      disabled={mode === 'saving'}
      maxLength={maxLength}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void commit(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      }}
      onBlur={() => void commit()}
    />
  );
}
