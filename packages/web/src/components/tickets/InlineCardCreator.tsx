import { useState, useRef, useEffect } from 'react';
import type { TicketStatus } from '@asm/shared';
import { useTicketStore } from '../../stores/ticketStore';

const GITHUB_ISSUE_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+\/?$/;

export function InlineCardCreator({ boardId, status }: { boardId: string; status: TicketStatus }) {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const createTicket = useTicketStore((s) => s.createTicket);
  const importGitHubIssue = useTicketStore((s) => s.importGitHubIssue);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
    }
  }, [active]);

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setActive(false);
      return;
    }

    // Detect GitHub issue URL
    if (GITHUB_ISSUE_RE.test(trimmed)) {
      setImporting(true);
      try {
        await importGitHubIssue(trimmed, boardId, status);
      } catch (err) {
        console.error('Failed to import GitHub issue:', err);
        // Fallback: create a regular ticket with the URL as title
        await createTicket({ boardId, title: trimmed, status });
      } finally {
        setImporting(false);
      }
    } else {
      await createTicket({ boardId, title: trimmed, status });
    }

    setTitle('');
    setActive(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setTitle('');
      setActive(false);
    }
  };

  const isGitHubUrl = GITHUB_ISSUE_RE.test(title.trim());

  if (!active) {
    return (
      <button
        className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => setActive(true)}
      >
        + Add card
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-2">
      <textarea
        ref={inputRef}
        className="w-full resize-none bg-transparent text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:outline-none"
        rows={2}
        placeholder="Card title or GitHub issue URL..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSubmit}
        disabled={importing}
      />
      {isGitHubUrl && !importing && (
        <div className="flex items-center gap-1.5 pt-1 text-[10px] text-[var(--theme-text-muted)]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--theme-text-secondary)]">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span>Will import from GitHub</span>
        </div>
      )}
      {importing && (
        <div className="flex items-center gap-1.5 pt-1 text-[10px] text-[var(--theme-accent)]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <circle cx="8" cy="8" r="6" strokeDasharray="30" strokeDashoffset="10" />
          </svg>
          <span>Importing from GitHub...</span>
        </div>
      )}
    </div>
  );
}
