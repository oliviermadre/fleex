import { memo, useEffect, useMemo, useState } from 'react';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import {
  useAssistantStore,
  toolLineLabel,
  type AssistantAccess,
  type AssistantArtifact,
  type AssistantChatItem,
  type AssistantConfirmRequest,
  type AssistantToolItem,
  type AssistantToolStatus,
} from '../../stores/assistantStore';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/cn';
import { tint, tintText, tintClasses } from '../../lib/tints';

/**
 * Read-only transcript of the active conversation (#518), and the pieces the
 * mobile Assistant reuses: tool lines, artefact cards, notices, the
 * out-of-folder confirmation card and the ticket picker.
 *
 * WHY this is a separate memoized component: the composer's draft used to live
 * in the same component as this list, so every keystroke re-rendered every
 * message — and with it `parseSegments` + highlight.js on the full markdown of
 * the whole conversation. Cost was O(conversation length) × O(keystrokes).
 * Keep the draft out of this subtree, and keep every prop here referentially
 * stable, or the regression comes straight back.
 */

/**
 * Module-level constant on purpose: an inline `() => {}` creates a new
 * reference on every render, which silently defeats `memo(MarkdownRenderer)`.
 * The assistant transcript is not editable, so there is nothing to toggle.
 */
const NOOP_TOGGLE = () => {};

/** Lines of a tool output shown folded; the rest behind "voir tout". */
const OUTPUT_TAIL_LINES = 20;
/** Artefact cards shown per turn before "+ N autres fichiers" (P14). */
const MAX_CARDS_PER_TURN = 10;
/** A running line shows its chrono after this long (P24). */
const CHRONO_AFTER_MS = 3000;

const TOOL_BADGE: Record<AssistantToolStatus, { label: string; className: string }> = {
  running: { label: '⏳', className: tintText('yellow') },
  ok: { label: '✓', className: tintText('green') },
  fail: { label: '✗', className: tintText('red') },
  denied: { label: '⊘ refusé', className: tintText('gray') },
  stopped: { label: '■ arrêté', className: tintText('gray') },
  interrupted: { label: '⊘ interrompu', className: tintText('gray') },
};

const ACCESS_BADGE: Record<AssistantAccess, { label: string; hue: 'gray' | 'orange' | 'red' }> = {
  read: { label: 'lecture', hue: 'gray' },
  write: { label: 'écriture', hue: 'orange' },
  destructive: { label: 'destructif', hue: 'red' },
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

function useChrono(startedAt: number | undefined, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, startedAt]);
  if (!running || !startedAt) return null;
  const elapsed = now - startedAt;
  return elapsed >= CHRONO_AFTER_MS ? Math.floor(elapsed / 1000) : null;
}

export const AssistantToolLine = memo(function AssistantToolLine({ item }: { item: AssistantToolItem }) {
  const [full, setFull] = useState(false);
  const badge = TOOL_BADGE[item.status];
  const seconds = useChrono(item.startedAt, item.status === 'running');
  const lines = item.text ? item.text.split('\n') : [];
  const folded = !full && lines.length > OUTPUT_TAIL_LINES;
  const shown = folded ? lines.slice(-OUTPUT_TAIL_LINES).join('\n') : item.text;
  const failed = item.status === 'fail';
  return (
    <details
      className={cn(
        'rounded-lg border px-3 py-2',
        failed ? tintClasses('red').borderColor : 'border-[var(--theme-border)]',
        'bg-[var(--theme-bg-surface)]',
        (item.status === 'denied' || item.status === 'stopped' || item.status === 'interrupted') && 'opacity-60',
      )}
    >
      <summary className="flex cursor-pointer items-center gap-2 font-mono text-[11px]">
        {(item.autoApproved || item.outsideAutoAllowed) && (
          <span className={tintText('yellow')} title="Autorisé sans demander (⚡ écriture hors dossier)">
            ⚡
          </span>
        )}
        <span className={cn('shrink-0', badge.className)}>{badge.label}</span>
        <span className="min-w-0 flex-1 truncate text-[var(--theme-text-secondary)]">{toolLineLabel(item)}</span>
        {item.outsideWorkDir && (
          <span className={cn('shrink-0 rounded px-1.5 text-[10px]', tint('yellow'))}>hors du dossier</span>
        )}
        {item.access && (
          <span className={cn('shrink-0 rounded px-1.5 text-[10px]', tint(ACCESS_BADGE[item.access].hue))}>
            {ACCESS_BADGE[item.access].label}
          </span>
        )}
        {seconds !== null && <span className="shrink-0 text-[var(--theme-text-faint)]">{seconds} s</span>}
        {failed && item.exitCode !== undefined && <span className={cn('shrink-0', tintText('red'))}>exit {item.exitCode}</span>}
      </summary>
      {item.text && (
        <>
          <pre
            className={cn(
              'mt-2 max-h-64 overflow-auto rounded bg-[var(--theme-bg-overlay)] p-2 text-[10px] leading-relaxed',
              failed ? tintText('red') : 'text-[var(--theme-text-secondary)]',
            )}
          >
            {shown}
          </pre>
          {folded && (
            <button onClick={() => setFull(true)} className="mt-1 text-[10px] text-[var(--theme-accent)] hover:underline">
              voir tout ({lines.length} lignes)
            </button>
          )}
        </>
      )}
    </details>
  );
});

function ArtifactPreview({ artifact }: { artifact: AssistantArtifact }) {
  const p = artifact.preview;
  if (!p) return null;
  switch (p.type) {
    case 'csv':
      return (
        <div className="mt-2 overflow-x-auto">
          <table className="text-[10px]">
            <tbody>
              {p.rows.map((row, i) => (
                <tr key={i} className={i === 0 ? 'font-semibold' : ''}>
                  {row.map((c, j) => (
                    <td key={j} className="border border-[var(--theme-border)] px-1.5 py-0.5">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'markdown':
      return (
        <div className="mt-2 max-h-60 overflow-auto text-xs">
          <MarkdownRenderer content={p.text} onToggleCheckbox={NOOP_TOGGLE} />
        </div>
      );
    case 'html':
      // No scripts: the file is the agent's output, the page is ours.
      return <iframe title={artifact.name} sandbox="" srcDoc={p.html} className="mt-2 h-60 w-full rounded border border-[var(--theme-border)] bg-white" />;
    case 'text':
      return <pre className="mt-2 max-h-60 overflow-auto rounded bg-[var(--theme-bg-overlay)] p-2 text-[10px]">{p.text}</pre>;
    case 'image':
      return <img src={p.dataUrl} alt={artifact.name} className="mt-2 max-h-60 rounded" />;
  }
}

export const AssistantArtifactCard = memo(function AssistantArtifactCard({
  artifact,
  sessionId,
  canOpen,
}: {
  artifact: AssistantArtifact;
  sessionId: string;
  /** False on mobile: the file lives on the companion's machine. */
  canOpen: boolean;
}) {
  const openPath = useAssistantStore((s) => s.openPath);
  const listTickets = useAssistantStore((s) => s.listTickets);
  const pendingAttach = useAssistantStore((s) => s.ticketPicker);
  const [attaching, setAttaching] = useState(false);
  useEffect(() => {
    if (!pendingAttach) setAttaching(false);
  }, [pendingAttach]);

  const actions = (
    <div className="flex shrink-0 items-center gap-2 text-[11px]">
      {canOpen && (
        <button onClick={() => openPath(sessionId, artifact.path)} className="text-[var(--theme-accent)] hover:underline">
          Ouvrir
        </button>
      )}
      <button
        disabled={!artifact.attachable}
        title={artifact.attachable ? undefined : 'Format ou taille non pris en charge comme livrable'}
        onClick={() => {
          setAttaching(true);
          listTickets(sessionId);
        }}
        className="text-[var(--theme-accent)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--theme-text-faint)] disabled:no-underline"
      >
        {artifact.attachments.length ? 'Attacher à un autre ticket' : 'Attacher à un ticket'}
      </button>
    </div>
  );

  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span>📄</span>
        <span className="min-w-0 flex-1 truncate font-mono">{artifact.relPath}</span>
        <span className="shrink-0 text-[var(--theme-text-faint)]">{formatBytes(artifact.sizeBytes)}</span>
        {artifact.modifiedSince && <span className="shrink-0 text-[var(--theme-text-faint)]">modifié depuis</span>}
        {actions}
      </div>
      {artifact.kind === 'full' && <ArtifactPreview artifact={artifact} />}
      {artifact.attachments.map((a) => (
        <p key={a.ticketId} className={cn('mt-1', tintText('green'))}>
          ✓ Attaché à #{a.displayId}
        </p>
      ))}
      {attaching && pendingAttach?.sessionId === sessionId && <AssistantTicketPicker path={artifact.path} />}
    </div>
  );
});

/** Ticket picker for attaching an artefact (T5): the last cited ticket is preselected. */
function AssistantTicketPicker({ path }: { path: string }) {
  const picker = useAssistantStore((s) => s.ticketPicker);
  const close = useAssistantStore((s) => s.closeTicketPicker);
  const attach = useAssistantStore((s) => s.attachArtifact);
  const [query, setQuery] = useState('');
  const preselected = useMemo(
    () => picker?.tickets.find((t) => t.displayId === picker.preselect || t.id === picker.preselect)?.id ?? null,
    [picker],
  );
  const [selected, setSelected] = useState<string | null>(preselected);
  useEffect(() => setSelected(preselected), [preselected]);
  if (!picker) return null;
  const q = query.trim().replace(/^#/, '').toLowerCase();
  const tickets = q ? picker.tickets.filter((t) => t.displayId === q || t.title.toLowerCase().includes(q)) : picker.tickets;
  const chosen = picker.tickets.find((t) => t.id === selected);
  return (
    <Modal open onClose={close} maxWidth="max-w-md">
      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="font-semibold">Attacher à un ticket</p>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Numéro ou titre…"
          className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2 py-1.5 text-xs"
        />
        <ul className="max-h-64 overflow-y-auto">
          {tickets.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setSelected(t.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--theme-bg-hover)]',
                  selected === t.id && 'bg-[var(--theme-accent)]/15',
                )}
              >
                <span className="shrink-0 font-mono text-[var(--theme-text-muted)]">#{t.displayId}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 text-[10px] text-[var(--theme-text-faint)]">{t.status}</span>
              </button>
            </li>
          ))}
          {tickets.length === 0 && <li className="px-2 py-1 text-xs text-[var(--theme-text-faint)]">Aucun ticket</li>}
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={close} className="rounded-md border border-[var(--theme-border)] px-3 py-1 text-xs">
            Annuler
          </button>
          <button
            disabled={!chosen}
            onClick={() => chosen && attach(picker.sessionId, path, chosen)}
            className="rounded-md bg-[var(--theme-accent)] px-3 py-1 text-xs font-semibold text-[var(--theme-accent-fg)] disabled:opacity-50"
          >
            Attacher{chosen ? ` à #${chosen.displayId}` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NoticeLine({ item, sessionId }: { item: Extract<AssistantChatItem, { kind: 'notice' }>; sessionId: string }) {
  const continueTurn = useAssistantStore((s) => s.continueTurn);
  const busy = useAssistantStore((s) => s.sessions.find((x) => x.id === sessionId)?.status !== 'idle');
  const base = 'text-center text-[11px] text-[var(--theme-text-faint)]';
  switch (item.notice) {
    case 'max_turns':
      return (
        <div className={cn('flex items-center justify-center gap-2 rounded-lg p-2 text-xs', tint('yellow'))}>
          <span>Limite de {item.limit ?? '?'} tours atteinte. Continuer ?</span>
          <button
            disabled={busy}
            onClick={() => continueTurn(sessionId)}
            className="rounded bg-[var(--theme-accent)] px-2 py-0.5 font-semibold text-[var(--theme-accent-fg)] disabled:opacity-50"
          >
            Continuer
          </button>
        </div>
      );
    case 'continued':
      return <p className={base}>↻ continué</p>;
    case 'legacy_resumed':
      return <p className={base}>Reprise avec le nouvel assistant</p>;
    case 'context_reloaded':
      return <p className={base}>Contexte rechargé depuis l'historique</p>;
  }
}

export const AssistantMessage = memo(function AssistantMessage({
  item,
  sessionId,
  canOpen = true,
}: {
  item: AssistantChatItem;
  sessionId: string;
  canOpen?: boolean;
}) {
  if (item.kind === 'user') {
    return (
      <div className="ml-12 rounded-xl bg-[var(--theme-accent)]/10 px-4 py-3 text-sm">
        <MarkdownRenderer content={item.text} onToggleCheckbox={NOOP_TOGGLE} />
      </div>
    );
  }
  if (item.kind === 'assistant') {
    return (
      <div className="overflow-x-auto text-sm">
        <MarkdownRenderer content={item.text} onToggleCheckbox={NOOP_TOGGLE} />
      </div>
    );
  }
  if (item.kind === 'artifact') return <AssistantArtifactCard artifact={item.artifact} sessionId={sessionId} canOpen={canOpen} />;
  if (item.kind === 'notice') return <NoticeLine item={item} sessionId={sessionId} />;
  return <AssistantToolLine item={item} />;
});

/**
 * Items as rendered: artefact cards past the 10th of a turn are folded into
 * one "+ N autres fichiers" entry (P14).
 */
export function useFoldedItems(items: AssistantChatItem[]): Array<AssistantChatItem | { kind: 'more'; turnId: string; hidden: AssistantChatItem[] }> {
  return useMemo(() => {
    const perTurn = new Map<string, number>();
    const out: Array<AssistantChatItem | { kind: 'more'; turnId: string; hidden: AssistantChatItem[] }> = [];
    for (const it of items) {
      if (it.kind !== 'artifact') {
        out.push(it);
        continue;
      }
      const n = (perTurn.get(it.artifact.turnId) ?? 0) + 1;
      perTurn.set(it.artifact.turnId, n);
      if (n <= MAX_CARDS_PER_TURN) {
        out.push(it);
        continue;
      }
      const more = out.find((o): o is { kind: 'more'; turnId: string; hidden: AssistantChatItem[] } => o.kind === 'more' && o.turnId === it.artifact.turnId);
      if (more) more.hidden.push(it);
      else out.push({ kind: 'more', turnId: it.artifact.turnId, hidden: [it] });
    }
    return out;
  }, [items]);
}

function MoreFiles({ hidden, sessionId, canOpen }: { hidden: AssistantChatItem[]; sessionId: string; canOpen: boolean }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{hidden.map((it, i) => <AssistantMessage key={i} item={it} sessionId={sessionId} canOpen={canOpen} />)}</>;
  return (
    <button onClick={() => setOpen(true)} className="self-start text-xs text-[var(--theme-accent)] hover:underline">
      + {hidden.length} autres fichiers
    </button>
  );
}

/** The single confirmation card left: a file write outside the conversation folder. */
export function AssistantOutsideWriteCard({ req, compact = false }: { req: AssistantConfirmRequest; compact?: boolean }) {
  const answerConfirm = useAssistantStore((s) => s.answerConfirm);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--theme-text-muted)]">
        <span>L'assistant veut écrire</span>
        <span className={cn('rounded px-1.5 text-[10px]', tint('yellow'))}>hors du dossier de la conversation</span>
        {req.isNewFile && <span className="text-[10px] text-[var(--theme-text-faint)]">nouveau fichier</span>}
      </p>
      <code className="break-all font-mono text-xs text-[var(--theme-text-primary)]">
        {req.tool} · {req.path}
      </code>
      <details open={!compact}>
        <summary className="cursor-pointer text-[11px] text-[var(--theme-text-muted)]">Aperçu</summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[var(--theme-bg-overlay)] p-2 font-mono text-[10px] leading-relaxed">
          {req.diff.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') ? tintText('green') : l.startsWith('-') ? tintText('red') : 'text-[var(--theme-text-secondary)]'}>
              {l || ' '}
            </div>
          ))}
        </pre>
      </details>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          onClick={() => answerConfirm(req.id, 'deny')}
          className="rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
        >
          Refuser
        </button>
        <button
          onClick={() => answerConfirm(req.id, 'always')}
          title="Les écritures hors du dossier de cette conversation passeront sans demander"
          className={cn('rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-[var(--theme-bg-hover)]', tintClasses('yellow').borderColor, tintText('yellow'))}
        >
          ⚡ Toujours autoriser dans cette conversation
        </button>
        <button
          onClick={() => answerConfirm(req.id, 'allow')}
          className="rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]"
        >
          Approuver
        </button>
      </div>
    </div>
  );
}

interface AssistantTranscriptProps {
  sessionId: string;
  items: AssistantChatItem[];
  busy: boolean;
  /** Shown while busy — what the assistant is waiting on. */
  statusLabel: string;
  errorMsg: string | null;
  canOpen?: boolean;
}

export const AssistantTranscript = memo(function AssistantTranscript({
  sessionId,
  items,
  busy,
  statusLabel,
  errorMsg,
  canOpen = true,
}: AssistantTranscriptProps) {
  const folded = useFoldedItems(items);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {folded.map((item, i) =>
        item.kind === 'more' ? (
          <MoreFiles key={`more-${item.turnId}`} hidden={item.hidden} sessionId={sessionId} canOpen={canOpen} />
        ) : (
          <AssistantMessage
            key={item.kind === 'tool' && item.id ? item.id : item.kind === 'artifact' ? `${item.artifact.turnId}:${item.artifact.path}` : i}
            item={item}
            sessionId={sessionId}
            canOpen={canOpen}
          />
        ),
      )}
      {busy && <p className="animate-pulse text-xs text-[var(--theme-text-faint)]">{statusLabel}</p>}
      {errorMsg && <p className={cn('rounded-lg p-2.5 text-xs', tint('red'))}>{errorMsg}</p>}
    </div>
  );
});
