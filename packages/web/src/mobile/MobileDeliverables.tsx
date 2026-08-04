import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TicketDeliverable, TicketWsMessage } from '@fleex/shared';
import * as api from '../services/api';
import { appWs } from '../services/websocket';
import { useDeliverableTypesStore } from '../stores/deliverableTypesStore';
import { useUnreadStore } from '../stores/unreadStore';
import { MobileDeliverableReader } from './MobileDeliverableReader';
import { tint, tintText } from '../lib/tints';
import { MarkdownEditor } from '../components/markdown/MarkdownEditor';

/** Deliverables tab: list, read, create and delete — desktop-parity writes. */
export function MobileDeliverables({ ticketId }: { ticketId: string }) {
  const [deliverables, setDeliverables] = useState<TicketDeliverable[]>([]);
  const [openDeliverable, setOpenDeliverable] = useState<TicketDeliverable | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const seenDeliverables = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]);
  const loadSeenDeliverables = useUnreadStore((s) => s.loadSeenDeliverables);
  const selectableTypes = useDeliverableTypesStore((s) => s.types).filter((t) => !t.system);
  const loadTypes = useDeliverableTypesStore((s) => s.load);

  useEffect(() => {
    api.fetchTicketDeliverables(ticketId).then(setDeliverables).catch(() => {});
    loadSeenDeliverables(ticketId).catch(() => {});
    loadTypes();
  }, [ticketId, loadSeenDeliverables, loadTypes]);

  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'deliverable:created') {
        const d = msg.data as TicketDeliverable;
        if (d.ticketId !== ticketId) return;
        setDeliverables((prev) => (prev.some((x) => x.id === d.id) ? prev : [...prev, d]));
      } else if (msg.type === 'deliverable:updated') {
        const d = msg.data as TicketDeliverable;
        if (d.ticketId !== ticketId) return;
        setDeliverables((prev) => prev.map((x) => (x.id === d.id ? d : x)));
        setOpenDeliverable((cur) => (cur?.id === d.id ? d : cur));
      } else if (msg.type === 'deliverable:deleted') {
        const d = msg.data as { id: string; ticketId: string };
        if (d.ticketId !== ticketId) return;
        setDeliverables((prev) => prev.filter((x) => x.id !== d.id));
        setOpenDeliverable((cur) => (cur?.id === d.id ? null : cur));
      }
    });
    return unsub;
  }, [ticketId]);

  const sorted = useMemo(
    () => [...deliverables].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [deliverables],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (confirmDeleteId !== id) {
        setConfirmDeleteId(id);
        setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 2500);
        return;
      }
      setConfirmDeleteId(null);
      try {
        await api.deleteDeliverable(ticketId, id);
        setDeliverables((prev) => prev.filter((x) => x.id !== id));
      } catch {
        // toast raised by the api layer
      }
    },
    [ticketId, confirmDeleteId],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--theme-text-faint)]">
            Aucun deliverable sur ce ticket.
          </p>
        ) : (
          <div className="flex flex-col gap-2 pb-20">
            {sorted.map((d) => {
              const seen = seenDeliverables?.has(d.id) ?? false;
              return (
                <div
                  key={d.id}
                  className="flex items-center gap-1 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]"
                >
                  <button
                    onClick={() => setOpenDeliverable(d)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 p-3 text-left"
                  >
                    {!seen && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--theme-accent)]" />}
                    <span className="shrink-0 text-base">📄</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--theme-text-primary)]">
                        {d.title}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--theme-text-faint)]">
                        {d.agentName} · {d.type} · v{d.version} ·{' '}
                        {new Date(d.createdAt).toLocaleDateString('fr-FR')}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        d.status === 'final'
                          ? tint('green')
                          : tint('yellow')
                      }`}
                    >
                      {d.status}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDelete(d.id)}
                    className={`shrink-0 rounded-lg px-2.5 py-3 text-xs ${
                      confirmDeleteId === d.id
                        ? `font-semibold ${tintText('red')}`
                        : 'text-[var(--theme-text-faint)]'
                    }`}
                    aria-label={`Supprimer ${d.title}`}
                  >
                    {confirmDeleteId === d.id ? 'Sûr ?' : '✕'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create */}
      <button
        onClick={() => setCreating(true)}
        className="absolute bottom-4 right-4 flex items-center justify-center rounded-full bg-[var(--theme-accent)] text-2xl leading-none text-[var(--theme-accent-fg)] shadow-lg"
        style={{ width: 52, height: 52 }}
        aria-label="Nouveau deliverable"
      >
        +
      </button>

      {creating && (
        <CreateDeliverableSheet
          ticketId={ticketId}
          types={selectableTypes.map((t) => t.id)}
          onClose={() => setCreating(false)}
          onCreated={(d) =>
            setDeliverables((prev) => (prev.some((x) => x.id === d.id) ? prev : [...prev, d]))
          }
        />
      )}

      {openDeliverable && (
        <MobileDeliverableReader
          ticketId={ticketId}
          deliverable={openDeliverable}
          onClose={() => setOpenDeliverable(null)}
        />
      )}
    </div>
  );
}

function CreateDeliverableSheet({
  ticketId,
  types,
  onClose,
  onCreated,
}: {
  ticketId: string;
  types: string[];
  onClose: () => void;
  onCreated: (d: TicketDeliverable) => void;
}) {
  const defaultType = types.includes('report') ? 'report' : types[0] ?? 'report';
  const [title, setTitle] = useState('');
  const [type, setType] = useState(defaultType);
  const [status, setStatus] = useState<'draft' | 'final'>('final');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      // agentName 'user' — same convention as the desktop DeliverableFormModal
      const d = await api.createDeliverable(ticketId, {
        title: title.trim(),
        type,
        content,
        status,
        agentName: 'user',
      });
      onCreated(d);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
          Nouveau deliverable
        </p>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre"
          className="mb-2 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-3 text-base text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        />
        <div className="mb-2 flex gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="min-w-0 flex-1 appearance-none rounded-lg bg-[var(--theme-bg-secondary)] px-3 py-2.5 text-sm text-[var(--theme-text-primary)]"
          >
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-[var(--theme-border)]">
            {(['draft', 'final'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-2 text-xs font-medium ${
                  status === s
                    ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                    : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3 flex h-56">
          <MarkdownEditor
            surfaceKind="deliverable_content_mobile"
            defaultMode="write"
            profile="doc"
            value={content}
            onChange={setContent}
            placeholder="Contenu (markdown)"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm text-[var(--theme-text-muted)]">
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || saving}
            className="rounded-lg bg-[var(--theme-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--theme-accent-fg)] disabled:opacity-50"
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  );
}
