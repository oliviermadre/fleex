export function AgentEmptyState() {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-[var(--theme-bg-primary)]">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--theme-text-faint)]"
        >
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
        <div>
          <h3 className="text-base font-semibold text-[var(--theme-text-primary)]">
            No Agent Selected
          </h3>
          <p className="mt-2 text-sm text-[var(--theme-text-muted)]">
            Select an agent persona from the list, or create a new one.
          </p>
        </div>
      </div>
    </div>
  );
}
