import { useCallback, useEffect, useState } from 'react';
import { EMBEDDING_MODELS, DEFAULT_EMBEDDING_MODEL } from '@fleex/shared';
import { Button } from '../ui/Button';
import { useSettingsStore, type AppSettings } from '../../stores/settingsStore';
import {
  benchMemory,
  fetchMemoryStatus,
  reindexMemory,
  type MemoryBenchResult,
  type MemoryStatus,
} from '../../services/api';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

type MemoryEngine = 'legacy' | 'semantic';

type MemoryFeatureKey =
  | 'paletteSearch' | 'ask' | 'repoScope' | 'duplicateDetection' | 'humanFeedbackBoost'
  | 'personaCoach' | 'synthesis' | 'curation' | 'assistantMemory' | 'automationMining' | 'wikiLinks'
  | 'executionTraces' | 'cliSessions';

/**
 * The features that consume the index.
 *
 * `cost` is the honest part. Most of these are local and free; the four that
 * write prose spend a model call each time they run. Saying so next to the switch
 * is what lets someone decide, rather than discovering it on a bill.
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
  {
    key: 'personaCoach',
    label: 'Coach your agents',
    description: 'Proposes amendments to an agent\u2019s memory from the times you corrected it. Always proposed for review, never applied on its own.',
    cost: 'one LLM call per proposal',
  },
  {
    key: 'synthesis',
    label: 'Compile what you know',
    description: 'Builds a sourced reference document about a subject from everything indexed, with contradictions and open questions called out.',
    cost: 'one LLM call per document',
  },
  {
    key: 'curation',
    label: 'Save moments from runs',
    description: 'Lets you lift a paragraph out of an execution and keep it as a note, ranked above the ambient output it came from.',
  },
  {
    key: 'assistantMemory',
    label: 'Remember conversations',
    description: 'Distils each assistant conversation as it ends, so preferences and decisions survive it instead of needing restating.',
    cost: 'one LLM call per conversation',
  },
  {
    key: 'automationMining',
    label: 'Suggest routines',
    description: 'Spots work you keep repeating and proposes a schedule for it. Purely arithmetic over the execution log.',
  },
  {
    key: 'wikiLinks',
    label: 'Link and relate notes',
    description: 'Resolves [[#42]] and [[org/repo]] links in notes, shows what links back, and surfaces notes nobody thought to link.',
  },
  {
    key: 'cliSessions',
    label: 'Remember terminal sessions',
    description: 'Distils `claude` sessions run outside a ticket worktree — the exploratory work Fleex would otherwise never see — and files them under their repository.',
    cost: 'one LLM call per session',
  },
  {
    key: 'executionTraces',
    label: 'Learn from finished runs',
    description: 'Distils what each agent run discovered about the codebase — what worked, what failed, which files mattered — so the next run starts from it.',
    cost: 'one LLM call per run',
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

  const handleShadow = useCallback(async (next: boolean) => {
    setSaving(true);
    try {
      await saveSettings({ ...settings, memoryShadowMode: next });
    } finally {
      setSaving(false);
    }
  }, [settings, saveSettings]);

  const handleReindex = useCallback(async () => {
    await reindexMemory();
    await loadStatus();
  }, [loadStatus]);

  const handleSelectModel = useCallback(async (modelId: string) => {
    setSaving(true);
    try {
      await saveSettings({ ...settings, memoryEmbeddingModel: modelId });
      await loadStatus();
    } finally {
      setSaving(false);
    }
  }, [settings, saveSettings, loadStatus]);

  const handleSelectRuntime = useCallback(async (next: 'transformers' | 'ollama') => {
    setSaving(true);
    try {
      await saveSettings({ ...settings, memoryEmbeddingProvider: next });
      await loadStatus();
    } finally {
      setSaving(false);
    }
  }, [settings, saveSettings, loadStatus]);

  const handleBudget = useCallback(async (chars: number | undefined) => {
    setSaving(true);
    try {
      await saveSettings({ ...settings, memoryInjectionCharBudget: chars });
    } finally {
      setSaving(false);
    }
  }, [settings, saveSettings]);

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

      {/* Only offered under the current engine, because that is the only situation
          it means anything in: it answers "what would switching change", using the
          run in front of you rather than two different runs. */}
      {engine === 'legacy' && status?.available && (
        <label
          className={cn(
            'mt-3 flex items-start gap-2.5 rounded border border-dashed border-[var(--theme-border)] px-3 py-2',
            saving ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--theme-bg-hover)]',
          )}
        >
          <input
            type="checkbox"
            checked={settings.memoryShadowMode === true}
            disabled={saving}
            onChange={(e) => void handleShadow(e.target.checked)}
            className="mt-0.5 flex-shrink-0 accent-[var(--theme-accent)]"
          />
          <span className="min-w-0">
            <span className="text-xs font-medium text-[var(--theme-text-primary)]">
              Show what the semantic engine would have done
            </span>
            <span className="block text-[11px] text-[var(--theme-text-muted)]">
              Every run keeps using the current ranking, and records the semantic engine's choice
              alongside it — visible in the Context tab, marked as not injected. Local and free: one
              embedding and one search per run, no model call. Needs an index, so run a reindex first.
            </span>
          </span>
        </label>
      )}

      {engine === 'semantic' && (
        <EncoderPanel
          settings={settings}
          status={status}
          saving={saving}
          onSelectModel={handleSelectModel}
          onSelectRuntime={handleSelectRuntime}
          onBudget={handleBudget}
        />
      )}

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
          Reindexing walks every ticket, comment thread, deliverable, note, epic, agent memory and skill.
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

      {status?.available && engine === 'semantic' && <BenchPanel />}
    </div>
  );
}

/**
 * Which encoder runs, where it runs, and how much of a prompt memory may take.
 *
 * Switching the model is safe by construction and the copy says so: every chunk
 * records the model that embedded it, retrieval only considers vectors from the
 * configured one, and the sweep re-embeds the rest in the background. So this is a
 * setting, not a migration — which is the whole point, because choosing an encoder
 * from published benchmarks is guesswork and choosing it from `Measure` on the
 * real corpus is not.
 */
function EncoderPanel({
  settings,
  status,
  saving,
  onSelectModel,
  onSelectRuntime,
  onBudget,
}: {
  settings: AppSettings;
  status: MemoryStatus | null;
  saving: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectRuntime: (runtime: 'transformers' | 'ollama') => void;
  onBudget: (chars: number | undefined) => void;
}) {
  const selectedModel = settings.memoryEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL.id;
  const runtime = settings.memoryEmbeddingProvider ?? 'transformers';
  const stale = status?.index?.staleModelChunks ?? 0;
  const [budgetText, setBudgetText] = useState(
    settings.memoryInjectionCharBudget ? String(settings.memoryInjectionCharBudget) : '',
  );

  const commitBudget = () => {
    const trimmed = budgetText.trim();
    if (!trimmed) return onBudget(undefined);
    const parsed = Number.parseInt(trimmed, 10);
    // Out-of-range input reverts rather than being clamped silently: a budget of
    // 12 characters would quietly starve every prompt.
    if (!Number.isFinite(parsed) || parsed < 500 || parsed > 60_000) {
      setBudgetText(settings.memoryInjectionCharBudget ? String(settings.memoryInjectionCharBudget) : '');
      return;
    }
    onBudget(parsed);
  };

  return (
    <div className="mt-6 border-t border-[var(--theme-border)] pt-4">
      <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Encoder</h3>
      <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
        Which model turns text into vectors. All of them are multilingual and run on this machine.
        Changing one takes effect on restart; the index re-embeds itself in the background, so nothing
        has to be rebuilt by hand.
      </p>

      {stale > 0 && (
        <div className={cn('mt-3 rounded px-3 py-2 text-xs', tint('blue'))}>
          {stale} chunk{stale > 1 ? 's' : ''} still carry vectors from the previous model and are
          being re-embedded. They stay findable by keyword meanwhile.
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {EMBEDDING_MODELS.map((model) => {
          const selected = model.id === selectedModel;
          return (
            <button
              key={model.id}
              disabled={saving}
              onClick={() => onSelectModel(model.id)}
              className={cn(
                'w-full text-left rounded border px-3 py-2 transition-colors',
                selected
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
                  : 'border-[var(--theme-border)] bg-transparent hover:bg-[var(--theme-bg-hover)]',
                saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
              )}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    'h-3 w-3 rounded-full border flex-shrink-0',
                    selected
                      ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]'
                      : 'border-[var(--theme-border)]',
                  )}
                />
                <span className="text-xs font-medium text-[var(--theme-text-primary)]">
                  {model.label}
                </span>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-mono', tint('gray'))}>
                  {model.dimensions} dims · {model.sizeMb} MB
                </span>
                {model.default && (
                  <span className="text-[10px] text-[var(--theme-text-faint)]">default</span>
                )}
              </div>
              <p className="mt-0.5 ml-5 text-[11px] text-[var(--theme-text-muted)]">{model.note}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
            Runs on
          </span>
          <div className="mt-1 flex gap-1.5">
            {(['transformers', 'ollama'] as const).map((option) => (
              <button
                key={option}
                disabled={saving}
                onClick={() => onSelectRuntime(option)}
                title={option === 'transformers'
                  ? 'In this process, via ONNX. No daemon, nothing else to run.'
                  : 'A local Ollama daemon on :11434 — much faster with a GPU behind it.'}
                className={cn(
                  'rounded border px-2 py-1 text-[11px] transition-colors',
                  runtime === option
                    ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]'
                    : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                  saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                )}
              >
                {option === 'transformers' ? 'This process' : 'Ollama'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="memoryBudget"
            className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]"
          >
            Injection budget
          </label>
          <div className="mt-1 flex items-center gap-1.5">
            <input
              id="memoryBudget"
              type="text"
              inputMode="numeric"
              value={budgetText}
              disabled={saving}
              placeholder="10000"
              onChange={(e) => setBudgetText(e.target.value)}
              onBlur={commitBudget}
              onKeyDown={(e) => { if (e.key === 'Enter') commitBudget(); }}
              className="w-24 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-2 py-1 text-[11px] font-mono text-[var(--theme-text-primary)]"
            />
            <span className="text-[10px] text-[var(--theme-text-faint)]">characters</span>
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--theme-text-muted)]">
        The ceiling on retrieved memory in one prompt. Higher means more precedent and a longer,
        costlier prompt; the default is 10 000 characters, about 2 500 tokens.
      </p>
    </div>
  );
}

/**
 * How well retrieval actually does on this corpus.
 *
 * The number that matters is not the one on a public leaderboard: a workspace of
 * French tickets and English deliverables is not the distribution those measure.
 * This runs the queries against the real index, which is what tells someone
 * whether to trust the beta with their prompts — so it belongs next to the switch
 * that turns it on, not only in a terminal.
 */
function BenchPanel() {
  const [result, setResult] = useState<MemoryBenchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setFailed(false);
    try {
      setResult(await benchMemory());
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="mt-6 border-t border-[var(--theme-border)] pt-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Retrieval quality</h3>
        <div className="flex-1" />
        <Button variant="secondary" disabled={running} onClick={() => void run()}>
          {running ? 'Measuring…' : result ? 'Measure again' : 'Measure'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-[var(--theme-text-muted)]">
        Runs queries drawn from the index against the index itself and reports how often the right
        source comes back. Local and free — no model call. Switch the encoder, reindex, and compare.
      </p>

      {failed && <p className="mt-2 text-xs text-[var(--theme-danger)]">Could not run the measurement.</p>}

      {result?.reason && (
        <p className={cn('mt-3 rounded px-3 py-2 text-xs', tint('yellow'))}>
          {result.reason === 'empty_index'
            ? 'Nothing indexed yet — reindex first.'
            : result.reason === 'no_cases'
            ? 'The index is too small to draw meaningful queries from.'
            : 'The semantic engine is not available.'}
        </p>
      )}

      {result && !result.reason && (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <Row
            label={`Found in top ${result.report.k}`}
            value={`${Math.round(result.report.recallAtK * 100)}%`}
            hint={`over ${result.report.cases} queries`}
          />
          <Row
            label="Mean reciprocal rank"
            value={result.report.mrr.toFixed(2)}
            hint="1.00 means the answer was always first"
          />
          <Row label="Mean query time" value={`${Math.round(result.meanQueryMs)} ms`} />
          <Row label="Chunks searched" value={String(result.indexedChunks)} />
        </dl>
      )}
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
