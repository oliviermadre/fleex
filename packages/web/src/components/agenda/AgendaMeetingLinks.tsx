import { useEffect, useMemo, useState } from 'react';
import { calendarEventLinkKey, type AgendaExternalLink, type AgendaItem, type DeliverableListItem } from '@fleex/shared';
import * as api from '../../services/api';
import { documentsService } from '../../services/documentsService';
import { useAgendaStore } from '../../stores/agendaStore';
import { useUIStore } from '../../stores/uiStore';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { Spinner } from '../ui/Spinner';
import { DocumentIcon, LinkIcon, SearchIcon, UnlinkIcon } from '../ui/icons/AgendaIcons';

/** A deliverable written within this window after the meeting starts is suggested. */
const SUGGEST_WINDOW_MS = 6 * 3600_000;
const PAGE = 50;

/** Lower case, no accents, punctuation collapsed to single spaces. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Suggestions first: deliverables created between the meeting start and +6 h,
 * or whose title contains the meeting title; then the rest, as given.
 */
export function rankDeliverables(
  list: readonly DeliverableListItem[],
  meeting: { title: string; start: string },
): { suggested: DeliverableListItem[]; others: DeliverableListItem[] } {
  const start = new Date(meeting.start).getTime();
  const title = normalizeTitle(meeting.title);
  const suggested: DeliverableListItem[] = [];
  const others: DeliverableListItem[] = [];
  for (const d of list) {
    const created = new Date(d.createdAt).getTime();
    const inWindow = Number.isFinite(start) && created >= start && created <= start + SUGGEST_WINDOW_MS;
    const sameTitle = title.length >= 3 && normalizeTitle(d.title).includes(title);
    (inWindow || sameTitle ? suggested : others).push(d);
  }
  return { suggested, others };
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function useDeliverableSearch(open: boolean, search: string, meetingTitle: string) {
  const [state, setState] = useState<{ loading: boolean; items: DeliverableListItem[]; error: string | null }>({ loading: false, items: [], error: null });
  useEffect(() => {
    if (!open) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const query = (q: string) => documentsService.list({ types: [], agentNames: [], statuses: [], originKinds: [], search: q }, PAGE, 0);
    const timer = setTimeout(() => {
      // With no search, also ask for the meeting title: a deliverable named after
      // an older meeting may not be among the most recent ones.
      const calls = search.trim() ? [query(search)] : [query(''), meetingTitle.trim() ? query(meetingTitle) : null];
      Promise.all(calls.map((c) => c ?? Promise.resolve(null)))
        .then((pages) => {
          if (!live) return;
          const seen = new Set<string>();
          const items: DeliverableListItem[] = [];
          for (const p of pages) for (const d of p?.items ?? []) if (!seen.has(d.id)) { seen.add(d.id); items.push(d); }
          setState({ loading: false, items, error: null });
        })
        .catch((e: unknown) => live && setState({ loading: false, items: [], error: e instanceof Error ? e.message : String(e) }));
    }, search ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, search, meetingTitle]);
  return state;
}

/** What deliverables are attached to: a Google meeting occurrence or a free event occurrence. */
export interface LinkTarget {
  /** The link key: Google `eventKey`, or `calendarEventLinkKey()` for a free event. */
  key: string;
  title: string;
  start: string;
  /** Wording in the toasts: "attached to the meeting" / "to the event". */
  noun: 'meeting' | 'event';
}

function AttachPicker({ target, linkedIds, onAttached }: { target: LinkTarget; linkedIds: Set<string>; onAttached: (l: AgendaExternalLink) => void }) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ role: 'dialog', maxHeight: 360 });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const { loading, items, error } = useDeliverableSearch(open, search, target.title);
  const { suggested, others } = useMemo(
    () => rankDeliverables(items.filter((d) => !linkedIds.has(d.id)), { title: target.title, start: target.start }),
    [items, linkedIds, target.title, target.start],
  );

  const attach = async (d: DeliverableListItem) => {
    if (busy) return;
    setBusy(true);
    try {
      const link = await api.createAgendaExternalLink({ eventKey: target.key, deliverableId: d.id, eventTitle: target.title, eventStart: target.start });
      onAttached(link);
      setOpen(false);
      setSearch('');
      toast.success(`"${d.title}" attached to the ${target.noun}`);
      void useAgendaStore.getState().refresh();
    } catch {
      // `request` already raised the error toast.
    } finally {
      setBusy(false);
    }
  };

  const row = (d: DeliverableListItem) => (
    <button
      key={d.id}
      type="button"
      role="option"
      aria-selected={false}
      disabled={busy}
      onClick={() => void attach(d)}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[var(--theme-bg-hover)]"
    >
      <DocumentIcon size={12} className="shrink-0 text-[var(--theme-text-muted)]" />
      <span className="flex-1 truncate text-[var(--theme-text-secondary)]">{d.title}</span>
      <span className="shrink-0 tabular-nums text-[10.5px] text-[var(--theme-text-faint)]">{fmtDate(d.createdAt)}</span>
    </button>
  );
  const heading = (t: string) => <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-[var(--theme-text-faint)]">{t}</div>;

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        className="inline-flex items-center gap-1 text-[var(--theme-accent)] hover:underline"
      >
        <LinkIcon size={12} /> Attach deliverable…
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[320px] overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] pb-1 text-xs shadow-xl"
          >
            <div className="sticky top-0 z-[2] border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2">
              <div className="relative flex items-center">
                <SearchIcon size={12} className="absolute left-2 text-[var(--theme-text-faint)]" />
                <input
                  autoFocus
                  aria-label="Search deliverables"
                  placeholder="Search deliverables"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-7 w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] pl-7 pr-2 text-[11px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
                />
              </div>
            </div>
            <div role="listbox" aria-label="Deliverables" className="px-1">
              {loading && items.length === 0 && <div className="flex justify-center py-3"><Spinner /></div>}
              {error && <div className="px-2 py-2 text-[var(--theme-danger)]">Couldn't load the deliverables: {error}</div>}
              {!loading && !error && suggested.length + others.length === 0 && (
                <div className="px-2 py-2 text-[var(--theme-text-faint)]">No deliverable found</div>
              )}
              {suggested.length > 0 && heading('Suggested')}
              {suggested.map(row)}
              {suggested.length > 0 && others.length > 0 && heading('All deliverables')}
              {others.map(row)}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * Deliverables attached to a Google meeting (E3) or a free event (E1): list
 * (open / unlink) and attach. The link only lives in Fleex.
 */
export function DeliverableLinks({ target, links: initial, footnote, onClose }: {
  target: LinkTarget;
  links: AgendaExternalLink[];
  footnote?: string;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<AgendaExternalLink[]>(initial);
  useEffect(() => setLinks(initial), [initial]);
  const linkedIds = useMemo(() => new Set(links.map((l) => l.deliverableId)), [links]);

  const open = async (l: AgendaExternalLink) => {
    try {
      const d = await api.fetchDeliverable(l.deliverableId);
      useUIStore.getState().openDeliverableOverlay(d);
      onClose();
    } catch {
      // `request` already raised the error toast.
    }
  };

  const unlink = async (l: AgendaExternalLink) => {
    try {
      await api.deleteAgendaExternalLink(l.id);
    } catch {
      return;
    }
    setLinks((cur) => cur.filter((x) => x.id !== l.id));
    void useAgendaStore.getState().refresh();
    toast.info(`"${l.deliverableTitle}" unlinked from the ${target.noun}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          api.createAgendaExternalLink({ eventKey: l.eventKey, deliverableId: l.deliverableId, eventTitle: l.eventTitle, eventStart: l.eventStart })
            .then((back) => {
              setLinks((cur) => (cur.some((x) => x.deliverableId === back.deliverableId) ? cur : [...cur, back]));
              void useAgendaStore.getState().refresh();
            })
            .catch(() => {});
        },
      },
    });
  };

  return (
    <div className="space-y-1 border-t border-[var(--theme-border)] pt-2" data-testid="agenda-deliverable-links">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">Attached deliverables</div>
      {links.length > 0 && (
        <ul className="space-y-0.5">
          {links.map((l) => (
            <li key={l.id} className="group flex items-center gap-1.5 text-[var(--theme-text-secondary)]">
              <DocumentIcon size={12} className="shrink-0 text-[var(--theme-text-muted)]" />
              <button type="button" onClick={() => void open(l)} className="min-w-0 flex-1 truncate text-left hover:underline" title={`Open ${l.deliverableTitle}`}>
                {l.deliverableTitle}
              </button>
              <span
                className={cn(
                  'shrink-0 rounded px-1 text-[10px]',
                  l.source === 'cli' ? 'bg-[var(--tint-purple-bg)] text-[var(--tint-purple-text)]' : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)]',
                )}
              >
                {l.source}
              </span>
              <button type="button" onClick={() => void open(l)} className="shrink-0 text-[var(--theme-accent)] hover:underline">Open</button>
              <button
                type="button"
                aria-label={`Unlink ${l.deliverableTitle}`}
                title="Unlink"
                onClick={() => void unlink(l)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-danger)]"
              >
                <UnlinkIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AttachPicker target={target} linkedIds={linkedIds} onAttached={(l) => setLinks((cur) => [...cur, l])} />
      {footnote && <div className="text-[11px] text-[var(--theme-text-faint)]">{footnote}</div>}
    </div>
  );
}

const NO_LINKS: AgendaExternalLink[] = [];

/** E3 — deliverables attached to a Google meeting (nothing is written to Google). */
export function AgendaMeetingLinks({ item, onClose }: { item: AgendaItem; onClose: () => void }) {
  const ext = item.external;
  if (!ext) return null;
  return (
    <DeliverableLinks
      target={{ key: ext.eventKey, title: item.title, start: item.start, noun: 'meeting' }}
      links={ext.links ?? NO_LINKS}
      footnote="The link lives in Fleex only: nothing is written to Google Calendar."
      onClose={onClose}
    />
  );
}

/** E1 — deliverables attached to one occurrence of a free event. */
export function AgendaEventLinks({ item, onClose }: { item: AgendaItem; onClose: () => void }) {
  const ev = item.event;
  if (!ev) return null;
  return (
    <DeliverableLinks
      target={{ key: calendarEventLinkKey(ev, item.start), title: item.title, start: item.start, noun: 'event' }}
      links={item.eventLinks ?? NO_LINKS}
      footnote={ev.recurrence ? 'Attached to this occurrence only.' : undefined}
      onClose={onClose}
    />
  );
}
