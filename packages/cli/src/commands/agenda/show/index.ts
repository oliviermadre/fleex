import type { AgendaExternalLink, AgendaItem } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { c, die, present } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { agendaRequest, describeAgendaError } from '../_shared.ts';
import { calendarsToRead, resolveItem, summarize, whenOf } from '../_read.ts';

interface DeliverableRow { id: string; title: string; type: string; status?: string; createdAt?: string }

const row = (d: DeliverableRow): DeliverableRow => ({ id: d.id, title: d.title, type: d.type, status: d.status, createdAt: d.createdAt });

/** Deliverables of the item's ticket and of its run — what the agenda card lists. */
async function deliverablesOf(item: AgendaItem): Promise<{ ticket: DeliverableRow[]; run: DeliverableRow[] }> {
  const base = apiBase();
  const [ticket, run] = await Promise.all([
    item.ticket
      ? agendaRequest<DeliverableRow[]>('GET', `${base}/api/tickets/${encodeURIComponent(item.ticket.id)}/deliverables`).then((r) => r.data.map(row), () => [])
      : Promise.resolve([]),
    item.runId
      ? agendaRequest<DeliverableRow[]>('GET', `${base}/api/agenda/runs/${encodeURIComponent(item.runId)}/deliverables`).then((r) => r.data.map(row), () => [])
      : Promise.resolve([]),
  ]);
  return { ticket, run };
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  aliases: ['view', 'get'],
  description:
    'Show one agenda item in full: when, status, ticket, routine; for a Google meeting the organizer, guests and their answers, my answer, the Meet link and notes; ' +
    'and the deliverables linked to it (with their ids, readable with `fleex deliverable show <id>`).',
  setup(cmd) {
    cmd.argument('<item>', 'Agenda item ref (ag_… from `agenda list` / `search`), or event:<id> for a free event');
    cmd.option('--calendar <ids>', 'Google calendar ids to read (default: the calendars picked in the agenda preferences)');
  },
  action: async (ref: string, opts: { calendar?: string }) => {
    let resolved;
    let delivs;
    try {
      resolved = await resolveItem(ref, await calendarsToRead(opts.calendar));
      if ('error' in resolved) die(resolved.error);
      delivs = await deliverablesOf(resolved.item);
    } catch (err) {
      die(describeAgendaError(err));
    }
    const it = resolved.item;
    const ext = it.external ?? null;
    const links: AgendaExternalLink[] = ext?.links ?? it.eventLinks ?? [];
    const meeting = ext ? {
      calendarId: ext.calendarId, location: ext.location, meetUrl: ext.meetUrl ?? null, htmlLink: ext.htmlLink,
      organizer: ext.organizer ?? null, attendees: ext.attendeeList ?? [], rsvp: ext.rsvp ?? null, canRespond: ext.canRespond ?? false,
      notes: ext.description ?? null,
    } : null;
    const event = it.event ? {
      id: it.event.id, description: it.event.description, color: it.event.color, ticketId: it.event.ticketId, epicId: it.event.epicId,
      recurrence: it.event.recurrence, recurrenceUntil: it.event.recurrenceUntil,
    } : null;
    const linked = links.map((l) => ({ linkId: l.id, deliverableId: l.deliverableId, title: l.deliverableTitle, source: l.source }));
    present({
      ok: true, item: summarize(it), meeting, event, linkedDeliverables: linked,
      ticketDeliverables: delivs.ticket, runDeliverables: delivs.run,
      agent: it.agent ?? null, workflow: it.workflowName ? { name: it.workflowName, currentStep: it.currentStep ?? null, waits: it.segments ?? [] } : null,
    }, () => {
      const out = (s = '') => process.stdout.write(`${s}\n`);
      out();
      out(`  ${c.bold(it.title)}  ${c.dim(`[${it.type}]`)}${it.status ? `  ${it.status}` : ''}`);
      out(`  ${c.bold('When:')}      ${whenOf(it)}`);
      out(`  ${c.bold('Ref:')}       ${c.dim(resolved.ref)}`);
      if (it.ticket) out(`  ${c.bold('Ticket:')}    #${it.ticket.displayId} ${it.ticket.title} ${c.dim(it.ticket.id)}`);
      if (it.routine) out(`  ${c.bold('Routine:')}   ${it.routine.name} ${c.dim(it.routine.id)}`);
      if (it.workflowName) out(`  ${c.bold('Workflow:')}  ${it.workflowName}${it.currentStep ? ` · ${it.currentStep}` : ''}`);
      if (it.agent) out(`  ${c.bold('Agent:')}     ${it.agent.personaName ?? it.agent.personaId}${it.agent.model ? ` · ${it.agent.model}` : ''}${it.agent.costUsd != null ? ` · $${it.agent.costUsd.toFixed(2)}` : ''}`);
      if (event) {
        out(`  ${c.bold('Event:')}     ${c.dim(event.id)}${event.recurrence ? ` · repeats ${event.recurrence}${event.recurrenceUntil ? ` until ${event.recurrenceUntil}` : ''}` : ''}`);
        if (event.description) out(`  ${c.bold('Notes:')}     ${event.description}`);
      }
      if (meeting) {
        if (meeting.organizer) out(`  ${c.bold('Organizer:')} ${meeting.organizer.name ?? meeting.organizer.email}`);
        if (meeting.attendees.length) {
          out(`  ${c.bold('Guests:')}`);
          for (const a of meeting.attendees) out(`    ${a.name ?? a.email}${a.name ? c.dim(` <${a.email}>`) : ''}  ${c.dim(a.response)}`);
        }
        if (meeting.rsvp) out(`  ${c.bold('My answer:')} ${meeting.rsvp}`);
        if (meeting.meetUrl) out(`  ${c.bold('Meet:')}      ${meeting.meetUrl}`);
        if (meeting.location) out(`  ${c.bold('Where:')}     ${meeting.location}`);
        if (meeting.notes) out(`  ${c.bold('Notes:')}     ${meeting.notes.replace(/\n/g, '\n             ')}`);
      }
      const list = (title: string, rows: { id: string; title: string; type?: string }[]) => {
        if (!rows.length) return;
        out(`  ${c.bold(title)}`);
        for (const d of rows) out(`    ${d.id}  ${d.title}${d.type ? c.dim(` [${d.type}]`) : ''}`);
      };
      list('Linked deliverables:', linked.map((l) => ({ id: l.deliverableId, title: `${l.title} ${c.dim(`(link ${l.linkId})`)}` })));
      list('Ticket deliverables:', delivs.ticket);
      list('Run deliverables:', delivs.run);
      out();
    });
  },
};

export default def;
