/**
 * A picked UI element, as the agent receives it: the thread renders the
 * ```fleex-element block with this card, and the composer chips reuse it in
 * their popover. The headline rows mirror Claude Desktop's picker; the raw
 * details (selector, attributes, styles, html, siblings) fold away.
 */
import { useState } from 'react';
import type { ElementContext } from './elementContext';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 py-0.5">
      <span className="text-[var(--theme-text-muted)]">{label}</span>
      <span className="min-w-0 break-words text-[var(--theme-text-primary)]">{children}</span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[11px] text-[var(--theme-text-secondary)]">{children}</code>;
}

export function ElementContextCard({
  context: c,
  screenshotUrl,
  defaultOpen = false,
}: {
  context: ElementContext;
  screenshotUrl?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const name = c.react ? `<${c.react.component} />` : `<${c.tag}>`;
  const src = c.react?.source;
  const srcLabel = src ? [src.file, src.line, src.column].filter((p) => p != null).join(':') : null;

  return (
    <div className="my-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 text-xs">
      {screenshotUrl && (
        <img src={screenshotUrl} alt={name} className="mb-2 max-h-40 w-full rounded object-contain bg-[var(--theme-bg-overlay)]" />
      )}
      <Row label="Element"><Mono>{name}</Mono></Row>
      {c.react && (
        <Row label="Component">{[c.react.component, c.react.owners.join(' › ')].filter(Boolean).join(' in ')}</Row>
      )}
      {srcLabel && <Row label="Source"><Mono>{srcLabel}</Mono></Row>}
      {c.text && <Row label="Text">{c.text}</Row>}
      <Row label="Page"><span className="text-[var(--theme-text-secondary)]">{c.page.url}</span></Row>

      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mt-1 text-[var(--theme-text-muted)] hover:text-[var(--theme-accent)]"
      >
        {open ? 'Hide details' : 'Show details'}
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-[var(--theme-border)] pt-2">
          <Row label="Selector"><Mono>{c.selector}</Mono></Row>
          <Row label="XPath"><Mono>{c.xpath}</Mono></Row>
          {Object.keys(c.attributes).length > 0 && (
            <Row label="Attributes">
              {Object.entries(c.attributes).map(([k, v]) => <div key={k}><Mono>{k}="{v}"</Mono></div>)}
            </Row>
          )}
          {Object.keys(c.styles).length > 0 && (
            <Row label="Styles">
              {Object.entries(c.styles).map(([k, v]) => <div key={k}><Mono>{k}: {v}</Mono></div>)}
            </Row>
          )}
          <Row label="HTML">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--theme-bg-overlay)] p-2 font-mono text-[11px]">{c.html}</pre>
          </Row>
          {c.siblings.length > 0 && (
            <Row label="Siblings">
              {c.siblings.map((s, i) => (
                <div key={i} className={s.selected ? 'text-[var(--theme-accent)]' : undefined}>
                  <Mono>{`<${s.tag}${s.classes ? `.${s.classes.split(/\s+/).join('.')}` : ''}>`}</Mono>
                  {s.text ? ` ${s.text}` : ''}
                </div>
              ))}
            </Row>
          )}
        </div>
      )}
    </div>
  );
}
