import { useCallback, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useSettingsStore } from '../../stores/settingsStore';
import { synthesiseMemory, type SynthesisResult } from '../../services/api';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

/**
 * Compiles a reference about a subject from everything indexed.
 *
 * Lives in the Documents library because that is what it produces: not an answer
 * to read once, but a document someone will come back to. The result is shown
 * before it is saved anywhere — a compilation is a snapshot of a moving corpus, so
 * persisting every attempt would fill the library with near-duplicates.
 */
export function CompileMemoryPanel() {
  const enabled = useSettingsStore((s) => s.settings.memoryEngine === 'semantic'
    && s.settings.memoryFeatures?.synthesis !== false);

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCompile = useCallback(async () => {
    const trimmed = subject.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    try {
      setResult(await synthesiseMemory(trimmed));
    } catch {
      setResult({ subject: trimmed, document: null, sources: [], reason: 'synthesis_failed' });
    } finally {
      setLoading(false);
    }
  }, [subject]);

  if (!enabled) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded border border-[var(--theme-border)] bg-transparent px-2.5 py-1 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)] cursor-pointer"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 016.5 22H20V2H6.5A2.5 2.5 0 004 4.5z" />
        </svg>
        Compile a reference
      </button>
    );
  }

  return (
    <div className="rounded border border-[var(--theme-border)] p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id="compileSubject"
            label="Compile what this workspace knows about"
            placeholder="the auth module, our deploy process, why we chose Fastify…"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCompile(); }}
          />
        </div>
        <Button variant="primary" disabled={loading || !subject.trim()} onClick={() => void handleCompile()}>
          {loading ? 'Compiling…' : 'Compile'}
        </Button>
        <Button variant="secondary" onClick={() => { setOpen(false); setResult(null); }}>
          Close
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--theme-text-muted)]">
        Organised by theme, with contradictions and open questions called out. One LLM call.
      </p>

      {result && !result.document && (
        <p className={cn('mt-3 rounded px-3 py-2 text-xs', tint('yellow'))}>
          {result.reason === 'no_results'
            ? `Nothing in memory relates to "${result.subject}".`
            : 'Could not compile a document from what was retrieved.'}
        </p>
      )}

      {result?.document && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
              {result.subject}
            </span>
            <span className="text-[10px] text-[var(--theme-text-faint)]">
              {result.sources.length} source{result.sources.length > 1 ? 's' : ''}
            </span>
            <div className="flex-1" />
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(result.document ?? '')}
            >
              Copy
            </Button>
          </div>
          <pre className="mt-1.5 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-2.5 text-[11px] text-[var(--theme-text-secondary)]">
            {result.document}
          </pre>

          {/* Citations point at numbers, so the numbered list has to be visible or
              the document's own references resolve to nothing. */}
          <ol className="mt-2 space-y-0.5">
            {result.sources.map((snippet, i) => (
              <li key={`${snippet.sourceKind}:${snippet.sourceId}`} className="text-[11px] text-[var(--theme-text-muted)]">
                [{i + 1}] {snippet.title}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
