import { useState } from 'react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';

export type ErrorFallbackVariant = 'root' | 'view' | 'inline';

interface ErrorFallbackProps {
  error: Error;
  componentStack: string | null;
  errorId: string | null;
  variant: ErrorFallbackVariant;
  /** Remounts the subtree. Absent on the `root` variant — nothing above to keep. */
  onReset: () => void;
}

/**
 * The crash screen.
 *
 * Colour rule: only `--theme-*` variables and `lib/tints.ts` helpers. Raw
 * Tailwind palette classes are a build failure — see
 * `scripts/check-raw-palette.mjs`, a ratchet currently at zero.
 */

function WarningIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={tintText('red')}
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Everything a developer needs, in one clipboard write. */
function buildClipboardText(props: ErrorFallbackProps): string {
  return [
    `errorId: ${props.errorId ?? 'n/a'}`,
    `message: ${props.error.message}`,
    `url: ${typeof window !== 'undefined' ? window.location.href : 'n/a'}`,
    '',
    'stack:',
    props.error.stack ?? '(none)',
    '',
    'componentStack:',
    props.componentStack ?? '(none)',
  ].join('\n');
}

function CopyErrorButton({ props, size = 'sm' }: { props: ErrorFallbackProps; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // Clipboard access is permission-gated and absent in non-secure contexts;
    // a failure here must not crash the crash screen.
    void navigator.clipboard
      ?.writeText(buildClipboardText(props))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <Button variant="secondary" size={size} onClick={copy}>
      {copied ? 'Copied' : 'Copy error'}
    </Button>
  );
}

/** Stack traces are for developers; in production they only leak internals. */
function DevDetails({ error, componentStack }: { error: Error; componentStack: string | null }) {
  if (!import.meta.env.DEV) return null;
  return (
    <pre
      className="max-h-64 w-full max-w-2xl overflow-auto rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 text-left text-[11px] leading-relaxed text-[var(--theme-text-muted)]"
      data-testid="error-dev-details"
    >
      {error.stack ?? error.message}
      {componentStack}
    </pre>
  );
}

function ErrorIdLabel({ errorId }: { errorId: string | null }) {
  if (!errorId) return null;
  return (
    <span className="font-mono text-[11px] text-[var(--theme-text-faint)]" data-testid="error-id">
      {errorId}
    </span>
  );
}

export function ErrorFallback(props: ErrorFallbackProps) {
  const { error, componentStack, errorId, variant, onReset } = props;

  // Compact single-line form — the sidebar column is ~200px wide, a centered
  // hero would be unreadable there.
  if (variant === 'inline') {
    return (
      <div
        role="alert"
        className={cn('m-2 flex flex-col gap-2 rounded-md p-3 text-xs', tint('red'))}
      >
        <div className="flex items-center gap-2">
          <WarningIcon size={14} />
          <span className="font-medium">This panel crashed</span>
        </div>
        <button
          onClick={onReset}
          className="self-start text-[11px] underline underline-offset-2 hover:text-[var(--theme-text-primary)]"
        >
          Retry
        </button>
        <ErrorIdLabel errorId={errorId} />
      </div>
    );
  }

  const isRoot = variant === 'root';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center',
        isRoot && 'h-screen w-screen bg-[var(--theme-bg-base)]',
      )}
    >
      <WarningIcon size={isRoot ? 40 : 32} />

      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">
          {isRoot ? 'Fleex crashed' : 'This view crashed'}
        </h2>
        <p className="text-sm text-[var(--theme-text-muted)]">
          {isRoot
            ? 'Something went wrong at the top level. Reloading usually fixes it.'
            : 'The rest of Fleex is still working — you can navigate elsewhere.'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {isRoot ? (
          <Button variant="primary" size="md" onClick={() => window.location.reload()}>
            Reload Fleex
          </Button>
        ) : (
          <Button variant="primary" size="md" onClick={onReset}>
            Reload this view
          </Button>
        )}
        <CopyErrorButton props={props} size="md" />
      </div>

      <DevDetails error={error} componentStack={componentStack} />
      <ErrorIdLabel errorId={errorId} />
    </div>
  );
}
