/** The ticket browser's empty tab: just a nudge toward the address bar. */
export function NewTabPage() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-[var(--theme-text-muted)]">
      Type a URL in the address bar.
    </div>
  );
}
