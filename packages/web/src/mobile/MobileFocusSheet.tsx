import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board, FocusItem, Ticket } from '@fleex/shared';
import { cn } from '../lib/cn';
import { tint, tintClasses } from '../lib/tints';
import { linkedPrs } from '../lib/prRef';
import { PrBadgeGroup } from '../components/ui/PrBadgeGroup';
import { MessageMarkdown } from '../components/work/task/MessageMarkdown';
import { KindIcon } from '../components/focus/FocusIcons';
import { FocusStatusBadge } from '../components/focus/FocusTicketLead';
import { FocusThread } from '../components/focus/FocusThread';
import { SNOOZE_CHOICES } from '../components/focus/FocusDetailModal';
import { KIND_META, formatWait, waitedMs, type FocusAction } from '../components/focus/focusModel';
import { useTicketDeliverables } from '../components/work/panel/useTicketDeliverables';
import { useCommentDraft } from '../hooks/useCommentDraft';
import { COLUMN_EASING, COLUMN_MS } from './useColumnSwipe';
import { SHEET_EASING, SHEET_MS } from './useSheetDrag';
import { useSheetPager } from './useSheetPager';
import { MobileComposer } from './MobileComposer';

/** Gap (px) between two neighbouring sheets while one slides over the other. */
const PAGE_GAP = 12;

export interface MobileFocusSheetProps {
  /** The queue, in display order: the sheet pages through it. */
  list: FocusItem[];
  currentKey: string;
  onCurrentChange: (key: string) => void;
  ticketById: ReadonlyMap<string, Ticket>;
  boardById: ReadonlyMap<string, Board>;
  actionsOf: (item: FocusItem) => FocusAction[];
  now: number;
  onAction: (item: FocusItem, action: FocusAction) => void;
  /** A question's answer, or a comment on an idle ticket. */
  onAnswer: (item: FocusItem, text: string) => void;
  onSnooze: (item: FocusItem, until: number) => void;
  onOpenTicket: (item: FocusItem) => void;
  onOpenLogs: (item: FocusItem) => void;
  onClose: () => void;
}

/**
 * Focus's detail on the phone — the desktop popup as a full-screen sheet. It
 * rises from the bottom; dragging it down (from its grabber, or from a thread
 * scrolled to its top) closes it; dragging sideways slides to the previous or
 * next item, each item being its own sheet. Acting on an item (a choice, an
 * answer, a snooze) slides the next one in.
 */
export function MobileFocusSheet(props: MobileFocusSheetProps) {
  const { list, currentKey, onCurrentChange, onClose } = props;
  const [shown, setShown] = useState(false);
  const closing = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // The item that was just handled, sliding out on `side` while its neighbour takes its place.
  const [leaving, setLeaving] = useState<{ item: FocusItem; side: -1 | 1 } | null>(null);

  const idx = list.findIndex((i) => i.key === currentKey);
  // Last place in the queue, to land on a neighbour if the item disappears (handled elsewhere).
  const lastIdx = useRef(Math.max(0, idx));
  const lastItem = useRef<FocusItem | undefined>(list[idx]);
  if (idx >= 0) {
    lastIdx.current = idx;
    lastItem.current = list[idx];
  }

  // Mount closed, then flip on the next frame so the slide-up transition runs.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    setTimeout(onClose, SHEET_MS);
  }, [onClose]);

  useEffect(() => {
    if (idx >= 0 || closing.current) return;
    const fallback = list[Math.min(lastIdx.current, list.length - 1)];
    if (fallback) onCurrentChange(fallback.key);
    else dismiss();
  }, [idx, list, onCurrentChange, dismiss]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), COLUMN_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  /** Act on the current item, sliding its neighbour in (or closing on the last one). */
  const handle = useCallback(
    (item: FocusItem, run: () => void) => {
      const i = list.findIndex((x) => x.key === item.key);
      const next = list[i + 1] ?? list[i - 1];
      if (!next) {
        run();
        dismiss();
        return;
      }
      setLeaving({ item, side: list[i + 1] ? -1 : 1 });
      onCurrentChange(next.key);
      run();
    },
    [list, onCurrentChange, dismiss],
  );

  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < list.length - 1;
  const { dx, dy, dragging, touchProps } = useSheetPager({
    rootRef,
    hasPrev,
    hasNext,
    onPage: (step) => {
      const target = list[idx + step];
      if (target) onCurrentChange(target.key);
    },
    onDismiss: dismiss,
  });

  const current = idx >= 0 ? list[idx] : lastItem.current;
  const panes: { item: FocusItem; pos: number }[] = [];
  if (hasPrev) panes.push({ item: list[idx - 1]!, pos: -1 });
  if (current) panes.push({ item: current, pos: 0 });
  if (hasNext) panes.push({ item: list[idx + 1]!, pos: 1 });
  if (leaving && !panes.some((p) => p.item.key === leaving.item.key)) panes.push({ item: leaving.item, pos: leaving.side });

  const progress = shown ? Math.max(0, 1 - dy / 600) : 0;
  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        background: `rgba(0,0,0,${0.5 * progress})`,
        transition: dragging ? 'none' : `background ${SHEET_MS}ms ${SHEET_EASING}`,
      }}
      onClick={dismiss}
    >
      <div
        ref={rootRef}
        {...touchProps}
        role="dialog"
        aria-modal="true"
        aria-label="Focus"
        className="absolute inset-x-0 bottom-0 overflow-clip [touch-action:pan-y]"
        style={{
          top: 'calc(env(safe-area-inset-top) + 10px)',
          transform: shown ? `translateY(${dy}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : `transform ${SHEET_MS}ms ${SHEET_EASING}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {panes.map(({ item, pos }) => {
          const ticket = props.ticketById.get(item.ticketId);
          if (!ticket) return null;
          const active = pos === 0 && item.key === current?.key;
          return (
            <div
              key={item.key}
              data-focus-sheet-page={item.key}
              aria-hidden={!active}
              inert={!active}
              className="absolute inset-0"
              style={{
                transform: `translateX(calc(${pos * 100}% + ${pos * PAGE_GAP + dx}px))`,
                transition: dragging ? 'none' : `transform ${COLUMN_MS}ms ${COLUMN_EASING}`,
              }}
            >
              <FocusSheetPage
                item={item}
                ticket={ticket}
                board={props.boardById.get(ticket.boardId)}
                actions={props.actionsOf(item)}
                now={props.now}
                position={idx >= 0 ? `${list.findIndex((x) => x.key === item.key) + 1}/${list.length}` : ''}
                active={active}
                onAction={(a) => (a.immediate ? props.onAction(item, a) : handle(item, () => props.onAction(item, a)))}
                onAnswer={(text) => handle(item, () => props.onAnswer(item, text))}
                onSnooze={(until) => handle(item, () => props.onSnooze(item, until))}
                onOpenTicket={() => props.onOpenTicket(item)}
                onOpenLogs={() => props.onOpenLogs(item)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FocusSheetPage({
  item,
  ticket,
  board,
  actions,
  now,
  position,
  active,
  onAction,
  onAnswer,
  onSnooze,
  onOpenTicket,
  onOpenLogs,
}: {
  item: FocusItem;
  ticket: Ticket;
  board: Board | undefined;
  actions: FocusAction[];
  now: number;
  position: string;
  active: boolean;
  onAction: (a: FocusAction) => void;
  onAnswer: (text: string) => void;
  onSnooze: (until: number) => void;
  onOpenTicket: () => void;
  onOpenLogs: () => void;
}) {
  const meta = KIND_META[item.kind];
  const wait = formatWait(waitedMs(item, now));
  const prs = linkedPrs(ticket.links);

  return (
    <div className="flex h-full flex-col overflow-clip rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)]">
      <div className="flex h-6 shrink-0 items-center justify-center" aria-hidden>
        <span className="block h-[5px] w-9 rounded-full bg-[var(--theme-border-input)]" />
      </div>

      <header className="grid shrink-0 gap-2 border-b border-[var(--theme-border)] px-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold', tint(meta.hue))}>
            <KindIcon kind={item.kind} />
            {meta.label}
          </span>
          <FocusStatusBadge ticket={ticket} />
          <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
          <span className="flex-1" />
          <span className="font-mono text-[11.5px] tabular-nums text-[var(--theme-text-muted)]">{wait}</span>
          {position && <span className="font-mono text-[11.5px] text-[var(--theme-text-faint)]">{position}</span>}
        </div>
        <h2 className="text-[17px] font-bold leading-tight text-[var(--theme-text-primary)]">{ticket.title}</h2>
        {(board || prs.length > 0) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {board && (
              <span className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-px text-[10.5px] text-[var(--theme-text-muted)]">
                {board.emoji} {board.name}
              </span>
            )}
            <PrBadgeGroup prs={prs} density="card" />
          </div>
        )}
      </header>

      {/* The ticket's thread — only on the sheet in front: the neighbours load theirs once shown. */}
      <div className="flex min-h-0 flex-1 flex-col">{active && <ActiveThread ticket={ticket} onOpenLogs={onOpenLogs} />}</div>

      <section className={cn('grid shrink-0 gap-2.5 border-t px-4 pt-3', tintClasses(meta.hue).borderColor, tintClasses(meta.hue).bg)}>
        <Prompt item={item} wait={wait} />
        <Controls item={item} ticket={ticket} actions={actions} onAction={onAction} onAnswer={onAnswer} onOpenLogs={onOpenLogs} />
      </section>

      <footer
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-[var(--theme-border)] px-3 pt-1.5 [scrollbar-width:none]"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 6px)' }}
      >
        <span className="shrink-0 pl-1 text-[12px] text-[var(--theme-text-muted)]">Plus tard</span>
        {SNOOZE_CHOICES.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => onSnooze(c.until())}
            className="min-h-11 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] text-[var(--theme-text-secondary)] active:bg-[var(--theme-bg-overlay)]"
          >
            {c.short}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenTicket}
          aria-label="Ouvrir le ticket"
          className="min-h-11 shrink-0 whitespace-nowrap px-2 text-[13px] font-medium text-[var(--theme-accent)]"
        >
          Ticket ↗
        </button>
      </footer>
    </div>
  );
}

function ActiveThread({ ticket, onOpenLogs }: { ticket: Ticket; onOpenLogs: () => void }) {
  const { deliverables } = useTicketDeliverables(ticket.id);
  return <FocusThread ticket={ticket} deliverables={deliverables} onOpenLogs={onOpenLogs} />;
}

/** What is being asked, read before acting — capped so the actions stay in reach. */
function Prompt({ item, wait }: { item: FocusItem; wait: string }) {
  const meta = KIND_META[item.kind];
  let head: string;
  let body: React.ReactNode;
  if (item.kind === 'gate' && item.gate) {
    head = `${item.gate.stepName}${item.workflow ? ` · ${item.workflow.name}` : ''} · depuis ${wait}`;
    body = (
      <>
        {item.gate.mode === 'route'
          ? 'Plusieurs chemins correspondent : choisis celui que le workflow doit prendre.'
          : 'Le workflow est arrêté sur une étape humaine.'}
        {item.gate.context && <MessageMarkdown body={item.gate.context} />}
      </>
    );
  } else if (item.kind === 'question' && item.question?.source === 'session') {
    head = `La session Claude du terminal ${item.question.sessionWait === 'permission' ? 'attend ton autorisation' : 'te pose une question'}`;
    body = (
      <>
        {item.question.text && <MessageMarkdown body={item.question.text} />}
        <p>La réponse se donne dans le terminal, depuis le desktop.</p>
      </>
    );
  } else if (item.kind === 'question') {
    head = `${item.question?.askedBy ? `${item.question.askedBy} ` : ''}a une question depuis ${wait}`;
    body = item.question?.text ? (
      <MessageMarkdown body={item.question.text} />
    ) : (
      <p className="text-[var(--theme-text-muted)]">Le texte de la question n’a pas été retrouvé : ouvre le ticket pour le lire.</p>
    );
  } else if (item.kind === 'error' && item.error) {
    const e = item.error;
    head = e.source === 'step' ? `L’étape « ${e.label} » a échoué il y a ${wait}` : `La session de ${e.label} a crashé il y a ${wait}`;
    body = (
      <p className={tintClasses('red').text}>
        {e.message ??
          (e.source === 'step'
            ? 'L’étape s’est arrêtée (crash, limite de tours ou redémarrage du serveur).'
            : 'La session s’est interrompue. Consulte les logs, puis relance.')}
      </p>
    );
  } else {
    head = `Inactif depuis ${wait}`;
    body = item.idle?.cliRestAt
      ? 'La session Claude du terminal est au repos : elle attend ta prochaine instruction.'
      : 'Personne ne travaille sur ce ticket. Commente pour relancer un agent, ou fais-le avancer.';
  }
  return (
    <div>
      <div className={cn('mb-1 text-[10px] font-bold uppercase tracking-[0.08em]', tintClasses(meta.hue).text)}>{head}</div>
      <div className="max-h-[22dvh] overflow-y-auto overscroll-contain text-[13.5px] leading-[1.45] text-[var(--theme-text-secondary)]">
        {body}
      </div>
    </div>
  );
}

function Controls({
  item,
  ticket,
  actions,
  onAction,
  onAnswer,
  onOpenLogs,
}: {
  item: FocusItem;
  ticket: Ticket;
  actions: FocusAction[];
  onAction: (a: FocusAction) => void;
  onAnswer: (text: string) => void;
  onOpenLogs: () => void;
}) {
  const idle = item.kind === 'idle';
  const answers = item.kind === 'question' && item.question?.source !== 'session';
  // Answers and comments use the ticket's comment draft, shared with the conversation and desktop.
  const { draft, setDraft } = useCommentDraft(ticket.id);
  // Idle items: commenting is a choice first, as on desktop — the composer shows once
  // "Commenter" is picked, or right away when the ticket already has a draft.
  const [commentOpen, setCommentOpen] = useState(() => idle && draft.trim() !== '');
  const send = () => {
    const v = draft.trim();
    if (!v) return;
    setDraft('');
    onAnswer(v);
  };

  const cta = 'min-h-11 whitespace-nowrap rounded-xl px-4 text-sm';
  const primary = 'bg-[var(--theme-accent)] font-semibold text-[var(--theme-accent-fg)] disabled:opacity-50';
  const secondary =
    'border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] font-medium text-[var(--theme-text-primary)]';
  const buttons = actions.map((a) => (
    <button
      key={a.id}
      type="button"
      onClick={() => onAction(a)}
      className={cn(cta, a.primary && !idle && !answers ? primary : secondary)}
    >
      {a.label}
    </button>
  ));
  const commentButton = idle && (
    <button
      key="comment"
      type="button"
      aria-expanded={commentOpen}
      onClick={() => (commentOpen ? send() : setCommentOpen(true))}
      disabled={commentOpen && !draft.trim()}
      className={cn(cta, primary)}
    >
      {commentOpen ? 'Envoyer le commentaire' : 'Commenter'}
    </button>
  );
  const logs = item.kind === 'error' && item.error?.executionId && (
    <button type="button" onClick={onOpenLogs} className={cn(cta, secondary)}>
      Logs
    </button>
  );
  const composer = (
    <MobileComposer
      ticket={ticket}
      value={draft}
      onChange={setDraft}
      onSubmit={send}
      placeholder={
        idle ? 'Ton commentaire… @ pour relancer un agent' : `Répondre${item.question?.askedBy ? ` à @${item.question.askedBy}` : ''}…`
      }
    />
  );
  return (
    <>
      {(answers || commentOpen) && composer}
      {(commentButton || buttons.length > 0 || logs) && (
        <div className="flex flex-wrap gap-2">
          {commentButton}
          {buttons}
          {logs}
        </div>
      )}
    </>
  );
}
