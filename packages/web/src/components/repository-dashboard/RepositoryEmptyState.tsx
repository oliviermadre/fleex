export function RepositoryEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[var(--theme-text-muted)]">
      <svg width="48" height="48" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" className="text-[var(--theme-text-faint)]">
        <circle cx="5" cy="3.5" r="1.5" />
        <circle cx="11" cy="3.5" r="1.5" />
        <circle cx="8" cy="12.5" r="1.5" />
        <line x1="5" y1="5" x2="5" y2="7" />
        <line x1="11" y1="5" x2="11" y2="7" />
        <path d="M5 7c0 1.5 1.5 2.5 3 4M11 7c0 1.5-1.5 2.5-3 4" />
      </svg>
      <p className="text-sm">Select a repository from the sidebar</p>
    </div>
  );
}
