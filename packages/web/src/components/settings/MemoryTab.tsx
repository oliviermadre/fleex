import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { useSettingsStore } from '../../stores/settingsStore';
import { fetchMemoryStatus, reindexMemory, type MemoryStatus } from '../../services/api';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

type MemoryEngine = 'legacy' | 'semantic';

const ENGINES: Array<{ key: MemoryEngine; label: string; description: string }> = [
  {
    key: 'legacy',
    label: 'Current (default)',
    description:
      'Ranks past ticket summaries by shared tags, board and recency. What every run has used so far.',
  },
  {
    key: 'semantic',
    label: 'Semantic — beta',
    description:
      'Retrieves by meaning across everything indexed: summaries, comment threads, routine outputs, notes and agent memory. '
      + 'Embeddings run locally, so nothing leaves this machine.',
  },
];

/**
 * Chooses which strategy feeds context into agent prompts.
 *
 * Presented as an explicit opt-in rather than a rollout: the semantic engine
 * needs an index and a downloaded model to be any use, and until it has both it
 * would quietly hand agents less than the current ranking does. Switching is
 * reversible and leaves the index in place, so a user can compare the two on the
 * same work by reading the Context tab of successive runs.
 */
export function MemoryTab() {
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);

  const [engine, setEngine] = useState<MemoryEngine>(settings.memoryEngine ?? 'legacy');
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEngine(settings.memoryEngine ?? 'legacy');
  }, [settings.memoryEngine]);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchMemoryStatus());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSelect = useCallback(async (next: MemoryEngine) => {
    if (next === engine) return;
    setEngine(next);
    setSaving(true);
    try {
      await saveSettings({ ...settings, memoryEngine: next });
      await loadStatus();
    } finally {
      setSaving(false);
    }
  }, [engine, settings, saveSettings, loadStatus]);

  const handleReindex = useCallback(async () => {
    await reindexMemory();
    await loadStatus();
  }, [loadStatus]);

  // A reindex embeds the whole corpus, so poll while it runs rather than leaving
  // the counters frozen at whatever they were when the page loaded.
  useEffect(() => {
    if (!status?.reindexing) return;
    const timer = setInterval(() => void loadStatus(), 3000);
    return () => clearInterval(timer);
  }, [status?.reindexing, loadStatus]);

  const unavailable = status?.available === false;

  return (
    <div className="max-w-2xl">
      <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Context engine</h3>
      <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
        Which strategy selects the context injected into agent prompts. Open the Context tab of any
        execution to see exactly what a run received.
      </p>

      {unavailable && (
        <div className={cn('mt-3 rounded px-3 py-2 text-xs', tint('yellow'))}>
          {status?.reason ?? 'No memory index is available on this storage driver.'}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {ENGINES.map((option) => {
          const selected = engine === option.key;
          const disabled = saving || (option.key === 'semantic' && unavailable);
          return (
            <button
              key={option.key}
              onClick={() => void handleSelect(option.key)}
              disabled={disabled}
              className={cn(
                'w-full text-left rounded border px-3 py-2.5 transition-colors',
                selected
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
                  : 'border-[var(--theme-border)] bg-transparent hover:bg-[var(--theme-bg-hover)]',
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-3 w-3 rounded-full border flex-shrink-0',
                    selected
                      ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]'
                      : 'border-[var(--theme-border)]',
                  )}
                />
                <span className="text-sm font-medium text-[var(--theme-text-primary)]">
                  {option.label}
                </span>
              </div>
              <p className="mt-1 ml-5 text-xs text-[var(--theme-text-muted)]">{option.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-6 border-t border-[var(--theme-border)] pt-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Index</h3>
          <div className="flex-1" />
          <Button variant="secondary" onClick={() => void loadStatus()}>Refresh</Button>
          {status?.available && (
            <Button
              variant="secondary"
              disabled={status.reindexing}
              onClick={() => void handleReindex()}
            >
              {status.reindexing ? 'Reindexing…' : 'Reindex now'}
            </Button>
          )}
        </div>

        <p className="mt-2 text-xs text-[var(--theme-text-muted)]">
          Reindexing walks every ticket, comment thread, deliverable, agent memory and skill.
          It is safe to re-run and resumes where it left off — unchanged content is not re-embedded.
        </p>

        {loadFailed ? (
          <p className="mt-2 text-xs text-[var(--theme-text-muted)]">
            Could not read the memory status.
          </p>
        ) : !status ? (
          <p className="mt-2 text-xs text-[var(--theme-text-faint)]">Loading…</p>
        ) : (
          <IndexSummary status={status} />
        )}
      </div>
    </div>
  );
}

function IndexSummary({ status }: { status: MemoryStatus }) {
  const index = status.index;
  const provider = status.provider;

  return (
    <div className="mt-3 space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <Row label="Chunks indexed" value={index ? String(index.totalChunks) : '—'} />
        <Row
          label="Awaiting embedding"
          value={index ? String(index.pendingEmbeddings) : '—'}
          hint={index && index.pendingEmbeddings > 0
            ? 'Content is indexed but not yet searchable.'
            : undefined}
        />
        <Row label="Embedding model" value={provider?.id ?? 'not configured'} />
        <Row
          label="Model state"
          value={provider ? (provider.ready ? `ready (${provider.dimensions} dims)` : 'not loaded yet') : '—'}
        />
        <Row
          label="Last indexed"
          value={index?.lastIndexedAt ? new Date(index.lastIndexedAt).toLocaleString() : 'never'}
        />
      </dl>

      {index && index.embeddingModels.length > 1 && (
        <div className={cn('rounded px-3 py-2 text-xs', tint('orange'))}>
          More than one embedding model is present in the index. Vectors from different models are not
          comparable, so a reindex is needed before retrieval is trustworthy.
        </div>
      )}

      {index && Object.keys(index.chunksByKind).length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
            By source
          </h4>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries(index.chunksByKind)
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <span key={kind} className={cn('rounded px-2 py-0.5 text-[10px]', tint('gray'))}>
                  {kind.replace(/_/g, ' ')} {count}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[var(--theme-text-muted)]">{label}</dt>
      <dd className="text-[var(--theme-text-primary)] font-mono">{value}</dd>
      {hint && <p className="text-[10px] text-[var(--theme-text-faint)]">{hint}</p>}
    </div>
  );
}
