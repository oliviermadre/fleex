import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
import { factoryApi } from './factoryApi';
import { shippedWhen } from './FactoryExitLog';
import { useOpenDeliverable, type ItemDeliverable } from './ItemVisits';

/** True when a mail's HTML loads something from the internet: images, or a background in its styles. */
export const loadsRemote = (html: string): boolean => /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html) || /\bbackground\s*=\s*["']?(?:https?:)?\/\//i.test(html);

/**
 * A mail's HTML as a page of its own, for a frame that runs nothing (see `MailFrame`): nothing is fetched from the
 * internet unless `images`, links open in a new tab, a white page as a mail client shows it.
 */
export function mailDocument(html: string, images: boolean): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src ${images ? 'https: http: data: cid:' : 'data: cid:'}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">`
    + '<style>html{background:#fff}body{margin:14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1f2937;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>'
    + `</head><body>${html}</body></html>`;
}

/**
 * A mail as it was sent, in a frame: scripts never run (`sandbox` without `allow-scripts`), and images from the
 * internet stay unloaded until asked (Load images), since loading them tells the sender the mail was opened. Picked on
 * `docs/factory/item-content.html` (images: A).
 */
function MailFrame({ html }: { html: string }) {
  const [images, setImages] = useState(false), remote = useMemo(() => loadsRemote(html), [html]);
  return (
    <div className="flex flex-col gap-1.5">
      {remote && !images && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--theme-text-muted)]">
          Images from the internet are not loaded: showing them tells the sender you opened it.
          <Button size="sm" variant="secondary" onClick={() => setImages(true)}>Load images</Button>
        </div>
      )}
      <iframe title="The mail as it was sent" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={mailDocument(html, images)}
        className="h-[420px] w-full rounded-md border border-[var(--theme-border)] bg-white" />
    </div>
  );
}

/**
 * What an item says, whole: its text and, for a mail that came with one, its HTML part as sent, in two tabs. The text
 * of an item whose message was kept is its whole latest message, read only; an item made by hand (or kept before
 * messages were) has its first lines there, which can be changed.
 */
export function ItemContent({ itemId, excerpt, version, onEdit }: { itemId: string; excerpt: string; /** Changes when a new message comes. */ version: string; onEdit: (excerpt: string) => void }) {
  const [body, setBody] = useState<{ text: string; html: string | null; kept: boolean } | null>(null);
  const [tab, setTab] = useState<'text' | 'mail'>('text'), [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => factoryApi.itemBody(itemId)).then((b) => { if (live) setBody(b); }, () => { if (live) setBody({ text: excerpt, html: null, kept: false }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, version]);
  const html = body?.html ?? null, shown = html ? tab : 'text';
  const tabBtn = (k: 'text' | 'mail', label: string) => (
    <button type="button" role="tab" aria-selected={shown === k} onClick={() => setTab(k)}
      className={cn('-mb-px border-b-2 px-2.5 py-1 text-xs', shown === k ? 'border-[var(--theme-accent)] font-medium text-[var(--theme-text-primary)]' : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}>{label}</button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex border-b border-[var(--theme-border)]" role="tablist" aria-label="Content">
        {tabBtn('text', 'Text')}
        {html && tabBtn('mail', 'Email')}
      </div>
      {shown === 'mail' && html ? <MailFrame html={html} />
        : !body ? <p className="py-4 text-xs text-[var(--theme-text-muted)]">Reading it…</p>
        : body.kept
          ? <div className="max-h-[420px] min-h-[82px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-3 py-2 text-sm text-[var(--theme-text-primary)]" aria-label="Its text">{body.text || 'Nothing but its title.'}</div>
          : <textarea id="i-text" aria-label="Text" value={draft ?? body.text} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== null && draft !== excerpt) onEdit(draft); setDraft(null); }} rows={5}
              className="w-full resize-y rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none" />}
    </div>
  );
}

/** A deliverable's type as three letters, on its tile. */
const tag3 = (type: string | undefined) => (type || 'doc').replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'DOC';

/**
 * What the stations delivered on an item, where it is seen first: a band under the popup's bar, each deliverable a
 * card to open (picked on `docs/factory/item-content.html`, deliverables: A). Nothing when there is none.
 */
export function DeliveredBand({ delivered }: { delivered: ItemDeliverable[] }) {
  const open = useOpenDeliverable();
  if (!delivered.length) return null;
  return (
    <div className="flex flex-none flex-col gap-2 border-b border-[var(--theme-border)] px-4 py-3" role="region" aria-label="Delivered">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">Delivered · {delivered.length}</div>
      {delivered.map((d) => (
        <div key={d.run.id} className="flex items-center gap-3 rounded-lg border border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] px-3 py-2">
          <span className="grid h-10 w-8 flex-none place-items-center rounded bg-[var(--theme-accent)] font-mono text-[10px] font-bold text-[var(--theme-bg-base)]">{tag3(d.deliverable?.type)}</span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-sm text-[var(--theme-text-primary)]">{d.deliverable?.title ?? 'A deliverable'}</b>
            <span className="block truncate text-[11px] text-[var(--theme-text-muted)]">{d.deliverable?.type ?? 'deliverable'} · by {d.run.machineName} · {shippedWhen(d.run.finishedAt ?? d.run.startedAt)}</span>
          </div>
          <Button size="sm" variant="primary" onClick={() => open(d)}>Open</Button>
        </div>
      ))}
    </div>
  );
}
