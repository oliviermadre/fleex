/**
 * A Google meeting on the agenda card: join link, my answer (Yes / Maybe / No,
 * written to Google through gogcli), the notes and the guests with their
 * answers. The links to deliverables live in <AgendaMeetingLinks/>.
 */
import { useState, type ReactNode } from 'react';
import type { AgendaAttendee, AgendaItem, AgendaRsvp } from '@fleex/shared';
import * as api from '../../services/api';
import { useAgendaStore } from '../../stores/agendaStore';
import { cn } from '../../lib/cn';
import { Spinner } from '../ui/Spinner';
import { CheckIcon, CancelIcon, QuestionIcon, VideoIcon } from '../ui/icons/AgendaIcons';

type Answer = Exclude<AgendaRsvp, 'needsAction'>;

const ANSWERS: { value: Answer; label: string }[] = [
  { value: 'accepted', label: 'Yes' },
  { value: 'tentative', label: 'Maybe' },
  { value: 'declined', label: 'No' },
];

export const RSVP_LABEL: Record<AgendaRsvp, string> = {
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Declined',
  needsAction: 'Awaiting',
};

/** Selected answer button: the answer's own tint. */
const ANSWER_HUE: Record<Answer, 'green' | 'yellow' | 'red'> = { accepted: 'green', tentative: 'yellow', declined: 'red' };

/** The meeting as it is in the store now (an answer updates it), else as opened. */
function useLiveItem(item: AgendaItem): AgendaItem {
  return useAgendaStore((s) => s.data?.items.find((i) => i.id === item.id)) ?? item;
}

/** "Join Google Meet": a button that opens the video link in a new tab. */
export function MeetJoinButton({ url, compact }: { url: string; compact?: boolean }) {
  const isMeet = /meet\.google\.com/.test(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium text-white',
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
      )}
      style={{ background: 'var(--tint-blue-solid)' }}
      title={url}
    >
      <VideoIcon size={compact ? 12 : 14} />
      {isMeet ? 'Join Google Meet' : 'Join video call'}
    </a>
  );
}

/** Yes / Maybe / No, applied at once and sent to Google; reverted if Google refuses. */
function RsvpControl({ item }: { item: AgendaItem }) {
  const ext = item.external!;
  const applyLocalRsvp = useAgendaStore((s) => s.applyLocalRsvp);
  const refresh = useAgendaStore((s) => s.refresh);
  const [pending, setPending] = useState<Answer | null>(null);
  const current = ext.rsvp ?? 'needsAction';

  const answer = async (value: Answer) => {
    if (pending || value === current || !ext.eventId) return;
    const before = current;
    setPending(value);
    applyLocalRsvp(item.id, value);
    try {
      await api.respondToAgendaMeeting({ calendarId: ext.calendarId, eventId: ext.eventId, status: value });
      void refresh();
    } catch {
      // The API layer already showed Google's refusal (e.g. gog only has read-only access).
      applyLocalRsvp(item.id, before);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex items-center gap-2" data-testid="agenda-rsvp">
      <span className="text-[var(--theme-text-muted)]">Going?</span>
      <div className="inline-flex overflow-hidden rounded-md border border-[var(--theme-border-input)]">
        {ANSWERS.map((a) => {
          const on = current === a.value;
          return (
            <button
              key={a.value}
              type="button"
              aria-pressed={on}
              disabled={!!pending || !ext.eventId}
              onClick={() => void answer(a.value)}
              className={cn(
                'px-2.5 py-0.5 text-xs transition-colors disabled:cursor-default',
                !on && 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)]',
              )}
              style={on ? { background: `var(--tint-${ANSWER_HUE[a.value]}-bg)`, color: `var(--tint-${ANSWER_HUE[a.value]}-text)`, fontWeight: 600 } : undefined}
            >
              {a.label}
            </button>
          );
        })}
      </div>
      {pending && <Spinner size={12} />}
      {!pending && current === 'needsAction' && <span className="text-[var(--tint-yellow-text)]">Not answered yet</span>}
    </div>
  );
}

function ResponseIcon({ response }: { response: AgendaRsvp }) {
  const common = 'shrink-0';
  if (response === 'accepted') return <span title="Going" style={{ color: 'var(--tint-green-solid)' }} className={common}><CheckIcon size={12} /></span>;
  if (response === 'declined') return <span title="Declined" style={{ color: 'var(--tint-red-solid)' }} className={common}><CancelIcon size={12} /></span>;
  if (response === 'tentative') return <span title="Maybe" style={{ color: 'var(--tint-yellow-solid)' }} className={common}><QuestionIcon size={12} /></span>;
  return <span title="Awaiting" className={cn(common, 'inline-block h-3 w-3 rounded-full border border-dashed border-[var(--theme-text-faint)]')} />;
}

function AttendeeRow({ a }: { a: AgendaAttendee }) {
  return (
    <div className="flex items-center gap-1.5" title={a.email}>
      <ResponseIcon response={a.response} />
      <span className={cn('truncate', a.response === 'declined' ? 'text-[var(--theme-text-muted)] line-through' : 'text-[var(--theme-text-secondary)]')}>
        {a.name ?? a.email}{a.self ? ' (you)' : ''}
      </span>
      {a.organizer && <span className="shrink-0 text-[10.5px] text-[var(--theme-text-muted)]">organizer</span>}
      {a.optional && <span className="shrink-0 text-[10.5px] text-[var(--theme-text-muted)]">optional</span>}
    </div>
  );
}

/** "8 going · 1 maybe · 3 awaiting": the answers at a glance. */
export function attendeeSummary(list: readonly AgendaAttendee[]): string {
  const n = (r: AgendaRsvp) => list.filter((a) => a.response === r).length;
  return [
    [n('accepted'), 'going'],
    [n('tentative'), 'maybe'],
    [n('declined'), 'declined'],
    [n('needsAction'), 'awaiting'],
  ].filter(([c]) => (c as number) > 0).map(([c, l]) => `${c} ${l}`).join(' · ');
}

/** URLs in plain-text notes become links. */
function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /https?:\/\/[^\s)<>"']+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--tint-blue-text)] underline">{m[0]}</a>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1 border-t border-[var(--theme-border)] pt-2">
      <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">
        <span className="flex-1">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** The Google meeting part of the card. */
export function AgendaMeetingDetails({ item: opened }: { item: AgendaItem }) {
  const item = useLiveItem(opened);
  const ext = item.external;
  if (!ext) return null;
  const guests = ext.attendeeList ?? [];
  return (
    <>
      {(ext.meetUrl || ext.canRespond) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--theme-border)] pt-2">
          {ext.meetUrl && <MeetJoinButton url={ext.meetUrl} />}
          {ext.canRespond && <RsvpControl item={item} />}
        </div>
      )}
      {ext.location && (
        <div className="text-[var(--theme-text-secondary)]"><span className="text-[var(--theme-text-muted)]">Location </span><Linkified text={ext.location} /></div>
      )}
      {ext.description && (
        <Section title="Notes">
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[var(--theme-text-secondary)]" data-testid="agenda-meeting-notes">
            <Linkified text={ext.description} />
          </div>
        </Section>
      )}
      {guests.length > 0 && (
        <Section title={`Guests · ${guests.length}`} right={<span className="normal-case tracking-normal">{attendeeSummary(guests)}</span>}>
          <div className="max-h-40 space-y-0.5 overflow-y-auto" data-testid="agenda-meeting-guests">
            {guests.map((a) => <AttendeeRow key={a.email} a={a} />)}
          </div>
        </Section>
      )}
    </>
  );
}
