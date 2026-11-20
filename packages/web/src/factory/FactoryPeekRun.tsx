import { EXECUTION_STATES } from '@fleex/shared';
import { AgentEventStream } from '../components/main-panel/AgentEventStream';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { FloatingPortal, usePopover } from '../hooks/usePopover';
import { useTerminateExecution } from '../hooks/useTerminateExecution';
import { formatDuration } from '../lib/formatDuration';
import { useNow } from '../lib/useNow';
import { cn } from '../lib/cn';
import { tintText } from '../lib/tints';
import type { FactoryRun } from './types';
import type { TicketRuns } from './useTicketRuns';

const live = (r: FactoryRun) => r.status === 'running';

export function runLabel(r: FactoryRun): string {
  if (r.status === 'running') return r.executionId ? 'running' : 'starting…';
  if (r.status === 'completed') return r.outcome ? `ran · ${r.outcome}` : 'ran';
  if (r.status === 'needs_review') return 'ran · to review';
  if (r.status === 'question') return 'asked';
  return r.status;
}
export const runTone = (r: FactoryRun | null): string =>
  !r || r.status === 'completed' || r.status === 'needs_review' ? 'text-[var(--theme-text-muted)]'
    : r.status === 'failed' ? tintText('red')
    : r.status === 'interrupted' || r.status === 'question' ? tintText('yellow')
    : 'text-[var(--theme-accent)]';

/** The little dot of the Run tab and of the picker: pulsing while it runs, red when it failed, grey otherwise. */
export function RunDot({ run, starting = false }: { run: FactoryRun | null; starting?: boolean }) {
  const color = starting || (run && live(run)) ? 'bg-[var(--theme-accent)] animate-pulse motion-reduce:animate-none'
    : run?.status === 'failed' ? 'bg-[var(--theme-danger)]' : 'bg-[var(--theme-text-faint)]';
  return <span aria-hidden className={cn('h-1.5 w-1.5 flex-none rounded-full', color)} />;
}

function StopButton({ executionId }: { executionId: string }) {
  const { state, terminate } = useTerminateExecution(executionId);
  if (state === EXECUTION_STATES.DONE) return <span className="text-[11px] font-semibold text-[var(--theme-text-muted)]">Stopped</span>;
  const armed = state === EXECUTION_STATES.CONFIRMING;
  return (
    <Button size="sm" variant={armed ? 'danger' : 'ghost'} className={cn(!armed && tintText('red'))} disabled={state === EXECUTION_STATES.TERMINATING}
      onClick={() => void terminate()} title="Stop the agent (two clicks)">
      {armed ? 'Confirm stop?' : state === EXECUTION_STATES.TERMINATING ? 'Stopping…' : state === EXECUTION_STATES.ERROR ? 'Failed' : 'Stop'}
    </Button>
  );
}

function RunPicker({ runs, shown, onPick }: { runs: readonly FactoryRun[]; shown: FactoryRun; onPick: (id: string) => void }) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'bottom-end', maxHeight: 280 });
  const at = runs.findIndex((r) => r.id === shown.id);
  return (
    <>
      <button ref={refs.setReference} {...getReferenceProps()} type="button" title="The other runs of this ticket"
        className="ml-auto flex-none rounded-md border border-[var(--theme-border)] px-1.5 text-[11px] text-[var(--theme-text-muted)] hover:border-[var(--theme-accent)] hover:text-[var(--theme-text-primary)]">
        run {at < 0 ? '–' : at + 1}/{runs.length} ▾
      </button>
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}
            className="z-50 w-64 overflow-y-auto rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-1 shadow-xl">
            {[...runs].reverse().map((r) => (
              <button key={r.id} type="button" role="menuitem" onClick={() => { onPick(r.id); setOpen(false); }}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-[var(--theme-bg-overlay)]', r.id === shown.id && 'bg-[var(--theme-accent-muted)]')}>
                <RunDot run={r} />
                <span className="truncate text-[var(--theme-text-primary)]">{r.machineName}</span>
                <span className={cn('truncate', runTone(r))}>{runLabel(r)}</span>
                <span className="ml-auto flex-none font-mono text-[10.5px] text-[var(--theme-text-faint)]">{r.startedAt.slice(11, 16)}</span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * The Run side of the peek card: which station ran the ticket and how it went, then the agent's log itself, live.
 * `shown` is the run on screen; `next` is a newer run the ticket went on to, offered rather than switched to, so
 * what is being read is not swapped from under the reader.
 */
export function FactoryPeekRun({ runs, shown, next, onPick, onPopOut, onOpen }: {
  runs: TicketRuns; shown: FactoryRun | null; next: FactoryRun | null;
  onPick: (id: string) => void; onPopOut?: (executionId: string, title: string) => void; onOpen: () => void;
}) {
  const now = useNow();
  if (!shown) return <div className="flex flex-1 items-center justify-center py-6"><Spinner /></div>;
  const end = shown.finishedAt ?? (live(shown) ? new Date(now).toISOString() : null);
  const cost = shown.executionId ? runs.cost[shown.executionId] : undefined;
  const meta = [end && formatDuration(shown.startedAt, end), cost ? `$${cost.toFixed(2)}` : null].filter(Boolean);
  const title = `${shown.machineName} · execution log`;
  return (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-[var(--theme-border)] px-2.5 py-1.5 text-[11.5px]">
        <span aria-hidden className="text-[var(--tint-purple-text)]">⌬</span>
        <span className="truncate font-semibold text-[var(--theme-text-secondary)]">{shown.machineName} · {shown.executor}</span>
        <span className={cn('flex flex-none items-center gap-1 font-semibold', runTone(shown))}>{live(shown) && <RunDot run={shown} />}{runLabel(shown)}</span>
        {meta.length > 0 && <span className="flex-none font-mono text-[10.5px] text-[var(--theme-text-faint)]">{meta.join(' · ')}</span>}
        {runs.list.length > 1 && <RunPicker runs={runs.list} shown={shown} onPick={onPick} />}
      </div>
      {next && (
        <div role="status" className="flex flex-none items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-accent-muted)] px-2.5 py-1.5 text-[11.5px] text-[var(--theme-text-primary)]">
          <span className="min-w-0 flex-1 truncate">The ticket moved on: <b>{next.machineName}</b> runs it now.</span>
          <Button size="sm" variant="primary" onClick={() => onPick(next.id)}>Follow →</Button>
        </div>
      )}
      <div className="flex min-h-[200px] flex-1 flex-col overflow-hidden">
        {shown.executionId ? <AgentEventStream key={shown.executionId} executionId={shown.executionId} />
          : <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-[var(--theme-text-muted)]"><Spinner />Starting…</div>}
      </div>
      <div className="flex flex-none items-center gap-1.5 border-t border-[var(--theme-border)] p-2">
        {shown.executionId && live(shown) && <StopButton key={shown.executionId} executionId={shown.executionId} />}
        {shown.executionId && onPopOut && <Button size="sm" variant="ghost" onClick={() => onPopOut(shown.executionId!, title)} title="Open the log in a panel you can move and resize">⤢ Pop out</Button>}
        <Button size="sm" variant="primary" className="ml-auto" onClick={onOpen} title="The whole ticket (also Enter, V, or a double-click)">Open</Button>
      </div>
    </>
  );
}
