import { useState, useRef, useEffect } from 'react';
import type { Ticket, TicketStatus } from '@fleex/shared';
import { isSlackMessageUrl } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { computeInheritedAttributes, toCreateFields, toUpdateFields } from './filterInheritance';

const GITHUB_ISSUE_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+\/?$/;

export function InlineCardCreator({ boardId, status }: { boardId: string; status: TicketStatus }) {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const createTicket = useTicketStore((s) => s.createTicket);
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const importGitHubIssue = useTicketStore((s) => s.importGitHubIssue);
  const importSlackMessage = useTicketStore((s) => s.importSlackMessage);
  const filters = useTicketStore((s) => s.filters);
  const selectedEpicIds = useTicketGroupStore((s) => s.selectedEpicIds);
  const addTicketToGroup = useTicketGroupStore((s) => s.addTicketToGroup);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
    }
  }, [active]);

  const handleSubmit = async () => {
    if (submittingRef.current) return;

    const trimmed = title.trim();
    if (!trimmed) {
      setActive(false);
      return;
    }

    submittingRef.current = true;
    setError(null);

    // Inherit any active board filters so the new ticket keeps matching the
    // current filter instead of vanishing (epic membership + priority/type/tag/favorite).
    const inherited = computeInheritedAttributes(filters, selectedEpicIds);

    try {
      // Detect GitHub issue URL or Slack message link
      let ticket: Ticket;
      if (GITHUB_ISSUE_RE.test(trimmed)) {
        setImporting(true);
        ticket = await importGitHubIssue(trimmed, boardId, status);
        // Importers create the ticket without inherited fields — apply them via PATCH.
        const updateFields = toUpdateFields(inherited);
        if (Object.keys(updateFields).length > 0) await updateTicket(ticket.id, updateFields);
      } else if (isSlackMessageUrl(trimmed)) {
        setImporting(true);
        ticket = await importSlackMessage(trimmed, boardId, status);
        const updateFields = toUpdateFields(inherited);
        if (Object.keys(updateFields).length > 0) await updateTicket(ticket.id, updateFields);
      } else {
        // priority/type/tags are applied atomically at creation (no flash);
        // favorite is absent from CreateTicketRequest so it needs a follow-up PATCH.
        ticket = await createTicket({ boardId, title: trimmed, status, ...toCreateFields(inherited) });
        if (inherited.favorite !== undefined) await updateTicket(ticket.id, { favorite: inherited.favorite });
      }

      // Join every active epic so the ticket stays visible under the epic filter.
      for (const epicId of inherited.epicIds) {
        await addTicketToGroup(epicId, ticket.id);
      }

      setTitle('');
      setActive(false);
    } catch (err) {
      console.error('Failed to import from link:', err);
      setError(err instanceof Error ? err.message : 'Failed to import from link');
    } finally {
      setImporting(false);
      submittingRef.current = false;
    }
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
  const isSlackUrl = isSlackMessageUrl(title.trim());

  if (!active) {
    return (
      <button
        className="w-full rounded-md px-3 py-2 text-left text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => setActive(true)}
      >
        + Add card
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-3">
      <textarea
        ref={inputRef}
        className="w-full resize-none bg-transparent text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:outline-none"
        rows={2}
        placeholder="Card title, GitHub issue or Slack message URL..."
        value={title}
        onChange={(e) => { setTitle(e.target.value); setError(null); }}
        onKeyDown={handleKeyDown}
        onBlur={handleSubmit}
        disabled={importing}
      />
      {isGitHubUrl && !importing && !error && (
        <div className="flex items-center gap-1.5 pt-1 text-[10px] text-[var(--theme-text-muted)]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--theme-text-secondary)]">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span>Will import from GitHub</span>
        </div>
      )}
      {isSlackUrl && !isGitHubUrl && !importing && !error && (
        <div className="flex items-center gap-1.5 pt-1 text-[10px] text-[var(--theme-text-muted)]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--theme-text-secondary)]">
            <path d="M3.5 9.5A1.5 1.5 0 1 1 2 8h1.5v1.5zm.75 0A1.5 1.5 0 0 1 5.75 8a1.5 1.5 0 0 1 1.5 1.5v3.75a1.5 1.5 0 1 1-3 0V9.5zM5.75 3.5A1.5 1.5 0 1 1 7.25 2v1.5H5.75zm0 .75a1.5 1.5 0 0 1 0 3H2a1.5 1.5 0 1 1 0-3h3.75zM11.5 5.75A1.5 1.5 0 1 1 13 7.25h-1.5V5.75zm-.75 0a1.5 1.5 0 0 1-1.5 1.5 1.5 1.5 0 0 1-1.5-1.5V2a1.5 1.5 0 1 1 3 0v3.75zM9.25 11.5A1.5 1.5 0 1 1 7.75 13v-1.5h1.5zm0-.75a1.5 1.5 0 0 1 0-3H13a1.5 1.5 0 1 1 0 3H9.25z" />
          </svg>
          <span>Will import &amp; summarize from Slack</span>
        </div>
      )}
      {error && (
        <span className="text-[10px] text-[var(--theme-danger)]">{error}</span>
      )}
      {importing && (
        <div className="flex items-center gap-1.5 pt-1 text-[10px] text-[var(--theme-accent)]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <circle cx="8" cy="8" r="6" strokeDasharray="30" strokeDashoffset="10" />
          </svg>
          <span>{isSlackUrl && !isGitHubUrl ? 'Summarizing Slack thread...' : 'Importing from GitHub...'}</span>
        </div>
      )}
    </div>
  );
}
