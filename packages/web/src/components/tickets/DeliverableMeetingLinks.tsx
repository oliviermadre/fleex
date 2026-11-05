import { useEffect, useState } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import type { AgendaExternalLink } from '@fleex/shared';
import * as api from '../../services/api';
import { useAgendaStore } from '../../stores/agendaStore';
import { CalendarIcon } from '../ui/icons/AgendaIcons';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** An all-day start is a local 'YYYY-MM-DD' day, not a UTC instant. */
const startDate = (start: string) => new Date(DAY_RE.test(start) ? `${start}T00:00:00` : start);

const fmtWhen = (start: string) => {
  const d = startDate(start);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return DAY_RE.test(start) ? day : `${day} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

function Lines({ links, go }: { links: AgendaExternalLink[]; go: (l: AgendaExternalLink) => void }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/[0.06] px-5 py-1.5 text-[11px]" style={{ flexShrink: 0 }} data-testid="deliverable-meetings">
      {links.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => go(l)}
          title="Open this day in the agenda"
          className="flex min-w-0 items-center gap-1.5 self-start text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:underline"
        >
          <CalendarIcon size={12} className="shrink-0 text-[var(--theme-text-muted)]" />
          <span className="truncate">{l.provider === 'fleex' ? 'Event' : 'Meeting'}: {l.eventTitle} · {fmtWhen(l.eventStart)}</span>
        </button>
      ))}
    </div>
  );
}

function RoutedLines(props: { links: AgendaExternalLink[]; onGo: () => void }) {
  const navigate = useNavigate();
  return <Lines links={props.links} go={(l) => void openDay(l, props.onGo, () => navigate('/agenda'))} />;
}

/**
 * The stored prefs are loaded first when the agenda was never opened: loaded
 * after, they would put back the saved view mode over the Day view.
 */
async function openDay(l: AgendaExternalLink, close: () => void, toAgenda: () => void) {
  close();
  const agenda = useAgendaStore.getState();
  if (!agenda.prefsLoaded) await agenda.init().catch(() => {});
  useAgendaStore.getState().goToDay(startDate(l.eventStart), 'day');
  toAgenda();
}

/**
 * "Meeting: <title> · <when>" (Google, E3) / "Event: …" (free event, E1) lines
 * in the reading overlay, one per meeting or event the deliverable is attached to. Failures (501, older server) show nothing.
 */
export function DeliverableMeetingLinks({ deliverableId, onNavigate }: { deliverableId: string; onNavigate: () => void }) {
  const inRouter = useInRouterContext();
  const [links, setLinks] = useState<AgendaExternalLink[]>([]);
  useEffect(() => {
    let live = true;
    setLinks([]);
    Promise.resolve()
      .then(() => api.fetchAgendaExternalLinks({ deliverableId }))
      .then((l) => live && setLinks(Array.isArray(l) ? l : []))
      .catch(() => {});
    return () => { live = false; };
  }, [deliverableId]);

  if (links.length === 0) return null;
  if (inRouter) return <RoutedLines links={links} onGo={onNavigate} />;
  return <Lines links={links} go={(l) => void openDay(l, onNavigate, () => { window.location.href = '/agenda'; })} />;
}
