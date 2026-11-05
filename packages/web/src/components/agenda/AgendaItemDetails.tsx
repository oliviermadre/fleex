import { useNavigate } from 'react-router-dom';
import type { AgendaItem } from '@fleex/shared';
import { Button } from '../ui/Button';
import { useRoutineStore } from '../../stores/routineStore';
import { LABEL_BY_TYPE, statusHue, dotStyle, hatchStyle } from './agendaLabels';
import { formatDuration, openWait, workflowShortName } from './agendaLayout';

const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function whenLine(item: AgendaItem, now: Date): string {
  if (item.shape === 'allDay') {
    const [y, m, d] = item.start.split('-').map(Number) as [number, number, number];
    return `${fmtDay(new Date(y, m - 1, d))} · all day`;
  }
  const start = new Date(item.start);
  if (item.shape === 'point') return `${fmtDay(start)} · ${fmtTime(start)}`;
  const end = item.end ? new Date(item.end) : null;
  const sameDay = end && end.toDateString() === start.toDateString();
  const endTxt = end ? (sameDay ? fmtTime(end) : `${fmtDay(end)} ${fmtTime(end)}`) : 'now';
  return `${fmtDay(start)} ${fmtTime(start)} → ${endTxt} · ${formatDuration((end ?? now).getTime() - start.getTime())}${end ? '' : ' so far'}`;
}

/**
 * What a click on an agenda item shows. The agenda only shows and redirects:
 * decisions, retries and launches happen on the ticket or the routine.
 */
export function AgendaItemDetails({ item, now, onClose }: { item: AgendaItem; now: Date; onClose: () => void }) {
  const navigate = useNavigate();
  const selectRoutine = useRoutineStore((s) => s.select);
  const label = LABEL_BY_TYPE[item.type];
  const openTicket = () => {
    if (!item.ticket) return;
    onClose();
    navigate(`/work/${item.ticket.id}`);
  };
  const openRoutine = () => {
    if (!item.routine) return;
    onClose();
    void selectRoutine(item.routine.id);
    navigate('/routines');
  };

  const segs = item.segments ?? [];
  const total = item.shape === 'block' ? (item.end ? new Date(item.end) : now).getTime() - new Date(item.start).getTime() : 0;
  const waitMs = (kind: 'gate' | 'question') =>
    segs.filter((s) => s.kind === kind).reduce((a, s) => a + ((s.end ? new Date(s.end) : now).getTime() - new Date(s.start).getTime()), 0);
  const wait = openWait(item);

  return (
    <div className="w-80 space-y-2 p-3 text-xs">
      <div className="flex items-start gap-2">
        <span className="text-base leading-5">{item.routine?.emoji || label.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--theme-text-primary)]">
            {item.ticket && item.type !== 'pr.merged' ? <span className="mr-1 tabular-nums">#{item.ticket.displayId}</span> : null}
            {item.title}
          </div>
          <div className="text-[var(--theme-text-muted)]">{label.label}</div>
        </div>
      </div>

      <div className="text-[var(--theme-text-secondary)]">{whenLine(item, now)}</div>

      {item.status && (
        <div className="flex items-center gap-1.5 text-[var(--theme-text-secondary)]">
          <span className="h-2 w-2 rounded-full" style={dotStyle(statusHue(item.status))} />
          {item.status.replace('_', ' ')}
        </div>
      )}

      {item.type === 'workflow.run' && (
        <div className="space-y-1">
          <div className="text-[var(--theme-text-secondary)]">
            <b>{workflowShortName(item.workflowName)}</b>
            {wait ? ` · ${wait.kind === 'gate' ? '⏸ waiting at' : '❓ agent question in'} ${wait.stepName} for ${formatDuration(now.getTime() - new Date(wait.start).getTime())}` : item.currentStep ? ` · ${item.currentStep}` : ''}
          </div>
          {segs.length > 0 && total > 0 && (
            <>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 text-[var(--theme-text-secondary)]">
                <span>Agents working</span><span>{formatDuration(total - waitMs('gate') - waitMs('question'))}</span>
                <span>Waiting at gates</span><span>{formatDuration(waitMs('gate'))} ({Math.round((waitMs('gate') / total) * 100)} %)</span>
                <span>Waiting on questions</span><span>{formatDuration(waitMs('question'))} ({Math.round((waitMs('question') / total) * 100)} %)</span>
              </div>
              <div className="max-h-28 space-y-0.5 overflow-y-auto">
                {segs.map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[var(--theme-text-muted)]">
                    <span className="inline-block h-2.5 w-3 rounded-sm" style={hatchStyle(s.kind)} />
                    {s.stepName} · {fmtTime(new Date(s.start))} → {s.end ? fmtTime(new Date(s.end)) : 'now'}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {item.type === 'routine.run' && item.triggeredFrom && item.triggeredFrom !== 'schedule' && (
        <div className="text-[var(--theme-text-muted)]">✋ launched manually</div>
      )}
      {item.type === 'routine.upcoming' && item.cron && (
        <div className="text-[var(--theme-text-muted)]">cron <code>{item.cron}</code>{item.timezone ? ` · ${item.timezone}` : ''}</div>
      )}
      {item.type === 'routine.skipped' && (
        <div className="text-[var(--theme-text-muted)]">Skipped: the previous run was still running (overlap).</div>
      )}
      {item.type === 'ticket.due' && item.overdue && (
        <div className="text-[var(--tint-red-text)]">Overdue — the ticket is still {item.ticket?.status}</div>
      )}
      {item.type === 'pr.merged' && item.ticket && (
        <div className="text-[var(--theme-text-muted)]">#{item.ticket.displayId} {item.ticket.title}</div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {item.ticket && <Button size="sm" variant="primary" onClick={openTicket}>Open ticket</Button>}
        {item.routine && <Button size="sm" variant={item.ticket ? 'secondary' : 'primary'} onClick={openRoutine}>Open routine</Button>}
        {item.prRef && (
          <Button
            size="sm"
            onClick={() => {
              const [repo, num] = item.prRef!.split('#');
              window.open(`https://github.com/${repo}/pull/${num}`, '_blank', 'noopener');
            }}
          >
            Open on GitHub ↗
          </Button>
        )}
      </div>
    </div>
  );
}
