import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Board, FocusItem, Ticket, TicketDeliverable } from '@fleex/shared';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/cn';
import { tint, tintClasses } from '../../lib/tints';
import { parseGithubPrRef, prStateFromGithub } from '../../lib/prRef';
import { PrBadge } from '../ui/PrBadge';
import { FocusFavoriteStar, FocusStatusBadge, FocusTicketLead } from './FocusTicketLead';
import { DeliverableTypeBadge } from '../ui/DeliverableTypeBadge';
import { MessageMarkdown } from '../work/task/MessageMarkdown';
import { useTicketDeliverables } from '../work/panel/useTicketDeliverables';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { Composer } from '../work/task/Composer';
import { ComposerExecBar } from '../markdown/ComposerExecBar';
import { useExecConfig } from '../../hooks/useExecConfig';
import { useCommentDraft } from '../../hooks/useCommentDraft';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { useSessionStore } from '../../stores/sessionStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { useUIStore } from '../../stores/uiStore';
import { executeSkill, fetchPRStates } from '../../services/api';
import { useToastStore } from '../../stores/toastStore';
import { useFocusStore } from '../../stores/focusStore';
import { FocusThread } from './FocusThread';
import { KindIcon } from './FocusIcons';
import { KIND_META, formatWait, waitedMs, type FocusAction } from './focusModel';

export interface SnoozeChoice {
  label: string;
  until: () => number;
}

export const SNOOZE_CHOICES: SnoozeChoice[] = [
  { label: 'Dans 1 h', until: () => Date.now() + 3600_000 },
  { label: 'Dans 4 h', until: () => Date.now() + 4 * 3600_000 },
  {
    label: 'Demain matin (9 h)',
    until: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    },
  },
];

interface Props {
  item: FocusItem;
  ticket: Ticket;
  board: Board | undefined;
  actions: FocusAction[];
  now: number;
  position: string;
  chain: boolean;
  onChainChange: (v: boolean) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onAction: (action: FocusAction, notes?: string) => void;
  onAnswer: (text: string) => void;
  /** A comment on the ticket (idle items): handles the item, like an answer. */
  onComment: (text: string) => void;
  onSnooze: (until: number) => void;
  onOpenTicket: () => void;
  onOpenLogs: (executionId: string) => void;
  /** Which way the queue moved to reach this item: 1 = forward (next, or handled), -1 = back (previous). */
  direction?: 1 | -1;
  /** Items waiting behind this one — drawn as a pile of cards under the popup. */
  remaining?: number;
}

function isFormField(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/.test(s.trim());
}

const CTA_BASE = 'inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-[12.5px] font-semibold transition-colors';
const CTA_PRIMARY = 'border-transparent bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]';
const CTA_SECONDARY = 'border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-primary)] hover:border-[var(--theme-text-muted)]';

/**
 * The detail popup (blurred backdrop): everything needed to fire the next agentic
 * action from here. Three zones: the ticket's context on top (title, PRs, workflow
 * position), its state in the middle (the conversation thread, or the deliverables),
 * and the actions pinned at the bottom (what is asked, the composer, the choices,
 * snooze). J/K move to the neighbouring item, 1–3 fire a choice, Esc closes.
 */
export function FocusDetailModal(props: Props) {
  const { shown, phase, direction } = useItemTransition(props);
  // Unstacking: while the handled card leaves, the pile moves up one slot and its first card
  // takes the top spot. Going back puts the card down onto the pile instead: it stays still.
  const unstacking = phase === 'out' && direction === 1;
  const behind = Math.min(STACK_DEPTH, Math.max(0, props.remaining ?? 0));
  const slots = Array.from({ length: unstacking ? behind + 1 : behind }, (_, i) => (unstacking ? i : i + 1));
  return (
    // Below the floating terminals (z 45+): a session opened from here must show on top of the popup.
    // Fixed height, three zones: context on top, the ticket's state scrolling in the middle,
    // the actions pinned at the bottom — always reachable whatever the volume above.
    <Modal
      open
      onClose={props.onClose}
      maxWidth="max-w-[860px]"
      className={cn(
        'flex h-[88vh] flex-col overflow-hidden p-0',
        phase === 'out' && (direction === 1 ? 'focus-card-out-left' : 'focus-card-sink'),
        phase === 'in' && (direction === 1 ? 'focus-card-reveal' : 'focus-card-in-left'),
      )}
      zIndexClass="z-40"
      underlay={slots.map((slot) => (
        <div
          key={slot}
          aria-hidden
          data-focus-stack-card
          className={cn('focus-stack-card', unstacking && 'focus-stack-card-rise')}
          style={{ '--slot': slot } as React.CSSProperties}
        />
      ))}
    >
      <FocusDetailContent {...shown} frozen={phase === 'out'} />
    </Modal>
  );
}

const CARD_OUT_MS = 180;
const CARD_IN_MS = 200;
/** Cards of the pile visible under the popup. */
const STACK_DEPTH = 2;

/**
 * Moving to another item animates the card, the way the queue moved: forward, it is thrown
 * off to the left while the pile rises and its top card reveals the next item; back, it sinks
 * onto the pile while the previous item slides in from the left. While it leaves,
 * the old item keeps showing (it has already dropped out of the list once handled), frozen.
 * Several moves in a row don't queue up: the card lands on the latest item.
 */
function useItemTransition(props: Props) {
  const latest = useRef(props);
  const shown = useRef(props);
  const [leaving, setLeaving] = useState<{ snapshot: Props; direction: 1 | -1 } | null>(null);
  const [entering, setEntering] = useState<1 | -1 | null>(null);

  useLayoutEffect(() => {
    latest.current = props;
    if (leaving) return;
    if (props.item.key !== shown.current.item.key) {
      setEntering(null);
      setLeaving({ snapshot: shown.current, direction: props.direction ?? 1 });
    } else {
      shown.current = props;
    }
  });

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      shown.current = latest.current;
      setLeaving(null);
      setEntering(leaving.direction);
    }, CARD_OUT_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    if (!entering) return;
    const t = setTimeout(() => setEntering(null), CARD_IN_MS);
    return () => clearTimeout(t);
  }, [entering]);

  if (leaving) return { shown: leaving.snapshot, phase: 'out' as const, direction: leaving.direction };
  // The frame the key changes, before the layout effect starts the exit: keep the old item on screen.
  if (props.item.key !== shown.current.item.key) return { shown: shown.current, phase: 'out' as const, direction: props.direction ?? 1 };
  return { shown: props, phase: entering ? ('in' as const) : ('idle' as const), direction: entering ?? 1 };
}

function FocusDetailContent(props: Props & { frozen: boolean }) {
  const { item, ticket, board, actions, now, position, chain, onChainChange, onClose, onPrev, onNext, onAction, onAnswer, onComment, onSnooze, onOpenTicket, onOpenLogs, frozen } = props;
  const meta = KIND_META[item.kind];
  // Gate decision note: local, it travels with the decision. Answers and comments use the
  // ticket's comment draft, shared with the Tasks composer.
  const [notes, setNotes] = useState('');
  const { draft, setDraft } = useCommentDraft(ticket.id);
  // The composer clears its value once onSend resolves; by then the popup may already show
  // the next ticket, whose draft must survive. Each setter only writes its own ticket's draft.
  const liveTicketId = useRef(ticket.id);
  useLayoutEffect(() => { liveTicketId.current = ticket.id; }, [ticket.id]);
  const draftSetter = (id: string) => (v: string) => { if (liveTicketId.current === id) setDraft(v); };
  const exec = useExecConfig(ticket.id);
  const tab = useFocusStore((s) => s.prefs.detailTab);
  const setPref = useFocusStore((s) => s.setPref);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  // Idle items: commenting is a choice first — the composer shows once "Commenter" is picked,
  // or right away when the ticket already has a draft, so it is never out of sight.
  const [commentOpen, setCommentOpen] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const sessions = findSessionsForTicketId(ticket.id, sessionGroups);
  const { deliverables } = useTicketDeliverables(ticket.id);
  const seen = useUnreadStore((s) => s.seenDeliverablesByTicket[ticket.id]);
  const loadSeen = useUnreadStore((s) => s.loadSeenDeliverables);
  const toggleSeen = useUnreadStore((s) => s.toggleDeliverableSeen);
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);

  useEffect(() => { void loadSeen(ticket.id); }, [ticket.id, loadSeen]);

  // Fresh item → fresh draft, and focus where the next keystroke belongs.
  useEffect(() => {
    setNotes('');
    setSnoozeOpen(false);
    const drafting = item.kind === 'idle' && draft.trim() !== '';
    setCommentOpen(drafting);
    const typing = drafting || (item.kind === 'question' && item.question?.source !== 'session');
    const t = setTimeout(() => (typing ? answerRef.current : primaryRef.current)?.focus(), 60);
    return () => clearTimeout(t);
    // The draft is read when the item changes, not followed as it is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key, item.kind, item.question?.source]);

  const openComment = () => {
    setCommentOpen(true);
    setTimeout(() => answerRef.current?.focus(), 0);
  };

  const send = (body = draft) => {
    const text = body.trim();
    if (!text) { answerRef.current?.focus(); return; }
    setDraft('');
    onAnswer(text);
  };

  // Keyboard inside the popup (the page's own shortcuts are paused while it is open).
  useEffect(() => {
    // The item sliding out is no longer actionable: a key pressed then would act on the wrong one.
    if (frozen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isFormField(e.target)) return;
      if (e.key === 'ArrowRight' || e.key === 'n') { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
      else if (e.key === 's') { e.preventDefault(); onSnooze(SNOOZE_CHOICES[0]!.until()); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [frozen, onNext, onPrev, onSnooze]);

  const openDeliverable = (d: TicketDeliverable) => {
    if (!seen?.has(d.id)) void toggleSeen(ticket.id, d.id, true).catch(() => {});
    if (isUrl(d.content)) window.open(d.content.trim(), '_blank', 'noopener');
    else openDeliverableOverlay(d);
  };

  const wait = formatWait(waitedMs(item, now));
  const prLinks = ticket.links.filter((l) => l.type === 'github_pr');
  // Live PR states from GitHub, as in the Tasks context panel: the badge shows merged/closed, not always "open".
  const [prStates, setPrStates] = useState<Record<string, string>>({});
  useEffect(() => {
    setPrStates({});
    if (prLinks.length === 0) return;
    let live = true;
    fetchPRStates(ticket.id).then((s) => { if (live) setPrStates(s); }).catch(() => {});
    return () => { live = false; };
  }, [ticket.id, prLinks.length]);
  // Any agentic run (workflow, skill, panel, agent, new session) — the SmartSessionButton menu, styled as a choice.
  const launcherButton = (
    <SmartSessionButton
      sessions={sessions}
      ticketId={ticket.id}
      onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)}
      launcher={{
        className: cn(CTA_BASE, CTA_SECONDARY),
        content: (
          <span title="workflow, skill, panel, agent ou session" className="inline-flex items-center gap-1.5">
            Lancer un run
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="4,6 8,10 12,6" />
            </svg>
          </span>
        ),
      }}
    />
  );

  const comment = (body: string) => {
    const text = body.trim();
    if (!text) { answerRef.current?.focus(); return; }
    setDraft('');
    onComment(text);
  };

  // A choice: label on one line (its hint as tooltip, or inline for a gate route, where
  // "→ step" is what the decision is about).
  const optionButton = (a: FocusAction, isGate: boolean) => (
    <button
      key={a.id}
      ref={a.primary ? primaryRef : undefined}
      type="button"
      title={a.hint}
      onClick={() => onAction(a, isGate ? notes.trim() : undefined)}
      className={cn(CTA_BASE, a.primary ? CTA_PRIMARY : CTA_SECONDARY)}
    >
      {a.label}
      {isGate && a.hint && <span className="font-normal opacity-75">{a.hint}</span>}
    </button>
  );

  // What is being asked (read) vs. what can be done about it (act): the prompt sits on top
  // of the action zone, the controls below it.
  let prompt: React.ReactNode;
  let controls: React.ReactNode;
  if (item.kind === 'gate' && item.gate) {
    prompt = (
      <>
        <AskHeader hue={meta.hue}>Ce qui t’attend · {item.gate.stepName}{item.workflow ? ` · ${item.workflow.name}` : ''} · depuis {wait}</AskHeader>
        <Clamp resetKey={item.key}>
          {item.gate.mode === 'route'
            ? 'Plusieurs chemins correspondent : choisis celui que le workflow doit prendre.'
            : 'Le workflow est arrêté sur une étape humaine.'}
          {item.gate.context && <MessageMarkdown body={item.gate.context} />}
        </Clamp>
      </>
    );
    controls = (
      <>
        <Composer
          bare
          ticketId={ticket.id}
          value={notes}
          onChange={setNotes}
          onSend={() => {}}
          submitOn="none"
          showExecBar={false}
          showSend={false}
          placeholder="Commentaire joint à la décision (facultatif), lu par l’étape suivante"
        />
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">{actions.map((a) => optionButton(a, true))}</div>
        ) : (
          <p className="text-xs text-[var(--theme-text-muted)]">Aucune issue configurée : résous cette gate depuis l’onglet Workflow du ticket.</p>
        )}
      </>
    );
  } else if (item.kind === 'question' && item.question?.source === 'session') {
    const q = item.question;
    prompt = (
      <>
        <AskHeader hue={meta.hue}>
          Ce qui t’attend · la session Claude du terminal {q.sessionWait === 'permission' ? 'attend ton autorisation' : 'te pose une question'} depuis {wait}
        </AskHeader>
        <Clamp resetKey={item.key}>
          {q.text && <MessageMarkdown body={q.text} />}
          <p>La réponse se donne dans le terminal : ouvre la session.</p>
        </Clamp>
      </>
    );
    controls = <div className="flex flex-wrap gap-2">{actions.map((a) => optionButton(a, false))}</div>;
  } else if (item.kind === 'question') {
    prompt = (
      <>
        <AskHeader hue={meta.hue}>Ce qui t’attend · {item.question?.askedBy ? `${item.question.askedBy} ` : ''}a une question depuis {wait}</AskHeader>
        <Clamp resetKey={item.key}>
          {item.question?.text
            ? <MessageMarkdown body={item.question.text} />
            : <p className="text-[var(--theme-text-muted)]">Le texte de la question n’a pas été retrouvé : ouvre le ticket pour le lire.</p>}
        </Clamp>
      </>
    );
    controls = (
      <>
        <Composer
          bare
          ticketId={ticket.id}
          textareaRef={answerRef}
          value={draft}
          onChange={draftSetter(ticket.id)}
          onSend={send}
          submitOn="mod-enter"
          showSend={false}
          placeholder="Ta réponse… @ pour mentionner, colle une capture (⌘⏎ pour envoyer)"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => send()} title="l’agent repart aussitôt" className={cn(CTA_BASE, CTA_PRIMARY)}>
            Envoyer la réponse <kbd className="rounded border border-current px-1 font-mono text-[10px] opacity-60">⌘⏎</kbd>
          </button>
          {actions.map((a) => optionButton(a, false))}
        </div>
      </>
    );
  } else if (item.kind === 'error' && item.error) {
    const e = item.error;
    prompt = (
      <>
        <AskHeader hue={meta.hue}>
          Ce qui t’attend · {e.source === 'step' ? `l’étape « ${e.label} » a échoué` : `la session de ${e.label} a crashé`} il y a {wait}
        </AskHeader>
        <Clamp resetKey={item.key} className={tintClasses('red').text}>
          {e.message ?? (e.source === 'step'
            ? 'L’étape s’est arrêtée (crash, limite de tours ou redémarrage du serveur).'
            : 'La session s’est interrompue. Consulte les logs, puis relance.')}
        </Clamp>
      </>
    );
    controls = (
      <>
        <div className="flex flex-wrap items-center gap-2 text-xs"><ComposerExecBar exec={exec} /></div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => optionButton(a, false))}
          {e.executionId && (
            <button type="button" onClick={() => onOpenLogs(e.executionId!)} title="l’exécution en échec" className={cn(CTA_BASE, CTA_SECONDARY)}>
              Voir les logs
            </button>
          )}
          {launcherButton}
        </div>
      </>
    );
  } else {
    prompt = (
      <>
        <AskHeader hue={meta.hue}>Ce qui t’attend · inactif depuis {wait}</AskHeader>
        <Clamp resetKey={item.key}>
          {item.idle?.cliRestAt
            ? 'La session Claude du terminal est au repos : elle attend ta prochaine instruction. Reprends-la, lance un run, fais avancer le ticket, ou laisse un commentaire.'
            : <>Personne ne travaille sur ce ticket{item.idle?.lastActivityAt ? '' : ' et aucun agent n’y a encore travaillé'}. Commente pour relancer un agent, lance un run, ou fais-le avancer.</>}
        </Clamp>
      </>
    );
    controls = (
      <>
        {commentOpen && (
          // Escape here folds the composer back (the draft stays) instead of closing the popup.
          <div
            data-modal-escape-local
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || e.defaultPrevented) return;
              e.preventDefault();
              setCommentOpen(false);
              setTimeout(() => primaryRef.current?.focus(), 0);
            }}
          >
            <Composer
              bare
              ticketId={ticket.id}
              textareaRef={answerRef}
              value={draft}
              onChange={draftSetter(ticket.id)}
              onSend={comment}
              submitOn="mod-enter"
              placeholder="Ton commentaire… @ pour mentionner un agent et le relancer (⌘⏎ pour envoyer, Échap pour replier)"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            ref={primaryRef}
            type="button"
            aria-expanded={commentOpen}
            onClick={() => (commentOpen ? comment(draft) : openComment())}
            title={commentOpen ? 'envoie le commentaire et passe au suivant' : 'écrire un commentaire sur le ticket'}
            className={cn(CTA_BASE, CTA_PRIMARY)}
          >
            {commentOpen ? <>Envoyer le commentaire <kbd className="rounded border border-current px-1 font-mono text-[10px] opacity-60">⌘⏎</kbd></> : 'Commenter'}
          </button>
          {actions.map((a) => optionButton({ ...a, primary: false }, false))}
          {launcherButton}
        </div>
      </>
    );
  }

  const unseen = deliverables.filter((d) => !seen?.has(d.id)).length;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="focus-detail-title" inert={frozen} className="flex min-h-0 flex-1 flex-col">
      <header className="group grid shrink-0 gap-2 border-b border-[var(--theme-border)] px-5 pb-3.5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold', tint(meta.hue))}>
            <KindIcon kind={item.kind} />{meta.label}
          </span>
          <FocusStatusBadge ticket={ticket} />
          <FocusTicketLead ticket={ticket} />
          <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
          {board && <span className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-px text-[10.5px] text-[var(--theme-text-muted)]">{board.emoji} {board.name}</span>}
          <span className="flex-1" />
          <span className="font-mono text-[11.5px] text-[var(--theme-text-faint)]">{position}</span>
          <IconButton onClick={onPrev} label="Précédent (K)">‹</IconButton>
          <IconButton onClick={onNext} label="Suivant (J)">›</IconButton>
          <button
            type="button"
            onClick={onOpenTicket}
            title="Ouvrir le ticket dans la vue Tasks"
            className="h-7 rounded-md border border-[var(--theme-border-input)] px-2.5 text-xs font-medium text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]"
          >
            Ouvrir dans Tasks ↗
          </button>
          <IconButton onClick={onClose} label="Fermer (Échap)">✕</IconButton>
        </div>
        <div className="flex items-start gap-1.5">
          <h2 id="focus-detail-title" className="text-lg font-bold leading-tight text-[var(--theme-text-primary)] [text-wrap:balance]">{ticket.title}</h2>
          <span className="mt-1"><FocusFavoriteStar ticket={ticket} /></span>
          <span className="ml-auto mt-1 shrink-0 font-mono text-xs text-[var(--theme-text-muted)]" title="Coût cumulé du ticket">${item.costUsd.toFixed(2)}</span>
        </div>
        {prLinks.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1">
            {prLinks.map((l) => {
              const pr = parseGithubPrRef(l.ref);
              return pr ? (
                <PrBadge
                  key={l.id}
                  org={pr.org}
                  name={pr.name}
                  pr={{ number: pr.number, state: prStateFromGithub(prStates[l.ref]), title: l.label }}
                  href={l.url ?? undefined}
                />
              ) : (
                <a key={l.id} href={l.url ?? undefined} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)]">
                  {l.label}
                </a>
              );
            })}
          </div>
        )}
        {item.workflow && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] text-[var(--theme-text-muted)]">{item.workflow.emoji ? `${item.workflow.emoji} ` : ''}{item.workflow.name}</span>
            {item.workflow.steps.map((st, i) => (
              <span key={st.id} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-[11px] text-[var(--theme-text-faint)]">›</span>}
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px]',
                    st.state === 'current'
                      ? cn(tint(meta.hue), 'font-semibold')
                      : st.state === 'done'
                        ? 'border-[var(--theme-border-input)] text-[var(--theme-text-secondary)]'
                        : 'border-[var(--theme-border)] text-[var(--theme-text-faint)]',
                  )}
                >
                  {st.state === 'done' ? '✓ ' : ''}{st.name}
                </span>
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div role="tablist" className="flex shrink-0 gap-1 border-b border-[var(--theme-border)] px-5">
          <TabButton active={tab === 'thread'} onClick={() => setPref('detailTab', 'thread')}>Fil</TabButton>
          <TabButton active={tab === 'deliverables'} onClick={() => setPref('detailTab', 'deliverables')}>
            Livrables · {deliverables.length}
            {unseen > 0 && <span className={cn('ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle', tintClasses('pink').solid)} title={`${unseen} non lu${unseen > 1 ? 's' : ''}`} />}
          </TabButton>
        </div>
        {tab === 'thread' ? (
          <FocusThread ticket={ticket} deliverables={deliverables} onOpenLogs={onOpenLogs} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {deliverables.length === 0 ? (
              <span className="text-xs text-[var(--theme-text-faint)]">aucun livrable</span>
            ) : (
              <div className="flex flex-col gap-1">
                {[...deliverables].reverse().map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => openDeliverable(d)}
                    className="flex w-full items-center gap-2 rounded-md border border-[var(--theme-border)] px-2.5 py-1.5 text-left text-[12.5px] text-[var(--theme-text-primary)] hover:border-[var(--theme-border-input)]"
                  >
                    <DeliverableTypeBadge type={d.type} />
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    {!seen?.has(d.id) && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tintClasses('pink').solid)} title="Non lu" />}
                    <span className="max-w-[40%] shrink-0 truncate whitespace-nowrap text-[11px] text-[var(--theme-text-muted)]" title={`${d.agentName} · ${d.status}`}>{d.agentName} · {d.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <section className={cn('grid shrink-0 gap-2.5 border-t px-5 py-3', tintClasses(meta.hue).borderColor, tintClasses(meta.hue).bg)}>
        <div>{prompt}</div>
        {controls}
      </section>

      <footer className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-[var(--theme-border)] px-5 py-2.5 text-xs text-[var(--theme-text-muted)]">
        <span className="relative">
          <button
            type="button"
            onClick={() => setSnoozeOpen((v) => !v)}
            aria-expanded={snoozeOpen}
            className="h-7 rounded-md border border-[var(--theme-border-input)] px-2.5 text-xs font-medium text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]"
          >
            Plus tard ▾
          </button>
          {snoozeOpen && (
            <span className="absolute bottom-[calc(100%+6px)] left-0 z-10 grid min-w-[190px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-1 shadow-xl">
              {SNOOZE_CHOICES.map((c) => (
                <button key={c.label} type="button" onClick={() => onSnooze(c.until())} className="rounded px-2 py-1.5 text-left text-xs text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]">
                  {c.label}
                </button>
              ))}
            </span>
          )}
        </span>
        <label className="inline-flex cursor-pointer select-none items-center gap-1.5">
          <input type="checkbox" checked={chain} onChange={(e) => onChainChange(e.target.checked)} className="accent-[var(--theme-accent)]" />
          Après une action, ouvrir le suivant
        </label>
        <span className="flex-1" />
        <span className="hidden md:inline"><Kbd>←</Kbd><Kbd>→</Kbd> précédent/suivant · <Kbd>N</Kbd> suivant · <Kbd>S</Kbd> plus tard · <Kbd>Échap</Kbd> fermer</span>
      </footer>
    </div>
  );
}

function AskHeader({ hue, children }: { hue: Parameters<typeof tintClasses>[0]; children: React.ReactNode }) {
  return <div className={cn('mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em]', tintClasses(hue).text)}>{children}</div>;
}

/** Collapsed to ~2 lines with a "voir tout" toggle — the full text is in the Fil above. */
function Clamp({ resetKey, className, children }: { resetKey: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => { setExpanded(false); }, [resetKey]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  });
  return (
    <div className={cn('text-[13px] text-[var(--theme-text-primary)]', className)}>
      <div ref={ref} className={cn('grid gap-1 [&_p]:m-0', expanded ? 'max-h-48 overflow-y-auto' : 'max-h-[2.9em] overflow-hidden')}>{children}</div>
      {(overflows || expanded) && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-[11.5px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]">
          {expanded ? 'réduire' : 'voir tout'}
        </button>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-2.5 py-2 text-xs font-semibold transition-colors',
        active
          ? 'border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
          : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]',
      )}
    >
      {children}
    </button>
  );
}

function IconButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-md border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-primary)]"
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-1 font-mono text-[10px] text-[var(--theme-text-secondary)]">{children}</kbd>;
}
