import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Composer } from '../components/work/task/Composer';
import { cn } from '../lib/cn';
import { tint } from '../lib/tints';
import { useFactoryStore } from './factoryStore';
import { useFactoryTicket } from './useFactoryTicket';
import { needKind } from './needs';
import { RUNS } from './types';

/**
 * What the floor asks of someone about a ticket, asked where the conversation is: at the foot of its thread, above
 * the composer. A gate's decision with its optional reason, a question to answer, a failed run to run again; a ticket
 * someone set aside only says where it is put back. A Factory run creates no mention and no workflow step run, so
 * the thread's own "waiting for you" cards never fire for it: this is that signal. Nothing otherwise.
 */
/* the reason is never sent on its own: only a decision button sends it, with the outcome */
const noop = () => {};

export function FactoryThreadCard({ ticketId }: { ticketId: string }) {
  const seen = useFactoryTicket(ticketId);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const phase = seen?.ticket.phase;
  useEffect(() => { setReason(''); }, [ticketId, phase]);
  if (!seen) return null;
  const { ticket, machine } = seen, kind = needKind(ticket);
  if (!kind || kind === 'floor') return null;
  const store = useFactoryStore.getState();
  const station = machine?.kind === 'station' ? machine : null, inStation = !!station && RUNS.includes(station.exec);
  const name = station?.name || (station?.exec === 'human_gate' ? 'The gate' : 'The station');
  const run = (fn: () => Promise<void>) => { setBusy(true); void fn().catch(() => { /* the store already raised a toast */ }).finally(() => setBusy(false)); };

  const title = kind === 'decision' ? `${name} waits for your decision`
    : kind === 'failed' ? `${name}: the run failed`
    : kind === 'aside' ? `Set aside in ${name}`
    : inStation && ticket.phase === 'question' ? `${name} asked you a question` : 'An agent asked you a question';
  const detail = kind === 'decision' ? ''
    : kind === 'failed' ? ticket.note || 'See the execution log.'
    : kind === 'aside' ? 'Nothing runs on it there. Put it back from Context when you are done.'
    : inStation && ticket.phase === 'question' ? 'Your reply gives the ticket back to it.'
    : 'Reply here: the next station that takes the ticket reads your answer.';

  return (
    <div role={kind === 'aside' ? 'status' : 'alert'} aria-label="Factory"
      className={cn('mx-3 mb-2 flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 text-xs', tint(kind === 'failed' ? 'red' : kind === 'aside' ? 'gray' : 'yellow'))}>
      <span className="min-w-0 flex-1 basis-56">
        <span className="font-semibold">{title}</span>
        {detail && <span className="ml-2 break-words opacity-90">{detail}</span>}
      </span>
      {kind === 'decision' && station && (
        <div className="flex basis-full flex-wrap items-center gap-1.5">
          <div className="min-w-0 basis-full">
            <Composer bare ticketId={ticketId} value={reason} onChange={setReason} onSend={noop} submitOn="none" showExecBar={false} showSend={false} disabled={busy}
              placeholder="Reason (optional), kept in the thread: markdown, paste a screenshot or attach a file" />
          </div>
          {station.outcomes.map((o, i) => <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={busy} onClick={() => run(() => store.resolve(ticketId, o, reason))}>{o}</Button>)}
        </div>
      )}
      {kind === 'failed' && inStation && <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => store.putBack(ticketId))}>Run again</Button>}
    </div>
  );
}
