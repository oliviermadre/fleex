import { useEffect, useRef, useState } from 'react';
import type { ActionIconType, IconSuggestion } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint } from '../../../lib/tints';
import * as api from '../../../services/api';
import { renderIcon } from '../../sidebar/PinnedIcons';
import { Button } from '../../ui/Button';
import { inferIconType } from './actionModel';
import { AI_TEXT, CODE_INPUT, Chip, SparkIcon, TEXT_INPUT } from './shared';

type Tab = 'ai' | 'library' | 'import';

interface IconPickerProps {
  aiAvailable: boolean;
  label: string;
  command?: string;
  probeCommand?: string;
  current: string;
  onPick: (icon: { icon: string; iconType: ActionIconType }, fromAi: boolean) => void;
  onClose: () => void;
}

/**
 * Inline icon picker: model-picked suggestions from Iconify (plus one generated
 * SVG), a plain library search, or an import. Every SVG is sanitised server-side
 * and stored inline, so a saved icon never needs the network to render.
 */
export function IconPicker({ aiAvailable, label, command, probeCommand, current, onPick, onClose }: IconPickerProps) {
  const [tab, setTab] = useState<Tab>(aiAvailable ? 'ai' : 'library');

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)]">
      <div className="flex items-center gap-0.5 border-b border-[var(--theme-border)] p-1.5" role="tablist">
        {aiAvailable && <TabButton on={tab === 'ai'} onClick={() => setTab('ai')}><SparkIcon size={11} /> AI suggestions</TabButton>}
        <TabButton on={tab === 'library'} onClick={() => setTab('library')}>Library</TabButton>
        <TabButton on={tab === 'import'} onClick={() => setTab('import')}>Import</TabButton>
        <button type="button" className="ml-auto px-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]" aria-label="Close icon picker" onClick={onClose}>✕</button>
      </div>
      <div className="p-3">
        {tab === 'ai' && <AiTab label={label} command={command} probeCommand={probeCommand} current={current} onPick={(svg) => onPick({ icon: svg, iconType: 'svg' }, true)} />}
        {tab === 'library' && <LibraryTab current={current} onPick={(svg) => onPick({ icon: svg, iconType: 'svg' }, false)} />}
        {tab === 'import' && <ImportTab onPick={(icon) => onPick(icon, false)} />}
      </div>
    </div>
  );
}

function TabButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs', on ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IconGrid({ items, current, onPick }: { items: IconSuggestion[]; current: string; onPick: (svg: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {items.map((s) => (
        <button
          key={s.id}
          type="button"
          title={`${s.name} — ${s.source} (${s.license})`}
          aria-label={`Use icon ${s.name}`}
          className={cn(
            'relative flex flex-col items-center gap-1.5 rounded-lg border bg-[var(--theme-bg-surface)] px-1 pb-2 pt-3 text-[var(--theme-text-primary)] hover:border-[var(--theme-accent)]',
            current === s.svg ? 'border-[var(--theme-accent)] ring-1 ring-[var(--theme-accent)]' : 'border-[var(--theme-border)]',
          )}
          onClick={() => onPick(s.svg)}
        >
          <span className={cn('absolute right-1 top-1 rounded px-1 text-[8.5px]', s.source === 'generated' ? tint('purple') : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)]')}>
            {s.source === 'generated' ? 'generated' : s.source}
          </span>
          {renderIcon({ icon: s.svg, iconType: 'svg', label: s.name }, 22)}
          <span className="max-w-full truncate text-[10px] text-[var(--theme-text-muted)]">{s.name}</span>
        </button>
      ))}
    </div>
  );
}

function AiTab({ label, command, probeCommand, current, onPick }: { label: string; command?: string; probeCommand?: string; current: string; onPick: (svg: string) => void }) {
  const [state, setState] = useState<{ loading: boolean; keywords: string[]; items: IconSuggestion[]; error?: string; offline?: boolean }>({ loading: true, keywords: [], items: [] });
  const seen = useRef<string[]>([]);

  const load = async (more: boolean) => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const res = await api.suggestActionIcons({ label: label || command || 'action', command, probeCommand, ...(more ? { exclude: seen.current } : {}) });
      seen.current = [...seen.current, ...res.suggestions.map((s) => s.id)];
      setState({ loading: false, keywords: res.keywords, items: res.suggestions, offline: res.iconifyUnavailable });
    } catch (e) {
      setState({ loading: false, keywords: [], items: [], error: e instanceof Error ? e.message : String(e) });
    }
  };

  // Runs as soon as the picker opens: the point is one click, not two.
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn('flex flex-wrap items-center gap-1.5 text-[11.5px]', AI_TEXT)}>
        <SparkIcon size={12} />
        {state.loading ? 'Haiku is looking for the best icons…' : state.keywords.length ? <>Iconify search: {state.keywords.map((k) => <Chip key={k}>{k}</Chip>)}</> : null}
        {!state.loading && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load(true)}>⟳ More ideas</Button>
        )}
      </div>
      {state.loading ? (
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[72px] animate-pulse rounded-lg bg-[var(--theme-bg-overlay)]" />)}
        </div>
      ) : state.error ? (
        <p className={cn('rounded border px-2 py-1.5 text-xs', tint('red'))}>{state.error}</p>
      ) : (
        <IconGrid items={state.items} current={current} onPick={onPick} />
      )}
      {state.offline && <p className="text-[11px] text-[var(--theme-text-muted)]">Iconify is unreachable — showing a generated icon only.</p>}
      <p className="text-[11px] text-[var(--theme-text-faint)]">
        One click applies. Only keywords are sent to Iconify, never your command. Brand logos (simple-icons) are for personal use.
      </p>
    </div>
  );
}

function LibraryTab({ current, onPick }: { current: string; onPick: (svg: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<IconSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchIconLibrary(query);
        setItems(res.suggestions);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="flex flex-col gap-2.5">
      <input
        className={TEXT_INPUT}
        placeholder="Search Iconify (lucide, simple-icons, tabler)…"
        aria-label="Search icons"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <p className={cn('rounded border px-2 py-1.5 text-xs', tint('red'))}>{error}</p>}
      {loading && <p className="text-[11px] text-[var(--theme-text-muted)]">Searching…</p>}
      {!loading && q.trim() && items.length === 0 && !error && <p className="text-[11px] text-[var(--theme-text-muted)]">No icon found.</p>}
      <IconGrid items={items} current={current} onPick={onPick} />
    </div>
  );
}

function ImportTab({ onPick }: { onPick: (icon: { icon: string; iconType: ActionIconType }) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = async (raw: string) => {
    const inferred = inferIconType(raw);
    if (!inferred) {
      setError('Paste an <svg>, an http(s) URL, an absolute path or a base64 image.');
      return;
    }
    if (inferred.iconType === 'svg') {
      try {
        const { svg } = await api.sanitizeIconSvg(inferred.icon);
        onPick({ icon: svg, iconType: 'svg' });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    onPick(inferred);
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
      reader.onload = () => void apply(String(reader.result));
      reader.readAsText(file);
    } else {
      reader.onload = () => void apply(String(reader.result));
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-[11.5px] font-medium text-[var(--theme-text-secondary)]" htmlFor="icon-import">Paste an SVG or a URL</label>
        <textarea id="icon-import" className={cn(CODE_INPUT, 'min-h-[88px]')} placeholder="<svg …>…</svg>  or  https://…/icon.svg" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button size="sm" variant="secondary" disabled={!value.trim()} onClick={() => void apply(value)}>Use this icon</Button>
        {error && <p className={cn('rounded border px-2 py-1 text-[11px]', tint('red'))}>{error}</p>}
      </div>
      <label
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--theme-border-input)] p-4 text-center text-[11px] text-[var(--theme-text-muted)] hover:border-[var(--theme-accent)]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        Drop a .svg / .png here, or click to choose
        <input type="file" accept=".svg,image/svg+xml,image/png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>
    </div>
  );
}
