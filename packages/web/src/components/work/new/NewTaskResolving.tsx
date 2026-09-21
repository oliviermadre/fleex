import { useEffect, useRef, useState } from 'react';
import { getSource, type ImportPreview, type SourceMatch } from '@fleex/shared';
import { previewImport } from '../../../services/api';
import { useSlackDirect } from './useSlackDirect';

/** How long "Fetching…" stays active before the direct path moves to "summarizing". */
const FETCH_GRACE_MS = 1200;

/**
 * The resolution screen. It calls the preview route for the chosen source and,
 * on success with no duplicate, hands the preview back to prefill the composer.
 * A GitHub (instant) source shows nothing for the first 400 ms — the common case
 * never sees this screen; Slack (slow) shows progress + a chrono immediately.
 * Cancelling or leaving aborts the request so a slow read stops server-side.
 */
export function NewTaskResolving({
  match,
  onResolved,
  onCancel,
  onOpenTicket,
}: {
  match: SourceMatch;
  onResolved: (preview: ImportPreview) => void;
  onCancel: () => void;
  onOpenTicket: (ticketId: string) => void;
}) {
  const descriptor = getSource(match.sourceId);
  const slow = descriptor.resolution === 'slow';
  // `undefined` for the other sources → false: hooks can't be called conditionally.
  const slackDirect = useSlackDirect(match.sourceId === 'slack_message' ? String(match.params['workspace'] ?? '') : undefined);

  const [phase, setPhase] = useState<'pending' | 'duplicate' | 'error'>('pending');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showInstant, setShowInstant] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Direct path only: have we (by estimate) moved past the fetch into the summary?
  const [summarizing, setSummarizing] = useState(false);

  const acRef = useRef<AbortController | null>(null);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  // Kick off (and re-kick on Retry) the preview.
  useEffect(() => {
    const ac = new AbortController();
    acRef.current = ac;
    setPhase('pending');
    setErrorMsg('');
    setSeconds(0);
    previewImport(match.url, ac.signal)
      .then((p) => {
        if (ac.signal.aborted) return;
        if (p.existingTickets.length > 0) {
          setPreview(p);
          setPhase('duplicate');
        } else {
          onResolvedRef.current(p);
        }
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
        setErrorMsg(e instanceof Error ? e.message : 'Import failed');
        setPhase('error');
      });
    return () => ac.abort();
  }, [match.url, attempt]);

  // Instant sources stay invisible for 400 ms so a fast fetch never flashes a screen.
  useEffect(() => {
    if (slow) return;
    const t = setTimeout(() => setShowInstant(true), 400);
    return () => clearTimeout(t);
  }, [slow]);

  // Client-side chrono while the read runs.
  useEffect(() => {
    if (phase !== 'pending') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // The preview is ONE opaque request (fetch + summary), with no server-side
  // progress to read. On the direct path the fetch — one conversations.replies
  // plus a few parallel users.info — is reliably sub-second, so leaving "Fetching…"
  // active for the whole request wrongly reads as a multi-second fetch (the seconds
  // are the summary). Model the switch to "summarizing" after a short grace. This is
  // an estimate of the known timing shape, not a measurement. The fallback (Claude
  // reads Slack through MCP) fuses fetch + summary in one loop, so it keeps a single
  // active line and is left as-is.
  useEffect(() => {
    setSummarizing(false);
    if (!(phase === 'pending' && slow && slackDirect)) return;
    const t = setTimeout(() => setSummarizing(true), FETCH_GRACE_MS);
    return () => clearTimeout(t);
  }, [phase, slow, slackDirect, attempt]);

  function cancel() {
    acRef.current?.abort();
    onCancel();
  }

  // Esc cancels from anywhere on this screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Instant + still pending + within the 400 ms grace: render nothing, so the
  // ENTRY kept mounted behind us (disabled) stays visible instead of a blank
  // flash. Once we do render, our opaque overlay covers it.
  if (phase === 'pending' && !slow && !showInstant) return null;

  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto bg-[var(--theme-bg-base)] p-6">
      <div className="w-full max-w-2xl rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
        <div className="mb-3 text-[12px] text-[var(--theme-text-secondary)]">
          ◆ {descriptor.name} · <span className="font-mono">{match.display}</span>
        </div>

        {phase === 'pending' && !slow && (
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[var(--theme-text-primary)]">Fetching {match.display}…</span>
            <button
              type="button"
              onClick={cancel}
              className="ml-auto rounded-md px-3 py-1 text-[12px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
            >
              Cancel
            </button>
          </div>
        )}

        {phase === 'pending' && slow && (
          <div className="flex flex-col gap-1.5">
            <StepLine state="done">Link recognized</StepLine>
            {slackDirect ? (
              <>
                <StepLine state={summarizing ? 'done' : 'active'}>
                  {summarizing ? 'Conversation fetched' : 'Fetching the conversation from Slack…'}
                  {!summarizing && <Chrono seconds={seconds} />}
                </StepLine>
                <StepLine state={summarizing ? 'active' : 'todo'}>
                  {summarizing ? 'Claude is writing the summary…' : 'Claude writes the summary'}
                  {summarizing && <Chrono seconds={seconds} />}
                </StepLine>
              </>
            ) : (
              <>
                <StepLine state="active">
                  Claude is reading the conversation…
                  <Chrono seconds={seconds} />
                </StepLine>
                <StepLine state="todo">Writing the summary</StepLine>
              </>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-[var(--theme-text-faint)]">{slackDirect ? 'Usually takes a few seconds.' : 'Usually takes 10–40 s.'} Only the summary is kept.</span>
              <button
                type="button"
                onClick={cancel}
                className="ml-auto rounded-md px-3 py-1 text-[12px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === 'duplicate' && preview && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] text-[var(--theme-text-secondary)]">Already imported:</span>
            {preview.existingTickets.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-[12px]">
                <button
                  type="button"
                  onClick={() => onOpenTicket(t.id)}
                  className="truncate text-left text-[var(--theme-text-primary)] hover:underline"
                >
                  #{t.displayId} “{t.title}” ({t.status}{t.archived ? ', archived' : ''})
                </button>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onResolvedRef.current(preview)}
                className="rounded-md bg-[var(--theme-accent)] px-3 py-1 text-[12px] font-medium text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]"
              >
                Import anyway
              </button>
              <button
                type="button"
                onClick={cancel}
                className="ml-auto rounded-md px-3 py-1 text-[12px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] text-[var(--theme-text-primary)]">{errorMsg}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="rounded-md bg-[var(--theme-accent)] px-3 py-1 text-[12px] font-medium text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="ml-auto rounded-md px-3 py-1 text-[12px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepLine({ state, children }: { state: 'done' | 'active' | 'todo'; children: React.ReactNode }) {
  const glyph = state === 'done' ? '✓' : state === 'active' ? '◌' : '·';
  const tone =
    state === 'todo' ? 'text-[var(--theme-text-faint)]' : 'text-[var(--theme-text-secondary)]';
  return (
    <div className={`flex items-center gap-2 text-[12px] ${tone}`}>
      <span aria-hidden>{glyph}</span>
      {children}
    </div>
  );
}

function Chrono({ seconds }: { seconds: number }) {
  return <span className="ml-auto font-mono text-[11px] text-[var(--theme-text-faint)]">{formatChrono(seconds)}</span>;
}

function formatChrono(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
