/**
 * The ticket's shared todo list (right tool window "Todo").
 *
 * Built by the human and the agents together: an agent seeds it from its CLI
 * (`fleex ticket todo add`), checks items as it goes; the human adds, checks,
 * reopens during QA. Every change lands in the history view (who, when, from
 * where). Live over WS via todoStore — a row changed elsewhere flashes.
 *
 * Open items can be reordered by drag; Done is open by default, Cancelled
 * folded. Deleting an agent's item asks first (cancel keeps a visible trace);
 * deleting your own is undoable from the toast.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TicketTodoEvent, TicketTodoItem } from '@fleex/shared';
import { TODO_TEXT_MAX } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { toast } from '../../../lib/toast';
import { tintSolid } from '../../../lib/tints';
import * as api from '../../../services/api';
import { useTodoStore } from '../../../stores/todoStore';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Input } from '../../ui/Input';
import { Tooltip } from '../../ui/Tooltip';
import { MessageMarkdown } from '../task/MessageMarkdown';
import { AgentTag } from '../timeline/AnnotationPopovers';

const STATE_LABEL: Record<TicketTodoItem['state'], string> = { open: 'À faire', done: 'Fait', cancelled: 'Annulé' };
const EMPTY: TicketTodoItem[] = [];

const pad = (n: number) => String(n).padStart(2, '0');

/** `3 nov. 14:02` */
export function todoWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `à l'instant` / `il y a 5 min` / `il y a 2 h` / `3 nov. 14:02` */
function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 24 * 60) return `il y a ${Math.round(min / 60)} h`;
  return todoWhen(iso);
}

/** Lines of a pasted block, list markers stripped — same rule as `todo add --file`. */
export function pastedItems(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?/, '').trim())
    .filter((l) => l.length > 0);
}

function Who({ type, name }: { type: 'user' | 'agent' | null; name: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-[var(--theme-text-secondary)]">
      {name ?? '?'}
      {type === 'agent' && <AgentTag />}
    </span>
  );
}

export function TodoPanel({ ticketId }: { ticketId: string }) {
  const items = useTodoStore((s) => s.byTicket[ticketId] ?? EMPTY);
  const loaded = useTodoStore((s) => ticketId in s.byTicket);
  const loadError = useTodoStore((s) => s.loadError[ticketId] ?? false);
  const flashing = useTodoStore((s) => s.flashing);
  const { load, add, update, remove, hide, restore } = useTodoStore.getState();

  const [draft, setDraft] = useState('');
  const [bulk, setBulk] = useState<string[] | null>(null);
  const [doneOpen, setDoneOpen] = useState(true);
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [history, setHistory] = useState<{ itemId: string | null } | null>(null);
  const [cancelling, setCancelling] = useState<TicketTodoItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TicketTodoItem | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load(ticketId);
  }, [ticketId, load]);

  const open = useMemo(() => items.filter((i) => i.state === 'open'), [items]);
  const done = useMemo(
    () => items.filter((i) => i.state === 'done').sort((a, b) => (b.stateChangedAt ?? '').localeCompare(a.stateChangedAt ?? '')),
    [items],
  );
  const cancelled = useMemo(() => items.filter((i) => i.state === 'cancelled'), [items]);
  const progress = open.length + done.length === 0 ? 0 : Math.round((done.length / (open.length + done.length)) * 100);

  const submit = async (texts: string[]) => {
    setDraft('');
    setBulk(null);
    await add(ticketId, texts.map((t) => t.slice(0, TODO_TEXT_MAX)));
    addRef.current?.focus();
  };

  const setState = async (item: TicketTodoItem, state: TicketTodoItem['state'], reason?: string) => {
    const saved = await update(ticketId, item.id, { state, ...(reason ? { reason } : {}) });
    if (!saved) return;
    const verb = state === 'done' ? 'fait' : state === 'cancelled' ? 'annulé' : 'rouvert';
    toast.info(`#${item.ref} ${verb}`, {
      action: { label: 'Annuler', onClick: () => void update(ticketId, item.id, { state: item.state }) },
    });
  };

  // Deferred delete: hidden now, deleted when the toast goes — unless Undo.
  const deleteNow = (item: TicketTodoItem) => {
    const hidden = hide(ticketId, item.id);
    if (!hidden) return;
    toast.info(`#${item.ref} supprimé`, {
      action: { label: 'Annuler', onClick: () => restore(ticketId, hidden) },
      onDismiss: (reason) => {
        if (reason === 'action') return;
        void remove(ticketId, item.id).then((ok) => {
          if (!ok) restore(ticketId, hidden);
        });
      },
    });
  };

  const askDelete = (item: TicketTodoItem) => {
    // An agent's item: confirm (cancel would keep a visible trace). Yours: Undo suffices.
    if (item.createdByType === 'agent') setConfirmDelete(item);
    else deleteNow(item);
  };

  // ── Drag & drop (open items only) ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const onDrop = (targetId: string) => {
    const moving = dragId;
    setDragId(null);
    setDropBefore(null);
    if (!moving || moving === targetId) return;
    const rest = open.filter((i) => i.id !== moving);
    const idx = rest.findIndex((i) => i.id === targetId);
    // "Before target" = "after the open item preceding it" (or first).
    const prev = idx > 0 ? rest[idx - 1] : null;
    void update(ticketId, moving, { after: prev ? prev.id : null });
  };

  if (history) {
    return (
      <TodoHistory
        ticketId={ticketId}
        item={history.itemId ? items.find((i) => i.id === history.itemId) ?? null : null}
        itemId={history.itemId}
        onBack={() => setHistory(null)}
      />
    );
  }

  const row = (item: TicketTodoItem) => (
    <TodoRow
      key={item.id}
      item={item}
      flashing={!!flashing[item.id]}
      draggable={item.state === 'open'}
      dragging={dragId === item.id}
      dropBefore={dropBefore === item.id}
      onDragStart={() => setDragId(item.id)}
      onDragOver={() => dragId && item.state === 'open' && setDropBefore(item.id)}
      onDragEnd={() => {
        setDragId(null);
        setDropBefore(null);
      }}
      onDrop={() => onDrop(item.id)}
      onToggle={() => void setState(item, item.state === 'open' ? 'done' : 'open')}
      onCancel={() => setCancelling(item)}
      onReopen={() => void setState(item, 'open')}
      onEdit={(patch) => void update(ticketId, item.id, patch)}
      onHistory={() => setHistory({ itemId: item.id })}
      onDelete={() => askDelete(item)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">
        {items.length > 0 && (
          <div className="mx-1 mb-2.5">
            <div className="flex items-center justify-between text-[11px] text-[var(--theme-text-muted)]">
              <span>
                {done.length} fait{done.length > 1 ? 's' : ''} · {open.length} à faire
                {cancelled.length > 0 && ` · ${cancelled.length} annulé${cancelled.length > 1 ? 's' : ''}`}
              </span>
              <span className="font-mono text-[var(--theme-text-secondary)]">{done.length}/{open.length + done.length}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--theme-bg-overlay)]">
              <div className={cn('h-full transition-[width] duration-300', tintSolid('green'))} style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="mx-1 mb-2">
          <Input
            ref={addRef}
            value={draft}
            maxLength={TODO_TEXT_MAX}
            placeholder="+ Ajouter un item…  (⏎)"
            aria-label="Ajouter un item à la todo"
            className="w-full px-2 py-1 text-[12.5px]"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                e.preventDefault();
                void submit([draft.trim()]);
              }
            }}
            onPaste={(e) => {
              const lines = pastedItems(e.clipboardData.getData('text'));
              if (lines.length > 1) {
                e.preventDefault();
                setBulk(lines);
              }
            }}
          />
          {bulk && (
            <div className="mt-1.5 flex items-center gap-2 rounded-md bg-[var(--theme-accent-muted)] px-2 py-1.5 text-[12px] text-[var(--theme-text-primary)]">
              <span className="flex-1">Créer {bulk.length} items ?</span>
              <button type="button" className="rounded px-2 py-0.5 text-[11.5px] font-medium bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]" onClick={() => void submit(bulk)}>
                Créer
              </button>
              <button type="button" className="text-[11.5px] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]" onClick={() => void submit([bulk.join(' ')])}>
                Une seule ligne
              </button>
            </div>
          )}
        </div>

        {loadError && !loaded && (
          <div className="mx-2 my-6 text-center text-[12px] text-[var(--theme-text-muted)]">
            Impossible de charger la todo.{' '}
            <button type="button" className="text-[var(--theme-accent)] hover:underline" onClick={() => void load(ticketId)}>Réessayer</button>
          </div>
        )}

        {loaded && items.length === 0 && (
          <div className="mx-3 my-8 text-center text-[12.5px] leading-relaxed text-[var(--theme-text-muted)]">
            Pas de todo sur ce ticket.
            <br />
            Ajoutez un item, ou laissez un agent en proposer une.
          </div>
        )}

        {open.map(row)}
        {items.length > 0 && open.length === 0 && (
          <div className="mx-2 my-3 text-center text-[12px] text-[var(--theme-text-muted)]">Tout est fait 🎉</div>
        )}

        {done.length > 0 && (
          <Section label={`Fait (${done.length})`} open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} />
        )}
        {doneOpen && done.map(row)}

        {cancelled.length > 0 && (
          <Section label={`Annulé (${cancelled.length})`} open={cancelledOpen} onToggle={() => setCancelledOpen(!cancelledOpen)} />
        )}
        {cancelledOpen && cancelled.map(row)}
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-[var(--theme-border)] px-3 text-[11.5px]">
        <button type="button" className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]" onClick={() => setHistory({ itemId: null })}>
          ⟲ Historique
        </button>
        <span className="font-mono text-[10.5px] text-[var(--theme-text-faint)]">fleex ticket todo --help</span>
      </div>

      <CancelModal
        item={cancelling}
        onCancel={() => setCancelling(null)}
        onConfirm={(reason) => {
          const item = cancelling;
          setCancelling(null);
          if (item) void setState(item, 'cancelled', reason);
        }}
      />
      <ConfirmModal
        open={!!confirmDelete}
        title={`Supprimer #${confirmDelete?.ref ?? ''} ?`}
        message={
          <>
            Cet item a été créé par <b>{confirmDelete?.createdByName}</b>. Il disparaîtra de la liste ; son historique reste
            consultable. Pour garder une trace visible, préférez <b>Annuler l'item</b>.
          </>
        }
        confirmLabel="Supprimer"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const item = confirmDelete;
          setConfirmDelete(null);
          if (item) deleteNow(item);
        }}
      />
    </div>
  );
}

function Section({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="mx-1 mb-1 mt-3 flex w-[calc(100%-0.5rem)] items-center gap-1.5 text-[11px] text-[var(--theme-text-muted)] after:h-px after:flex-1 after:bg-[var(--theme-border)] hover:text-[var(--theme-text-secondary)]"
    >
      <span className={cn('inline-block text-[9px] transition-transform', !open && '-rotate-90')}>▾</span>
      {label}
    </button>
  );
}

function CancelModal({ item, onCancel, onConfirm }: { item: TicketTodoItem | null; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [item]);
  return (
    <ConfirmModal
      open={!!item}
      title={`Annuler #${item?.ref ?? ''}`}
      danger={false}
      confirmLabel="Annuler l'item"
      message={
        <div className="flex flex-col gap-2">
          <span>{item?.text}</span>
          <Input
            autoFocus
            value={reason}
            placeholder="Raison (facultative) — visible dans l'historique"
            aria-label="Raison de l'annulation"
            className="w-full text-[12px]"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm(reason.trim());
            }}
          />
        </div>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm(reason.trim())}
    />
  );
}

interface RowProps {
  item: TicketTodoItem;
  flashing: boolean;
  draggable: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onToggle: () => void;
  onCancel: () => void;
  onReopen: () => void;
  onEdit: (patch: { text?: string; note?: string | null }) => void;
  onHistory: () => void;
  onDelete: () => void;
}

function TodoRow(p: RowProps) {
  const { item } = p;
  const [editing, setEditing] = useState<'text' | 'note' | null>(null);
  const [value, setValue] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);

  const startEdit = (field: 'text' | 'note') => {
    setValue(field === 'text' ? item.text : item.note ?? '');
    setEditing(field);
  };
  const commit = () => {
    if (editing === 'text' && value.trim() && value.trim() !== item.text) p.onEdit({ text: value.trim() });
    if (editing === 'note' && value.trim() !== (item.note ?? '')) {
      p.onEdit({ note: value.trim() || null });
      if (value.trim()) setNoteOpen(true);
    }
    setEditing(null);
  };

  const closed = item.state !== 'open';
  const sub = item.state === 'open' ? (
    <>
      <Who type={item.createdByType} name={item.createdByName} />
      <span>· {ago(item.createdAt)}</span>
      {item.stateChangedByName && (
        <span className="inline-flex items-center gap-1">· rouvert par <Who type={item.stateChangedByType} name={item.stateChangedByName} /></span>
      )}
    </>
  ) : (
    <>
      <span className="inline-flex items-center gap-1">
        {item.state === 'done' ? 'fait par' : 'annulé par'} <Who type={item.stateChangedByType} name={item.stateChangedByName} />
      </span>
      {item.stateChangedAt && <span>· {todoWhen(item.stateChangedAt)}</span>}
      {item.cancelReason && <span className="italic text-[var(--theme-text-muted)]">« {item.cancelReason} »</span>}
    </>
  );

  const action = (label: string, glyph: string, onClick: () => void, danger = false) => (
    <Tooltip label={label} placement="top">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded text-[11px] hover:bg-[var(--theme-bg-overlay)]',
          danger ? 'text-[var(--theme-text-muted)] hover:text-[var(--tint-red-text)]' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]',
        )}
      >
        {glyph}
      </button>
    </Tooltip>
  );

  return (
    <div
      data-testid={`todo-row-${item.ref}`}
      draggable={p.draggable && !editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        p.onDragStart();
      }}
      onDragOver={(e) => {
        if (!p.draggable) return;
        e.preventDefault();
        p.onDragOver();
      }}
      onDragEnd={p.onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        p.onDrop();
      }}
      className={cn(
        'group relative grid grid-cols-[12px_18px_1fr_auto] items-start gap-x-1.5 rounded-md px-1 py-1 transition-colors duration-700 hover:bg-[var(--theme-bg-hover)]',
        p.flashing && 'bg-[var(--theme-accent-muted)]',
        p.dragging && 'opacity-40',
        p.dropBefore && 'shadow-[inset_0_2px_0_var(--theme-accent)]',
      )}
    >
      <span className={cn('cursor-grab select-none text-[11px] leading-[18px] text-[var(--theme-text-faint)] opacity-0 group-hover:opacity-100', closed && 'invisible')}>⋮⋮</span>
      <button
        type="button"
        role="checkbox"
        aria-checked={item.state === 'done'}
        aria-label={item.state === 'done' ? `Repasser #${item.ref} à faire` : item.state === 'cancelled' ? `Rouvrir #${item.ref}` : `Marquer #${item.ref} fait`}
        onClick={p.onToggle}
        className={cn(
          'mt-px flex h-4 w-4 items-center justify-center rounded border-[1.5px] text-[10px] leading-none transition-colors',
          item.state === 'done'
            ? cn('border-transparent text-[var(--theme-bg-base)]', tintSolid('green'))
            : 'border-[var(--theme-border-input)] hover:border-[var(--theme-accent)]',
          item.state === 'cancelled' && 'border-dashed text-[var(--theme-text-faint)]',
        )}
      >
        {item.state === 'done' ? '✓' : item.state === 'cancelled' ? '–' : ''}
      </button>

      <div className="min-w-0 text-[12.5px] leading-[18px]">
        {editing === 'text' ? (
          <input
            autoFocus
            value={value}
            maxLength={TODO_TEXT_MAX}
            aria-label={`Texte de #${item.ref}`}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(null);
            }}
            className="w-full rounded border border-[var(--theme-accent)] bg-[var(--theme-bg-surface)] px-1 text-[12.5px] text-[var(--theme-text-primary)] outline-none"
          />
        ) : (
          <span className="cursor-text break-words" onClick={() => startEdit('text')}>
            <span className="mr-1 font-mono text-[11px] text-[var(--theme-text-faint)]">#{item.ref}</span>
            <span
              className={cn(
                item.state === 'done' && 'text-[var(--theme-text-muted)] line-through',
                item.state === 'cancelled' && 'text-[var(--theme-text-faint)] line-through',
                item.state === 'open' && 'text-[var(--theme-text-primary)]',
              )}
            >
              {item.text}
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        {item.note && !editing && action(noteOpen ? 'Masquer la note' : 'Voir la note', '📝', () => setNoteOpen(!noteOpen))}
        <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
          {action(item.note ? 'Éditer la note' : 'Ajouter une note', '✎', () => startEdit('note'))}
          {item.state !== 'cancelled' && action("Annuler l'item…", '⊘', p.onCancel)}
          {item.state !== 'open' && action('Rouvrir', '↺', p.onReopen)}
          {action("Historique de l'item", '⟲', p.onHistory)}
          {action('Supprimer', '🗑', p.onDelete, true)}
        </div>
      </div>

      <div className="col-start-3 col-end-5 flex flex-wrap items-center gap-1 text-[11px] text-[var(--theme-text-faint)]">{sub}</div>

      {editing === 'note' && (
        <textarea
          autoFocus
          value={value}
          aria-label={`Note de #${item.ref}`}
          placeholder="Détail en markdown… (⌘⏎ pour valider, Échap pour annuler)"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
            if (e.key === 'Escape') setEditing(null);
          }}
          className="col-start-3 col-end-5 mt-1 min-h-[56px] w-full resize-y rounded border border-[var(--theme-accent)] bg-[var(--theme-bg-surface)] px-1.5 py-1 text-[12px] text-[var(--theme-text-primary)] outline-none"
        />
      )}
      {item.note && noteOpen && editing !== 'note' && (
        <div className="col-start-3 col-end-5 mt-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-[12px]">
          <MessageMarkdown body={item.note} />
        </div>
      )}
    </div>
  );
}

// ── History ────────────────────────────────────────────────────────────────

function describe(e: TicketTodoEvent, withRef: boolean) {
  const ref = withRef ? <span className="mr-1 font-mono text-[11px] text-[var(--theme-text-faint)]">#{e.itemRef}</span> : null;
  const ch = e.changes as Record<string, { from: unknown; to: unknown }>;
  switch (e.action) {
    case 'created':
      return { head: <>{ref}créé</>, detail: withRef ? <span className="text-[var(--theme-text-secondary)]">{e.itemText}</span> : null };
    case 'deleted':
      return { head: <>{ref}supprimé</>, detail: null };
    case 'moved':
      return { head: <>{ref}déplacé</>, detail: null };
    case 'state_changed': {
      const from = ch.state?.from as TicketTodoItem['state'];
      const to = ch.state?.to as TicketTodoItem['state'];
      return {
        head: <>{ref}état</>,
        detail: (
          <>
            {STATE_LABEL[from] ?? String(from)} → <b className="font-medium text-[var(--theme-text-secondary)]">{STATE_LABEL[to] ?? String(to)}</b>
            {ch.reason && <span className="ml-1 italic">« {String(ch.reason.to)} »</span>}
          </>
        ),
      };
    }
    case 'edited':
      return {
        head: <>{ref}édité</>,
        detail: (
          <>
            {Object.entries(ch).map(([k, v]) => (
              <div key={k}>
                {k === 'text' ? 'texte' : 'note'} <s className="text-[var(--theme-text-faint)]">{String(v.from ?? '∅')}</s> → {String(v.to ?? '∅')}
              </div>
            ))}
          </>
        ),
      };
  }
}

function TodoHistory({ ticketId, itemId, item, onBack }: { ticketId: string; itemId: string | null; item: TicketTodoItem | null; onBack: () => void }) {
  const [events, setEvents] = useState<TicketTodoEvent[] | null>(null);
  const [showMoves, setShowMoves] = useState(false);

  useEffect(() => {
    let alive = true;
    api.fetchTicketTodoEvents(ticketId, itemId ?? undefined).then(
      (list) => alive && setEvents(list),
      () => alive && setEvents([]),
    );
    return () => {
      alive = false;
    };
  }, [ticketId, itemId]);

  const moves = (events ?? []).filter((e) => e.action === 'moved').length;
  const shown = (events ?? []).filter((e) => showMoves || e.action !== 'moved');
  const title = item ? `#${item.ref} ${item.text}` : itemId && events?.[0] ? `#${events[0].itemRef} ${events[0].itemText}` : 'Toute la liste';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-3 py-2 text-[12px]">
        <button type="button" className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]" onClick={onBack}>← Retour</button>
        <span className="min-w-0 flex-1 truncate text-[var(--theme-text-secondary)]">Historique — {title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {events === null && <div className="my-6 text-center text-[12px] text-[var(--theme-text-muted)]">Chargement…</div>}
        {events !== null && shown.length === 0 && (
          <div className="my-6 text-center text-[12px] text-[var(--theme-text-muted)]">Aucun changement.</div>
        )}
        {shown.map((e) => {
          const d = describe(e, itemId === null);
          return (
            <div key={e.id} className="grid grid-cols-[72px_1fr] gap-x-2 border-b border-[var(--theme-border)] px-1 py-1.5 text-[12px]">
              <span className="pt-px font-mono text-[10.5px] text-[var(--theme-text-faint)]">{todoWhen(e.createdAt)}</span>
              <span className="flex flex-wrap items-center gap-1 text-[var(--theme-text-secondary)]">
                <Who type={e.actorType} name={e.actorName} /> · {d.head}
                <span className="rounded bg-[var(--theme-bg-overlay)] px-1 font-mono text-[9.5px] text-[var(--theme-text-muted)]">{e.source}</span>
              </span>
              {d.detail && <span className="col-start-2 text-[11.5px] text-[var(--theme-text-muted)]">{d.detail}</span>}
            </div>
          );
        })}
        {moves > 0 && (
          <button type="button" className="px-1 py-1.5 text-[11px] text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]" onClick={() => setShowMoves(!showMoves)}>
            {showMoves ? 'Masquer' : 'Afficher'} {moves} déplacement{moves > 1 ? 's' : ''}
          </button>
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center border-t border-[var(--theme-border)] px-3 text-[11px] text-[var(--theme-text-faint)]">
        Lecture seule · source : web / cli / mcp / agent-api
      </div>
    </div>
  );
}
