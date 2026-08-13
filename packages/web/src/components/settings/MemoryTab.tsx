import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { useSettingsStore } from '../../stores/settingsStore';
import { fetchMemoryStatus, reindexMemory, type MemoryStatus } from '../../services/api';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

type MemoryEngine = 'legacy' | 'semantic';

type MemoryFeatureKey = 'paletteSearch' | 'ask' | 'repoScope' | 'duplicateDetection' | 'humanFeedbackBoost';

/**
 * The features that consume the index.
 *
 * `cost` is the honest part: everything here is local and free except `ask`,
 * which spends an LLM call per question. Saying so next to the switch is what
 * lets someone decide, rather than discovering it on a bill.
 */
const FEATURES: Array<{ key: MemoryFeatureKey; label: string; description: string; cost?: string }> = [
  {
    key: 'paletteSearch',
    label: 'Search in the command palette',
    description: 'Typing something that matches no command searches memory instead.',
  },
  {
    key: 'ask',
    label: 'Answer questions from memory',
    description: 'Enables `fleex memory ask` and the matching assistant tool: a cited answer drawn from past work.',
    cost: 'one LLM call per question',
  },
  {
    key: 'repoScope',
    label: 'Prefer the current repository',
    description: 'Ranks notes and decisions from the repo a ticket is attached to above equally similar material from elsewhere.',
  },
  {
    key: 'duplicateDetection',
    label: 'Warn about similar tickets',
    description: 'While typing a new ticket title, surfaces existing tickets that look like the same thing.',
  },
  {
    key: 'humanFeedbackBoost',
    label: 'Prioritise your corrections',
    description: 'Discussions where you corrected an agent rank above ordinary ones, so the same mistake is less likely to come back.',
  },
];

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

  const handleToggleFeature = useCallback(async (key: MemoryFeatureKey, next: boolean) => {
    setSaving(true);
    try {
      await saveSettings({
        ...settings,
        memoryFeatures: { ...settings.memoryFeatures, [key]: next },
      });
    } finally {
      setSaving(false);
    }
  }, [settings, saveSettings]);

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

      {status?.available && status.provider && !status.provider.installed && (
        <div className={cn('mt-3 rounded px-3 py-2 text-xs', tint('yellow'))}>
          <p>
            Local embeddings need one optional package, which is not installed. Content still gets
            indexed and stays findable by keyword, but retrieval by meaning stays off until it is
            present — the semantic engine falls back to the current ranking meanwhile.
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-[var(--theme-text-primary)]">
            bun add {status.provider.packageName}
          </p>
        </div>
      )}

      {status?.available && status.provider?.installed && !status.provider.ready && (
        <div className={cn('mt-3 rounded px-3 py-2 text-xs', tint('blue'))}>
          The embedding model has not been loaded yet. It is fetched once, on the first indexing run,
          and cached locally — everything after that works offline.
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

      {/* Nested under the engine because none of these mean anything without it:
          shown as read-only rather than hidden when the engine is off, so the
          settings a switch back would restore stay visible. */}
      <div className="mt-6 border-t border-[var(--theme-border)] pt-4">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">
          What uses memory
        </h3>
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          {engine === 'semantic'
            ? 'Turn off anything you would rather not have drawing on the index.'
            : 'These become active when the semantic engine is selected.'}
        </p>

        <div className="mt-3 space-y-1">
          {FEATURES.map((feature) => {
            // Absent means enabled: opting into the engine is already the
            // deliberate choice, so a user disables rather than opting in twice.
            const on = settings.memoryFeatures?.[feature.key] !== false;
            const disabled = saving || engine !== 'semantic';
            return (
              <label
                key={feature.key}
                className={cn(
                  'flex items-start gap-2.5 rounded px-2 py-2 transition-colors',
                  disabled ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--theme-bg-hover)]',
                )}
              >
                <input
                  type="checkbox"
                  checked={on && engine === 'semantic'}
                  disabled={disabled}
                  onChange={(e) => void handleToggleFeature(feature.key, e.target.checked)}
                  className="mt-0.5 flex-shrink-0 accent-[var(--theme-accent)]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-[var(--theme-text-primary)]">
                      {feature.label}
                    </span>
                    {feature.cost && (
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px]', tint('orange'))}>
                        {feature.cost}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-[var(--theme-text-muted)]">
                    {feature.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
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
