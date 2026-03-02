import { useState, useRef, useEffect } from 'react';
import { useTicketStore } from '../../stores/ticketStore';
import { cn } from '../../lib/cn';

export function SearchToggle() {
  const searchQuery = useTicketStore((s) => s.searchQuery);
  const setSearchQuery = useTicketStore((s) => s.setSearchQuery);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const handleBlur = () => {
    if (!searchQuery) {
      setExpanded(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (searchQuery) {
        setSearchQuery('');
      } else {
        setExpanded(false);
      }
      inputRef.current?.blur();
    }
  };

  if (!expanded) {
    return (
      <button
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
          searchQuery
            ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
            : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
        )}
        onClick={() => setExpanded(true)}
        title="Search tickets"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
      </button>
    );
  }

  return (
    <div className="relative flex items-center">
      <svg
        className="absolute left-2.5 text-[var(--theme-accent)]"
        width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      >
        <circle cx="7" cy="7" r="5" />
        <line x1="10.5" y1="10.5" x2="14" y2="14" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        className="h-7 w-48 rounded-md border border-[var(--theme-accent)] bg-[var(--theme-bg-surface)] py-1 pl-8 pr-2 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:outline-none"
        placeholder="Search tickets..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
