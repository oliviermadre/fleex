import { useEffect, useState } from 'react';
import { diagnoseRun, type ActionRun } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { usePinnedActionsStore } from '../../stores/pinnedActionsStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RunMark } from './PinnedActionButton';
import { runDuration } from './actionStatus';
import { RunHintCard } from './RunHintCard';

const EMPTY: ActionRun[] = [];

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
                <span className="block truncate">{run.label}</span>
                <span className="block text-[10.5px] text-[var(--theme-text-muted)]">
                  {when(run.startedAt)} · {run.finishedAt ? runDuration(run.startedAt, run.finishedAt) : 'running'}
                  {run.finishedAt && ` · ${run.timedOut ? 'timeout' : `exit ${run.exitCode ?? '—'}`}`}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="overflow-y-auto p-4">
          {selected ? <RunDetail run={selected} /> : null}
        </div>
      </div>
    </Modal>
  );
}

function RunDetail({ run }: { run: ActionRun }) {
  const hint = run.finishedAt ? diagnoseRun(run) : null;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1">
        <dt className="text-[var(--theme-text-muted)]">Command</dt>
        <dd className="break-all font-mono text-[var(--theme-text-primary)]">{run.command}</dd>
        <dt className="text-[var(--theme-text-muted)]">Exit</dt>
        <dd>{run.finishedAt ? (run.timedOut ? 'timed out' : run.exitCode ?? 'gateway error') : 'running…'}</dd>
        <dt className="text-[var(--theme-text-muted)]">Started</dt>
        <dd>{new Date(run.startedAt).toLocaleString()}</dd>
        {run.finishedAt && (
          <>
            <dt className="text-[var(--theme-text-muted)]">Duration</dt>
            <dd>{runDuration(run.startedAt, run.finishedAt)}</dd>
          </>
        )}
      </dl>
      {hint && <RunHintCard hint={hint} />}
      <OutputBlock title="stdout" text={run.stdout} />
      <OutputBlock title="stderr" text={run.stderr} />
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
