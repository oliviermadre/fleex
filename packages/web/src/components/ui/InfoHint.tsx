/**
 * Small filled info icon that surfaces an explanatory tooltip on hover/focus.
 * Used next to the composer execution-bar labels (Mode / Model) to clarify what
 * each control does. Uses a custom CSS tooltip (not the native `title`) so it
 * appears instantly instead of after the browser's ~1s delay.
 *
 * Extracted from TicketComments so every composer surface (ticket comments,
 * mobile, the Work stream) shares one implementation.
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <span className="group/info relative inline-flex">
      <span
        tabIndex={0}
        role="button"
        aria-label={text}
        className="inline-flex cursor-help items-center text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-secondary)] focus:outline-none focus-visible:text-[var(--theme-text-secondary)]"
      >
        <svg className="h-[15px] w-[15px]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9zm1-4.25a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 w-72 max-w-[18rem] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-[var(--theme-text-primary)] opacity-0 shadow-lg transition-opacity duration-75 group-hover/info:opacity-100 group-focus-within/info:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
