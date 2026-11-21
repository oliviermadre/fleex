import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { TagInput } from '../components/ui/TagInput';
import { useFactoryStore } from './factoryStore';
import { FactoryPopup } from './FactoryPopup';
import { TicketToken } from './FactoryTicketMeta';
import { CommitInput, machineKind } from './FactoryMachinePopup';
import { ItemVisits, useItemVisits } from './ItemVisits';
import { SOURCE_LABEL } from './items';
import { SOURCE_FIELDS, type SourceField } from './itemSources';
import { span } from './format';
import { toast } from '../lib/toast';
import type { ItemFields } from './types';

const Head = ({ children }: { children: React.ReactNode }) => <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">{children}</div>;
const Read = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5"><span className="text-xs font-medium text-[var(--theme-text-secondary)]">{label}</span><span className="text-sm text-[var(--theme-text-primary)]">{children}</span></div>
);

/** One of a source's fields, as an input that suits its kind: a text, a list (comma separated), a choice, yes or no. */
export function FieldInput({ f, value, onChange, id }: { f: SourceField; value: ItemFields[string] | undefined; onChange: (v: ItemFields[string] | undefined) => void; id: string }) {
  if (f.kind === 'bool') return (
    <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-xs text-[var(--theme-text-primary)]">
      <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--theme-accent)]" />{f.label}
    </label>
  );
  if (f.kind === 'choice') return <Select id={id} label={f.label} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} options={[{ value: '', label: 'none' }, ...f.choices!.map((c) => ({ value: c, label: c }))]} />;
  const text = Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
  return <CommitInput id={id} label={f.label} value={text} placeholder={f.hint} onCommit={(v) => onChange(f.kind === 'list' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v.trim() || undefined)} />;
}

/**
 * An item, opened (Enter, a double-click, Open): what the Factory keeps of it, and what was done with it.
 *
 * - What every item has, whatever its source, and edited here: its title, who it is from, its link, its text, its
 *   tags (which arms read, as a ticket's). Its source, its key there, its messages and where it stands are read only.
 * - Its source's part: the fields only that source has (a Slack channel, Gmail labels), edited as they suit. Each
 *   source will have its own part here as its connector comes.
 * - The item as the Factory holds it, raw, as JSON.
 * - What the stations it went through answered.
 */
export function FactoryItemPopup({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const store = useFactoryStore();
  const t = store.snapshot?.tickets.find((x) => x.ticketId === itemId) ?? null;
  const machine = t?.machineId ? store.layout?.machines.find((m) => m.id === t.machineId) ?? null : null;
  const runs = useItemVisits(itemId);
  const [text, setText] = useState<string | null>(null);
  if (!t?.item || !t.info) return null;
  const item = t.item, info = t.info, source = SOURCE_LABEL[item.source], own = SOURCE_FIELDS[item.source], fields = item.fields ?? {};
  const now = store.snapshot?.serverTime ?? new Date().toISOString();
  const tags = info.tags.filter((x) => !x.startsWith('source:'));
  const edit = (patch: Parameters<typeof store.editItem>[1]) => void store.editItem(itemId, patch);
  const setField = (k: string, v: ItemFields[string] | undefined) => { const next = { ...fields }; if (v === undefined || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v; edit({ fields: next }); };
  const raw = { id: item ? itemId : '', source: item.source, title: info.title, author: item.author, url: item.url, tags, messages: item.messages, lastActivityAt: item.lastActivityAt, excerpt: item.excerpt, fields, where: machine ? machine.name || machineKind(machine) : null, phase: t.phase };

  const bar = (
    <>
      <TicketToken info={info} size={22} />
      <span className="min-w-0 flex-1 truncate text-sm"><b className="text-[var(--theme-text-primary)]">{info.title}</b><span className="ml-2 text-xs text-[var(--theme-text-muted)]">{source} item</span></span>
      {item.url && <Button size="sm" variant="secondary" onClick={() => window.open(item.url!, '_blank', 'noopener')}>Open in {source}</Button>}
      <Button size="sm" variant="ghost" onClick={() => { void store.archiveItem(itemId); onClose(); }} title="Junk, or done with: it leaves the floor. A new entry from its source brings it back">Archive</Button>
    </>
  );
  return (
    <FactoryPopup label="Item" onClose={onClose} bar={bar} size="large" maxWidth="max-w-5xl">
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[var(--theme-border)] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:divide-x lg:divide-y-0 lg:overflow-hidden">
        <div className="flex flex-col gap-3 p-4 lg:overflow-y-auto">
          <Head>Every item</Head>
          <CommitInput id="i-title" label="Title" value={info.title} onCommit={(v) => { if (v.trim()) edit({ title: v }); }} />
          <div className="grid grid-cols-2 gap-2">
            <CommitInput id="i-author" label="From" value={item.author} onCommit={(v) => edit({ author: v })} />
            <CommitInput id="i-url" label="Link" value={item.url ?? ''} placeholder="https://…" onCommit={(v) => edit({ url: v.trim() || null })} />
          </div>
          <TagInput label="Tags" tags={tags} onChange={(next) => edit({ tags: next })} placeholder="a tag, or key:value" helperText={`Arms read them, as a ticket's; source:${item.source} is always there.`} />
          <div className="flex flex-col gap-1">
            <label htmlFor="i-text" className="text-xs font-medium text-[var(--theme-text-secondary)]">Text</label>
            <textarea id="i-text" value={text ?? item.excerpt} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== null && text !== item.excerpt) edit({ excerpt: text }); setText(null); }} rows={5}
              className="w-full resize-y rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Read label="Source">{source}</Read>
            <Read label="Messages">{item.messages}, the last {span(Math.max(0, Date.parse(now) - Date.parse(item.lastActivityAt)))} ago</Read>
            <Read label="Where">{machine ? machine.name || machineKind(machine) : 'On the floor'}</Read>
          </div>

          <Head>{source} only</Head>
          {own.length === 0
            ? <p className="text-xs text-[var(--theme-text-muted)]">An item made by hand has nothing more than what every item has.</p>
            : <div className="grid grid-cols-2 gap-2">{own.map((f) => <FieldInput key={f.key} id={`i-f-${f.key}`} f={f} value={fields[f.key]} onChange={(v) => setField(f.key, v)} />)}</div>}

          <Head>As the Factory holds it</Head>
          <pre className="max-h-64 overflow-auto rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2 font-mono text-[11px] text-[var(--theme-text-secondary)]">{JSON.stringify(raw, null, 2)}</pre>
        </div>
        <div className="flex flex-col gap-2 p-4 lg:overflow-y-auto">
          <Head>What stations said</Head>
          <ItemVisits runs={runs} empty="No station has worked on it yet." />
          {t.note && <p className="text-[11px] text-[var(--theme-warning)]">{t.note}</p>}
        </div>
      </div>
    </FactoryPopup>
  );
}

/**
 * Make an item by hand at an intake, as its source's connector would send it: what every item has, and its source's
 * own fields. It goes through the intakes of its source as any item does: their rules may drop it.
 */
export function FactoryNewItem({ intakeId, onClose }: { intakeId: string; onClose: () => void }) {
  const store = useFactoryStore();
  const m = store.layout?.machines.find((x) => x.id === intakeId);
  const [draft, setDraft] = useState<{ title: string; author: string; excerpt: string; url: string; tags: string[]; fields: ItemFields }>({ title: '', author: '', excerpt: '', url: '', tags: [], fields: {} });
  const [busy, setBusy] = useState(false);
  if (!m || m.kind !== 'intake') return null;
  const source = SOURCE_LABEL[m.source], own = SOURCE_FIELDS[m.source];
  const setField = (k: string, v: ItemFields[string] | undefined) => setDraft((d) => { const fields = { ...d.fields }; if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete fields[k]; else fields[k] = v; return { ...d, fields }; });
  const make = async () => {
    setBusy(true);
    const status = await store.ingest({ source: m.source, key: `manual-${Date.now().toString(36)}`, title: draft.title, author: draft.author, excerpt: draft.excerpt, url: draft.url.trim() || null, tags: draft.tags, fields: draft.fields });
    setBusy(false);
    if (!status) return;                                  // refused: the API helper said why
    if (status === 'dropped') toast.info(`Dropped: no ${source} intake lets it in`); else toast.success('Item made: it waits in its intake until it has been quiet long enough');
    onClose();
  };
  return (
    <FactoryPopup label="New item" onClose={onClose} size="fit" maxWidth="max-w-2xl"
      bar={<span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--theme-text-primary)]">New item <span className="font-normal text-[var(--theme-text-muted)]">· {source}, as its connector would send it</span></span>}>
      <div className="flex flex-col gap-3 overflow-y-auto p-4">
        <Head>Every item</Head>
        <div className="grid grid-cols-2 gap-2">
          <Input id="n-title" label="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Can you look at the cart?" />
          <Input id="n-author" label="From" value={draft.author} onChange={(e) => setDraft({ ...draft, author: e.target.value })} placeholder="Ana" />
        </div>
        <Input id="n-url" label="Link" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://…" />
        <Input id="n-text" label="Text" value={draft.excerpt} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} placeholder="The first lines of it" />
        <TagInput label="Tags" tags={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} placeholder="a tag, or key:value" />
        {own.length > 0 && (
          <>
            <Head>{source} only</Head>
            <div className="grid grid-cols-2 gap-2">
              {own.map((f) => f.kind === 'text' || f.kind === 'list'
                ? <Input key={f.key} id={`n-f-${f.key}`} label={f.label} placeholder={f.hint} value={Array.isArray(draft.fields[f.key]) ? (draft.fields[f.key] as string[]).join(', ') : (draft.fields[f.key] as string | undefined) ?? ''}
                    onChange={(e) => setField(f.key, f.kind === 'list' ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : e.target.value)} />
                : <FieldInput key={f.key} id={`n-f-${f.key}`} f={f} value={draft.fields[f.key]} onChange={(v) => setField(f.key, v === false ? undefined : v)} />)}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 border-t border-[var(--theme-border)] pt-3">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!draft.title.trim() || busy} onClick={() => void make()}>Make the item</Button>
        </div>
      </div>
    </FactoryPopup>
  );
}
