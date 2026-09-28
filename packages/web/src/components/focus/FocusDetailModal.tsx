import { useEffect, useRef, useState } from 'react';
import type { Board, FocusItem, Ticket, TicketDeliverable } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/cn';
import { tint, tintClasses } from '../../lib/tints';
import { getStatusBadgeClass } from '../../lib/statusColors';
import { parseGithubPrRef } from '../../lib/prRef';
import { PriorityIndicator } from '../tickets/PriorityIndicator';
import { TicketTypeIcon } from '../tickets/TicketTypeBadge';
import { DeliverableTypeBadge } from '../ui/DeliverableTypeBadge';
import { MessageMarkdown } from '../work/task/MessageMarkdown';
import { useTicketDeliverables } from '../work/panel/useTicketDeliverables';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { useSessionStore } from '../../stores/sessionStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { useUIStore } from '../../stores/uiStore';
import { executeSkill } from '../../services/api';
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
  onSnooze: (until: number) => void;
  onOpenTicket: () => void;
  onOpenLogs: (executionId: string) => void;
}

function isFormField(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/.test(s.trim());
}

/**
 * The detail popup (blurred backdrop): just enough context to fire the next
 * agentic action with confidence — what is being asked, the choices and where
 * they lead, the agent's last message, the deliverables, the workflow position.
 * J/K move to the neighbouring item, 1–3 fire a choice, Esc closes.
 */
export function FocusDetailModal(props: Props) {
  const { item, ticket, board, actions, now, position, chain, onChainChange, onClose, onPrev, onNext, onAction, onAnswer, onSnooze, onOpenTicket, onOpenLogs } = props;
  const meta = KIND_META[item.kind];
  const [notes, setNotes] = useState('');
  const [snoozeOpen, setSnoozeOpen] = useState(false);
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
    const t = setTimeout(() => (item.kind === 'question' ? answerRef.current : primaryRef.current)?.focus(), 60);
    return () => clearTimeout(t);
  }, [item.key, item.kind]);

  const send = () => {
    const text = notes.trim();
    if (!text) { answerRef.current?.focus(); return; }
    onAnswer(text);
  };

  // Keyboard inside the popup (the page's own shortcuts are paused while it is open).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isFormField(e.target)) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); onNext(); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); onPrev(); }
      else if (/^[1-9]$/.test(e.key)) {
        const a = actions[Number(e.key) - 1];
        if (a) { e.preventDefault(); onAction(a, item.kind === 'gate' ? notes.trim() : undefined); }
      } else if (e.key === 's') { e.preventDefault(); onSnooze(SNOOZE_CHOICES[0]!.until()); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions, item.kind, notes, onAction, onNext, onPrev, onSnooze]);

  const openDeliverable = (d: TicketDeliverable) => {
    if (!seen?.has(d.id)) void toggleSeen(ticket.id, d.id, true).catch(() => {});
    if (isUrl(d.content)) window.open(d.content.trim(), '_blank', 'noopener');
    else openDeliverableOverlay(d);
  };

  const wait = formatWait(waitedMs(item, now));
  const prLinks = ticket.links.filter((l) => l.type === 'github_pr');
  const optionButton = (a: FocusAction, i: number, withNotes: boolean) => (
    <button
      key={a.id}
      ref={a.primary ? primaryRef : undefined}
      type="button"
      onClick={() => onAction(a, withNotes ? notes.trim() : undefined)}
      className={cn(
        'grid gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
        a.primary
          ? 'border-transparent bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]'
          : 'border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-primary)] hover:border-[var(--theme-text-muted)]',
      )}
    >
      <span className="flex items-center gap-2 text-[13px] font-semibold">
        {a.label}
        {i < 9 && <kbd className="ml-auto rounded border border-current px-1 font-mono text-[10px] opacity-60">{i + 1}</kbd>}
      </span>
      {a.hint && <span className="text-[11.5px] opacity-75">{a.hint}</span>}
    </button>
  );

  let ask: React.ReactNode;
  if (item.kind === 'gate' && item.gate) {
    ask = (
      <>
        <AskHeader hue={meta.hue}>Ce qui t’attend · {item.gate.stepName}{item.workflow ? ` · ${item.workflow.name}` : ''}</AskHeader>
        <p className="mb-2.5 text-[13px] text-[var(--theme-text-primary)]">
          {item.gate.mode === 'route'
            ? 'Plusieurs chemins correspondent : choisis celui que le workflow doit prendre.'
            : 'Le workflow est arrêté sur une étape humaine.'} En attente depuis {wait}.
        </p>
        {item.gate.context && <Quote hue={meta.hue}><MessageMarkdown body={item.gate.context} /></Quote>}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Commentaire joint à la décision (facultatif), lu par l’étape suivante"
          className="mb-2 w-full resize-y rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2 text-[13px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
        />
        {actions.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">{actions.map((a, i) => optionButton(a, i, true))}</div>
        ) : (
          <p className="text-xs text-[var(--theme-text-muted)]">Aucune issue configurée : résous cette gate depuis l’onglet Workflow du ticket.</p>
        )}
      </>
    );
  } else if (item.kind === 'question') {
    ask = (
      <>
        <AskHeader hue={meta.hue}>Ce qui t’attend · {item.question?.askedBy ? `${item.question.askedBy} ` : ''}a une question depuis {wait}</AskHeader>
        {item.question?.text
          ? <Quote hue={meta.hue}><MessageMarkdown body={item.question.text} /></Quote>
          : <p className="mb-2 text-xs text-[var(--theme-text-muted)]">Le texte de la question n’a pas été retrouvé : ouvre le ticket pour le lire.</p>}
        <textarea
          ref={answerRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
          }}
          rows={3}
          placeholder="Ta réponse… (⌘⏎ pour envoyer)"
          className="mb-2 w-full resize-y rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2 text-[13px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
          {actions.map((a, i) => optionButton(a, i, false))}
          <button
            type="button"
            onClick={send}
            className="grid gap-0.5 rounded-lg bg-[var(--theme-accent)] px-3 py-2.5 text-left text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]"
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold">Envoyer la réponse <kbd className="ml-auto rounded border border-current px-1 font-mono text-[10px] opacity-60">⌘⏎</kbd></span>
            <span className="text-[11.5px] opacity-75">l’agent repart aussitôt</span>
          </button>
        </div>
      </>
    );
  } else if (item.kind === 'error' && item.error) {
    const e = item.error;
    ask = (
      <>
        <AskHeader hue={meta.hue}>
          Ce qui t’attend · {e.source === 'step' ? `l’étape « ${e.label} » a échoué` : `la session de ${e.label} a crashé`} il y a {wait}
        </AskHeader>
        <p className={cn('mb-2.5 text-[13px]', tintClasses('red').text)}>
          {e.message ?? (e.source === 'step'
            ? 'L’étape s’est arrêtée (crash, limite de tours ou redémarrage du serveur).'
            : 'La session s’est interrompue. Consulte les logs, puis relance.')}
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
          {actions.map((a, i) => optionButton(a, i, false))}
          {e.executionId && (
            <button
              type="button"
              onClick={() => onOpenLogs(e.executionId!)}
              className="grid gap-0.5 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2.5 text-left text-[var(--theme-text-primary)] hover:border-[var(--theme-text-muted)]"
            >
              <span className="text-[13px] font-semibold">Voir les logs</span>
              <span className="text-[11.5px] opacity-75">l’exécution en échec</span>
            </button>
          )}
        </div>
        <p className="mt-2 text-[11.5px] text-[var(--theme-text-muted)]">Pour confier le ticket à un autre agent, skill ou workflow : bouton de session ci-dessous.</p>
      </>
    );
  } else {
    ask = (
      <>
        <AskHeader hue={meta.hue}>Ce qui t’attend · inactif depuis {wait}</AskHeader>
        <p className="mb-2.5 text-[13px] text-[var(--theme-text-primary)]">
          Personne ne travaille sur ce ticket{item.idle?.lastActivityAt ? '' : ' et aucun agent n’y a encore travaillé'}. Relance un agent, ou clos-le.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">{actions.map((a, i) => optionButton(a, i, false))}</div>
      </>
    );
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-[860px]" className="max-h-[88vh] overflow-y-auto p-0">
      <div role="dialog" aria-modal="true" aria-labelledby="focus-detail-title">
        <header className="grid gap-2 border-b border-[var(--theme-border)] px-5 pb-3.5 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold', tint(meta.hue))}>
              <KindIcon kind={item.kind} />{meta.label}
            </span>
            <TicketTypeIcon type={ticket.type} />
            <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
            <PriorityIndicator priority={ticket.priority} />
            {board && <span className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-px text-[10.5px] text-[var(--theme-text-muted)]">{board.emoji} {board.name}</span>}
            <span className={cn('rounded-full px-1.5 text-[10.5px] font-medium', getStatusBadgeClass(ticket.status))}>{TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}</span>
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
          <h2 id="focus-detail-title" className="text-lg font-bold leading-tight text-[var(--theme-text-primary)] [text-wrap:balance]">{ticket.title}</h2>
        </header>

        <section className={cn('mx-5 mt-4 rounded-xl border p-4', tintClasses(meta.hue).borderColor, tintClasses(meta.hue).bg)}>{ask}</section>

        <div className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="grid min-w-0 content-start gap-4">
            {item.lastAgentComment && (item.kind !== 'question' || item.lastAgentComment.body !== item.question?.text) && (
              <Section title={`Dernier message · ${item.lastAgentComment.authorName}`}>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-3 py-2 text-[12.5px] text-[var(--theme-text-secondary)]">
                  <MessageMarkdown body={item.lastAgentComment.body} />
                </div>
              </Section>
            )}
            <Section title={`Livrables · ${deliverables.length}`}>
              {deliverables.length === 0 ? (
                <span className="text-xs text-[var(--theme-text-faint)]">aucun livrable</span>
              ) : (
                <div className="grid gap-1">
                  {[...deliverables].reverse().map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => openDeliverable(d)}
                      className="flex w-full items-center gap-2 rounded-md border border-[var(--theme-border)] px-2.5 py-1.5 text-left text-[12.5px] text-[var(--theme-text-primary)] hover:border-[var(--theme-border-input)]"
                    >
                      <DeliverableTypeBadge type={d.type} />
                      <span className="min-w-0 truncate">{d.title}</span>
                      {!seen?.has(d.id) && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tintClasses('pink').solid)} title="Non lu" />}
                      <span className="ml-auto whitespace-nowrap text-[11px] text-[var(--theme-text-muted)]">{d.agentName} · {d.status}</span>
                    </button>
                  ))}
                </div>
              )}
            </Section>
          </div>
          <div className="grid min-w-0 content-start gap-4">
            {item.workflow && (
              <Section title={`${item.workflow.emoji ? `${item.workflow.emoji} ` : ''}${item.workflow.name}`}>
                <div className="flex flex-wrap items-center gap-1">
                  {item.workflow.steps.map((s, i) => (
                    <span key={s.id} className="inline-flex items-center gap-1">
                      {i > 0 && <span className="text-[11px] text-[var(--theme-text-faint)]">›</span>}
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[11px]',
                          s.state === 'current'
                            ? cn(tint(meta.hue), 'font-semibold')
                            : s.state === 'done'
                              ? 'border-[var(--theme-border-input)] text-[var(--theme-text-secondary)]'
                              : 'border-[var(--theme-border)] text-[var(--theme-text-faint)]',
                        )}
                      >
                        {s.state === 'done' ? '✓ ' : ''}{s.name}
                      </span>
                    </span>
                  ))}
                </div>
              </Section>
            )}
            <Section title="Contexte">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1.5 text-[12.5px]">
                <dt className="text-[var(--theme-text-muted)]">PR</dt>
                <dd className="flex min-w-0 flex-wrap gap-1">
                  {prLinks.length === 0 ? <span className="text-[var(--theme-text-faint)]">aucune</span> : prLinks.map((l) => {
                    const pr = parseGithubPrRef(l.ref);
                    const href = l.url ?? (pr ? `https://github.com/${pr.org}/${pr.name}/pull/${pr.number}` : undefined);
                    return (
                      <a key={l.id} href={href} target="_blank" rel="noopener noreferrer" className="rounded-md border border-[var(--theme-border-input)] px-1.5 font-mono text-[11px] text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)]">
                        {pr ? `${pr.name}#${pr.number}` : l.label}
                      </a>
                    );
                  })}
                </dd>
                <dt className="text-[var(--theme-text-muted)]">Coût</dt>
                <dd className="font-mono">${item.costUsd.toFixed(2)}</dd>
                <dt className="text-[var(--theme-text-muted)]">Session</dt>
                <dd>
                  <SmartSessionButton sessions={sessions} ticketId={ticket.id} onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)} />
                </dd>
              </dl>
            </Section>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2.5 border-t border-[var(--theme-border)] px-5 py-3 text-xs text-[var(--theme-text-muted)]">
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
          <span className="hidden md:inline"><Kbd>1</Kbd>–<Kbd>3</Kbd> choix · <Kbd>J</Kbd><Kbd>K</Kbd> suivant/précédent · <Kbd>S</Kbd> plus tard · <Kbd>Échap</Kbd> fermer</span>
        </footer>
      </div>
    </Modal>
  );
}

function AskHeader({ hue, children }: { hue: Parameters<typeof tintClasses>[0]; children: React.ReactNode }) {
  return <div className={cn('mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em]', tintClasses(hue).text)}>{children}</div>;
}

function Quote({ hue, children }: { hue: Parameters<typeof tintClasses>[0]; children: React.ReactNode }) {
  return (
    <div className={cn('mb-2.5 max-h-60 overflow-y-auto rounded-r-md border-l-[3px] bg-[var(--theme-bg-surface)] px-3 py-2 text-[13.5px] text-[var(--theme-text-primary)]', tintClasses(hue).borderColor)}>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--theme-text-faint)]">{title}</h4>
      {children}
    </section>
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
