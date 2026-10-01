import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { diagnoseRun, runSlotKey, type ActionRun } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';
import { useNow } from '../../lib/useNow';
import { usePinnedActionsStore, type LiveOutput } from '../../stores/pinnedActionsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RunMark } from './PinnedActionButton';
import { runDuration } from './actionStatus';
import { RunHintCard } from './RunHintCard';

const EMPTY: ActionRun[] = [];

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "12 s", "3 min 05 s" — how long a run in flight has been going. */
export function elapsedLabel(startedAt: string, now: number): string {
  const sec = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (sec < 60) return `${sec} s`;
  return `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s`;
}

/** The last runs of one action: list on the left, command / exit / stdout / stderr on the right. */
export function ActionLogsModal() {
  const logs = usePinnedActionsStore((s) => s.logs);
  const runs = usePinnedActionsStore((s) => (logs ? s.runs[logs.sourceId] ?? EMPTY : EMPTY));
  const closeLogs = usePinnedActionsStore((s) => s.closeLogs);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  useEffect(() => setSelectedId(logs?.runId), [logs]);

  const selected = runs.find((r) => r.runId === selectedId) ?? runs[0];

  return (
    <Modal open={!!logs} onClose={closeLogs} maxWidth="max-w-4xl" className="p-0">
      <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Logs — {logs?.label}</h2>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={closeLogs} aria-label="Close logs">✕</Button>
      </div>
      <div className="grid h-[480px] grid-cols-[220px_1fr]">
        <div className="overflow-y-auto border-r border-[var(--theme-border)] p-1.5">
          {runs.length === 0 && <p className="p-3 text-xs text-[var(--theme-text-muted)]">No run yet.</p>}
          {runs.map((run) => (
            <button
              key={run.runId}
              type="button"
              className={cn(
                'grid w-full grid-cols-[14px_1fr] gap-2 rounded px-2 py-1.5 text-left text-xs',
                run === selected ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
              )}
              onClick={() => setSelectedId(run.runId)}
            >
              {run.finishedAt ? <RunMark run={run} /> : <span className="animate-pulse">…</span>}
              <span className="min-w-0">
                <span className="block truncate">{run.label}{run.mode === 'terminal' && <span className="text-[var(--theme-text-muted)]"> · ⧉</span>}</span>
                <span className="block text-[10.5px] text-[var(--theme-text-muted)]">
                  {when(run.startedAt)} · {run.finishedAt ? runDuration(run.startedAt, run.finishedAt) : 'running'}
                  {run.finishedAt && ` · ${run.cancelled ? 'stopped' : run.timedOut ? 'timeout' : `exit ${run.exitCode ?? '—'}`}`}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="overflow-y-auto p-4">
          {selected ? <RunDetail key={selected.runId} run={selected} /> : null}
        </div>
      </div>
    </Modal>
  );
}

function RunDetail({ run }: { run: ActionRun }) {
  const running = !run.finishedAt;
  const hint = running ? null : diagnoseRun(run);
  const live = usePinnedActionsStore((s) => s.liveOutput[run.runId]);
  const liveCapable = usePinnedActionsStore((s) => s.capabilities?.liveOutput);
  const tabKey = usePinnedActionsStore((s) => s.terminals.find((t) => t.runId === run.runId)?.key);
  const { cancelRun, rerunInTerminal, closeLogs, focusTerminal, openTerminal } = usePinnedActionsStore.getState();
  const terminal = run.mode === 'terminal';

  const showTerminal = () => {
    if (tabKey) focusTerminal(tabKey);
    else openTerminal({ key: runSlotKey(run.sourceId, run.slot), sourceId: run.sourceId, sourceKind: run.sourceKind, runId: run.runId, label: run.label, command: run.command });
    closeLogs();
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1">
        <dt className="text-[var(--theme-text-muted)]">Command</dt>
        <dd className="break-all font-mono text-[var(--theme-text-primary)]">{run.command}</dd>
        <dt className="text-[var(--theme-text-muted)]">Exit</dt>
        <dd>
          {running ? (
            <span className="flex items-center gap-2">
              <RunningBadge startedAt={run.startedAt} />
              <Button size="sm" variant="danger" className="px-2 py-0 text-[10.5px]" onClick={() => void cancelRun(run.runId)}>Stop</Button>
            </span>
          ) : run.cancelled ? 'stopped' : run.timedOut ? 'timed out' : run.exitCode ?? 'gateway error'}
        </dd>
        <dt className="text-[var(--theme-text-muted)]">Started</dt>
        <dd>{new Date(run.startedAt).toLocaleString()}</dd>
        {run.finishedAt && (
          <>
            <dt className="text-[var(--theme-text-muted)]">Duration</dt>
            <dd>{runDuration(run.startedAt, run.finishedAt)}</dd>
          </>
        )}
      </dl>
      {hint && (
        <RunHintCard
          hint={hint}
          onRunInTerminal={() => {
            closeLogs();
            void rerunInTerminal(run);
          }}
          onAlwaysTerminal={() => {
            closeLogs();
            void useSettingsStore.getState().alwaysRunInTerminal(run);
          }}
        />
      )}
      {terminal && (
        <p className="text-[11px] text-[var(--theme-text-muted)]">
          Terminal output: stdout and stderr are mixed.
          {running && (
            <Button variant="ghost" size="sm" className="ml-1 px-1.5 py-0 text-[10.5px]" onClick={showTerminal}>Show the terminal</Button>
          )}
        </p>
      )}
      {running && !terminal ? (
        liveCapable === false || run.liveUnavailable ? (
          <p role="note" className={cn('rounded-md px-2.5 py-2 text-[11.5px]', tint('yellow'))}>
            Live output unavailable — restart the gateway to enable it.
          </p>
        ) : (
          <LiveOutputBlock live={live} />
        )
      ) : running ? null : (
        <>
          <OutputBlock title={terminal ? 'output' : 'stdout'} text={run.stdout} />
          {(!terminal || run.stderr) && <OutputBlock title="stderr" text={run.stderr} />}
        </>
      )}
    </div>
  );
}

export function RunningBadge({ startedAt, format = elapsedLabel }: { startedAt: string; format?: (startedAt: string, now: number) => string }) {
  const now = useNow();
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', tintText('blue'))} role="status">
      <span className="animate-pulse motion-reduce:animate-none">●</span> running · {format(startedAt, now)}
    </span>
  );
}

/** Live stdout+stderr: follows the tail until the user scrolls up; "↓ Follow" resumes. */
export function LiveOutputBlock({ live }: { live: LiveOutput | undefined }) {
  const ref = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);
  const text = live?.text ?? '';

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [text, follow]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-[var(--theme-text-secondary)]">
        Live output <span className="font-normal text-[var(--theme-text-muted)]">stdout + stderr</span>
        {!follow && (
          <Button variant="ghost" size="sm" className="ml-auto px-1.5 py-0 text-[10.5px]" onClick={() => setFollow(true)}>↓ Follow</Button>
        )}
      </div>
      {!!live?.dropped && (
        <p className="mb-1 text-[10.5px] text-[var(--theme-text-muted)]">… {live.dropped} bytes not shown live (see the final log)</p>
      )}
      <pre
        ref={ref}
        data-testid="live-output"
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 8);
        }}
        className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2.5 font-mono text-[11px] leading-snug text-[var(--theme-text-secondary)]"
      >
        {text || 'Waiting for output…'}
      </pre>
    </div>
  );
}

function OutputBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-[var(--theme-text-secondary)]">
        {title}
        <Button variant="ghost" size="sm" className="px-1.5 py-0 text-[10.5px]" onClick={() => void navigator.clipboard?.writeText(text)} disabled={!text}>
          Copy
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2.5 font-mono text-[11px] leading-snug text-[var(--theme-text-secondary)]">
        {text || '(empty)'}
      </pre>
    </div>
  );
}
