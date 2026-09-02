import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { useSettingsStore } from '../../stores/settingsStore';
import { fetchAutomationCandidates, type AutomationCandidate } from '../../services/api';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

/**
 * Work you keep doing by hand that a routine could do.
 *
 * Shown in the routines sidebar because that is where the answer belongs: the
 * suggestion is only useful next to the button that acts on it. Collapsed by
 * default — an unsolicited list of things you should automate is nagging, and the
 * count in the header is enough to make it discoverable.
 *
 * The rationale is always shown in full. "Run 11 times, about every 27h" is a
 * checkable fact, and it is what justifies acting; a bare "consider automating
 * this" would be advice with nothing behind it.
 */
export function AutomationSuggestions({ onCreate }: { onCreate?: (candidate: AutomationCandidate) => void }) {
  const enabled = useSettingsStore((s) => s.settings.memoryEngine === 'semantic'
    && s.settings.memoryFeatures?.automationMining !== false);

  const [candidates, setCandidates] = useState<AutomationCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCandidates(await fetchAutomationCandidates());
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled || candidates.length === 0) return null;

  return (
    <div className="border-t border-[var(--theme-border)] px-3 py-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent text-left"
      >
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
          Could be a routine
        </span>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', tint('yellow'))}>
          {candidates.length}
        </span>
        <div className="flex-1" />
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={cn('text-[var(--theme-text-muted)] transition-transform', open && 'rotate-180')}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {candidates.map((candidate) => (
            <div
              key={candidate.key}
              className="rounded border border-[var(--theme-border)] px-2 py-1.5"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-[var(--theme-text-primary)] truncate">
                  {candidate.label}
                </span>
                <span className="text-[10px] text-[var(--theme-text-faint)]">{candidate.kind}</span>
                {candidate.totalCostUsd > 0 && (
                  <span className="text-[10px] font-mono text-[var(--theme-text-faint)]">
                    ${candidate.totalCostUsd.toFixed(2)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--theme-text-muted)]">
                {candidate.rationale}
              </p>
              {candidate.suggestedCron && (
                <p className="mt-0.5 font-mono text-[10px] text-[var(--theme-text-faint)]">
                  {candidate.suggestedCron}
                </p>
              )}
              {onCreate && (
                <div className="mt-1.5">
                  <Button variant="secondary" onClick={() => onCreate(candidate)}>
                    Create routine
                  </Button>
                </div>
              )}
            </div>
          ))}
          <Button variant="secondary" disabled={loading} onClick={() => void load()}>
            {loading ? 'Checking…' : 'Refresh'}
          </Button>
        </div>
      )}
    </div>
  );
}
