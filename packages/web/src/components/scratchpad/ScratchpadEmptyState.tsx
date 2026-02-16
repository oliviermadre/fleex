export function ScratchpadEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--theme-text-faint)]">
      <svg className="w-10 h-10 opacity-40" viewBox="0 0 16 16" fill="none">
        <path
          d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
      <span className="text-sm">Select a scratchpad from the sidebar</span>
    </div>
  );
}
