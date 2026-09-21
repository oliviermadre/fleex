import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { slackMessageSource, type SourceMatch } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { NewTaskCard } from './NewTaskCard';
import { Keys } from './BrowseRow';

/**
 * Slack has nothing to browse: Fleex has no Slack access of its own — Claude
 * reads ONE conversation, through the user's integration, from its permalink.
 * So this screen asks for that link, says where to find it, and says what is kept.
 */
export function SlackLinkScreen({
  onBack,
  onImport,
  disabled = false,
}: {
  onBack: () => void;
  onImport: (match: SourceMatch) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const match = slackMessageSource.detect(value);
  const invalid = value.trim() !== '' && !match;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onBack();
    } else if (e.key === 'Enter' && match) {
      e.preventDefault();
      onImport(match);
    }
  }

  return (
    <NewTaskCard disabled={disabled} onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[16px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]"
        >
          ←
        </button>
        <span className="font-mono text-[11px] font-semibold tracking-[0.16em] text-[var(--theme-accent)]">SLACK</span>
        <h2 className="text-[17px] font-semibold text-[var(--theme-text-primary)]">Import a message or a thread</h2>
      </div>

      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Slack message link"
        aria-invalid={invalid}
        placeholder="https://your-team.slack.com/archives/C04X9/p1726750112"
        className={cn(
          'mt-4 w-full rounded-[9px] border bg-[var(--theme-bg-base)] px-[15px] py-[13px] font-mono text-[13.5px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:outline-none',
          invalid ? 'border-[var(--theme-border-input)]' : 'border-[var(--theme-border-input)] focus:border-[var(--theme-accent)]',
        )}
      />
      <p className="mt-[11px] text-[13px] text-[var(--theme-text-muted)]">
        {invalid ? "That doesn't look like a Slack message link. In Slack, right-click the message → Copy link." : 'In Slack, right-click the message → Copy link.'}
      </p>

      <p className="mt-4 rounded-[9px] border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-4 py-3.5 text-[13.5px] leading-relaxed text-[var(--theme-text-secondary)]">
        Claude reads the conversation through your Slack integration and writes a summary. Fleex stores none of the
        thread — only the summary and the permalink stay on the ticket.
      </p>

      <div className="mt-6 flex items-center gap-2 border-t border-[var(--theme-border)] pt-3.5 text-[12px] text-[var(--theme-text-muted)]">
        <span className="hidden sm:inline-flex">
          <Keys keys={['esc']} label="back" />
        </span>
        <button
          type="button"
          onClick={onBack}
          className="ml-auto rounded-lg px-3.5 py-1.5 text-[13px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!match}
          onClick={() => match && onImport(match)}
          className="rounded-lg bg-[var(--theme-accent)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:opacity-40"
        >
          Import ↵
        </button>
      </div>
    </NewTaskCard>
  );
}
