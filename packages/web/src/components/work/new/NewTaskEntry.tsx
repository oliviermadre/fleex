import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { detectSource, getSource, type SourceMatch } from '@fleex/shared';
import { fetchImportBrowseInbox } from '../../../services/api';
import { useWorkStore } from '../../../stores/workStore';
import { NewTaskCard } from './NewTaskCard';
import { BrowseRow, Keys, IssueGlyph, PullRequestGlyph, SlackGlyph } from './BrowseRow';
import { INBOX_KEY } from './SourcePicker';
import { useBrowseResource } from './useBrowseResource';

export type BrowseSource = 'issues' | 'prs' | 'slack';

/**
 * The entry screen: "Where does this task come from?". A single focused field
 * whose value IS the draft title (so a reload keeps the typed text). Plain text
 * + ↵ names the task and moves to the composer; a recognized link announces its
 * source and ↵ imports it, while Esc refuses the recognition (keeping the field).
 *
 * Below it, "or browse" lists the sources for whoever doesn't have the link at
 * hand. The field stays focused, so the sources are reached with ↓ (then ↑↓, ↵,
 * or 1·2·3) or with ⌥1·2·3 from anywhere. A bare digit is NOT a shortcut while
 * typing: "2FA login" is a task title.
 */
export function NewTaskEntry({
  onImport,
  onBrowse,
  disabled = false,
}: {
  onImport: (match: SourceMatch) => void;
  onBrowse: (source: BrowseSource) => void;
  /** Frozen backdrop while an import resolves on top (avoids a blank flash). */
  disabled?: boolean;
}) {
  const draft = useWorkStore((s) => s.draft);
  const updateDraft = useWorkStore((s) => s.updateDraft);
  const setView = useWorkStore((s) => s.setView);
  const [refused, setRefused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  // Opening New Task warms the lists: by the time a source is picked its rows
  // are in memory. It also feeds the counts on the source rows.
  const inbox = useBrowseResource(INBOX_KEY, fetchImportBrowseInbox);

  const value = draft.title;
  const match = useMemo(() => detectSource(value), [value]);
  const recognized = match && !refused ? match : null;

  const sources: { id: BrowseSource; label: string; hint?: string; glyph: ReactElement }[] = [
    { id: 'issues', label: 'A GitHub issue', hint: countHint(inbox.data?.issues.length, 'open for you'), glyph: <IssueGlyph /> },
    {
      id: 'prs',
      label: 'A GitHub pull request',
      hint: countHint(inbox.data?.reviewRequests.length, 'waiting for your review'),
      glyph: <PullRequestGlyph />,
    },
    { id: 'slack', label: 'A Slack message or thread', glyph: <SlackGlyph /> },
  ];

  function onChange(raw: string) {
    // Collapse a multi-line paste into a single line; any keystroke re-arms a
    // recognition that was refused.
    setRefused(false);
    updateDraft({ title: raw.replace(/[\r\n]+/g, ' ') });
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
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
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowRefs.current[0]?.focus();
    }
  }

  function onRowKeyDown(e: KeyboardEvent, index: number) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowRefs.current[(index + 1) % sources.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index === 0) inputRef.current?.focus();
      else rowRefs.current[index - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      inputRef.current?.focus();
    } else if (['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      onBrowse(sources[Number(e.key) - 1]!.id);
    }
  }

  // ⌥1·2·3 from anywhere on the card, the field included. `code`, not `key`: on
  // macOS ⌥1 types "¡".
  function onCardKeyDown(e: KeyboardEvent) {
    const digit = /^Digit([123])$/.exec(e.code)?.[1];
    if (e.altKey && !e.metaKey && !e.ctrlKey && digit) {
      e.preventDefault();
      onBrowse(sources[Number(digit) - 1]!.id);
    }
  }

  return (
    <NewTaskCard disabled={disabled} onKeyDown={onCardKeyDown}>
      <h2 className="text-[17px] font-semibold text-[var(--theme-text-primary)]">Where does this task come from?</h2>
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Paste a link, or name the task…"
        className="mt-4 w-full rounded-[9px] border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-[15px] py-[13px] text-[15px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
      />

      {recognized ? (
        <div className="mt-[11px] flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="text-[var(--theme-text-primary)]">
            <span className="text-[var(--theme-accent)]">◆</span> {getSource(recognized.sourceId).name} ·{' '}
            <span className="font-mono text-[12.5px]">{recognized.display}</span>
          </span>
          <span className="flex gap-3 text-[12px] text-[var(--theme-text-muted)]">
            <Keys keys={['↵']} label="import" />
            <Keys keys={['esc']} label="use as plain text" />
          </span>
        </div>
      ) : (
        <p className="mt-[11px] flex items-center gap-2 text-[13px] text-[var(--theme-text-muted)]">
          {match && refused ? (
            'Treated as plain text'
          ) : (
            <Keys keys={['↵']} label="starts from this text — a recognised link imports directly" />
          )}
        </p>
      )}

      <div className="mb-2.5 mt-6 flex items-center gap-3.5">
        <span className="h-px flex-1 bg-[var(--theme-border)]" />
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--theme-text-muted)]">or browse</span>
        <span className="h-px flex-1 bg-[var(--theme-border)]" />
      </div>

      <div role="group" aria-label="Browse a source">
        {sources.map((source, i) => (
          <BrowseRow
            key={source.id}
            rowRef={(el) => (rowRefs.current[i] = el)}
            glyph={source.glyph}
            title={source.label}
            hint={source.hint}
            trailing={i + 1}
            onKeyDown={(e) => onRowKeyDown(e, i)}
            onClick={() => onBrowse(source.id)}
          />
        ))}
        <div className="flex items-center gap-3.5 p-3">
          <span className="w-[18px] shrink-0" />
          <span className="flex-1 text-[14.5px] text-[var(--theme-text-muted)]">Linear · Jira · Notion</span>
          <span className="font-mono text-[11.5px] text-[var(--theme-text-muted)]">later</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3.5 border-t border-[var(--theme-border)] pt-3.5 text-[12px] text-[var(--theme-text-muted)]">
        <span className="hidden flex-wrap gap-3.5 sm:flex">
          <Keys keys={['↓']} label="browse" />
          <Keys keys={['⌥1', '⌥2', '⌥3']} label="open a source" />
        </span>
        <button
          type="button"
          onClick={() => setView('task')}
          className="ml-auto rounded-lg border border-[var(--theme-border-input)] px-3.5 py-1.5 text-[13px] text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]"
        >
          Cancel
        </button>
      </div>
    </NewTaskCard>
  );
}

/** "3 open for you" — nothing while unknown, nothing for zero (no noise on the row). */
function countHint(count: number | undefined, label: string): string | undefined {
  return count ? `${count} ${label}` : undefined;
}
