import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { fetchSimilarTickets, type SimilarTicketCandidate } from '../../services/api';
import { ticketLink } from '../../notifications/links';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

/** Below this, a title is too generic for a similarity warning to mean anything. */
const MIN_TITLE_LENGTH = 8;

/** Long enough that a search does not fire on every keystroke. */
const DEBOUNCE_MS = 400;

/**
 * Warns that a ticket like this may already exist, while the title is being typed.
 *
 * Deliberately a hint and never a block: the check is a similarity score, so it
 * is sometimes wrong, and the cost of a false positive must be zero. It offers
 * the existing tickets as links and says nothing else — deciding they are the
 * same thing is the reader's call, not the tool's.
 */
export function SimilarTicketsHint({ title }: { title: string }) {
  const enabled = useSettingsStore((s) => s.settings.memoryEngine === 'semantic'
    && s.settings.memoryFeatures?.duplicateDetection !== false);
  const [candidates, setCandidates] = useState<SimilarTicketCandidate[]>([]);

  const trimmed = title.trim();
  const shouldCheck = enabled && trimmed.length >= MIN_TITLE_LENGTH;

  useEffect(() => {
    if (!shouldCheck) {
      setCandidates([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await fetchSimilarTickets(trimmed);
        // A slower earlier request must not overwrite a newer title's result.
        if (!cancelled) setCandidates(found);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shouldCheck, trimmed]);

  if (candidates.length === 0) return null;

  return (
    <div className={cn('absolute left-0 top-10 z-20 w-80 rounded-md border p-2 shadow-lg', tint('yellow'))}>
      <p className="text-[10px] font-semibold uppercase tracking-wider">
        {candidates.length === 1 ? 'A similar ticket exists' : 'Similar tickets exist'}
      </p>
      <ul className="mt-1.5 space-y-1">
        {candidates.map((candidate) => (
          <li key={candidate.ticketId}>
            <a
              href={ticketLink(candidate.ticketId)}
              className="block truncate text-xs text-[var(--theme-text-primary)] hover:underline"
              title={candidate.excerpt}
            >
              {candidate.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
