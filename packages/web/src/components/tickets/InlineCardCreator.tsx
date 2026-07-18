import { useState, useRef, useEffect } from 'react';
import type { Ticket, TicketStatus } from '@fleex/shared';
import { isSlackMessageUrl } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { computeInheritedAttributes, toCreateFields, toUpdateFields } from './filterInheritance';
import { GitHubIcon } from '../sidebar/icons';

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
          <GitHubIcon size={12} className="text-[var(--theme-text-secondary)]" />
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
