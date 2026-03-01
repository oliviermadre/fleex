import { lazy, Suspense } from 'react';
import { useClaudeConfigStore } from '../../stores/claudeConfigStore';
import { cn } from '../../lib/cn';

const MonacoWrapper = lazy(() => import('./MonacoWrapper'));

export function ClaudeConfigEditor() {
  const selectedFile = useClaudeConfigStore((s) => s.selectedFile);
  const fileLoading = useClaudeConfigStore((s) => s.fileLoading);
  const fileSaving = useClaudeConfigStore((s) => s.fileSaving);
  const fileContent = useClaudeConfigStore((s) => s.fileContent);
  const originalContent = useClaudeConfigStore((s) => s.originalContent);
  const saveFile = useClaudeConfigStore((s) => s.saveFile);

  if (!selectedFile) {
    return <ClaudeConfigEmptyState />;
  }

  const isDirty = fileContent !== originalContent;
  const breadcrumbs = ['~', ...selectedFile.split('/')];

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      {/* Header bar */}
      <div
        className="flex items-center justify-between border-b border-[var(--theme-border)] px-3"
        style={{ height: 'var(--header-height)' }}
      >
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-xs text-[var(--theme-text-muted)] overflow-hidden">
          {breadcrumbs.map((segment, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[var(--theme-text-muted)]">/</span>}
              <span
                className={cn(
                  'truncate',
                  i === breadcrumbs.length - 1 ? 'text-[var(--theme-text-primary)] font-medium' : ''
                )}
              >
                {segment}
              </span>
            </span>
          ))}
          {isDirty && (
            <span className="ml-2 rounded bg-[var(--theme-accent)] px-1.5 py-0.5 text-[10px] font-medium text-white">
              Modified
            </span>
          )}
        </div>

        {/* Save button */}
        <button
          className={cn(
            'rounded px-3 py-1 text-xs font-medium transition-colors',
            isDirty
              ? 'bg-[var(--theme-accent)] text-white hover:opacity-90'
              : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)] cursor-default'
          )}
          disabled={!isDirty || fileSaving}
          onClick={() => saveFile()}
        >
          {fileSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {fileLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--theme-text-muted)]">
            Loading file...
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-[var(--theme-text-muted)]">
                Loading editor...
              </div>
            }
          >
            <MonacoWrapper />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function ClaudeConfigEmptyState() {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-[var(--theme-text-muted)]">
      <svg width="48" height="48" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
        <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z" />
        <polyline points="9,1.5 9,5.5 13,5.5" />
        <line x1="5.5" y1="8.5" x2="10.5" y2="8.5" />
        <line x1="5.5" y1="11" x2="8.5" y2="11" />
      </svg>
      <span className="text-sm">Select a file from the tree to edit</span>
    </div>
  );
}
