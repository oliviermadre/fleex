import type { CommandDef } from '../../../core/types.ts';
import { c, statusColor, isJsonMode } from '../../../core/colors.ts';
import { apiBase, apiGet, apiCall } from '../../../core/api.ts';
import { resolveTicketId, colorizeCost } from '../_shared.ts';

interface ShowOptions {
  board?: string;
  withComments?: boolean;
  withDeliverables?: boolean;
  full?: boolean;
}

interface Link { type: string; label?: string; url?: string; ref?: string }
interface Ticket {
  id: string;
  displayId: number;
  title: string;
  status: string;
  priority: string;
  type?: string | null;
  assignee?: string | null;
  tags?: string[];
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  dueDate?: string;
  blocked?: boolean;
  favorite?: boolean;
  links?: Link[];
}
interface Epic { id: string; name?: string; emoji?: string }
interface Comment { authorType: string; authorName: string; createdAt: string; body: string }
interface Deliverable { title: string; type: string; agentName: string; status: string; version: number | string; content: string }
interface AgentActivity { ticketId: string; cumulativeCostUsd: number }

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  aliases: ['view'],
  description: 'Show ticket details (use --full for comments + deliverables)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID (e.g. 42 or #42) or full UUID');
    cmd.option('--board <id>', 'Disambiguate by board when multiple boards share displayIds');
    cmd.option('--with-comments', 'Include comments');
    cmd.option('--with-deliverables', 'Include deliverables');
    cmd.option('--full', 'Include both comments and deliverables');
  },
  action: async (idArg: string, opts: ShowOptions) => {
    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();
    const [ticket, ticketEpics, activity] = await Promise.all([
      apiGet<Ticket>(`${base}/api/tickets/${uuid}`),
      apiGet<Epic[]>(`${base}/api/tickets/${uuid}/epics`),
      // Cumulative agentic cost (#404) rides on the same endpoint the Kanban
      // board uses. It's a secondary detail — a failure here must not sink the
      // whole `show`, so recover to null and render it as "-".
      apiCall<AgentActivity[]>('GET', `${base}/api/tickets/agent-activity?ticketIds=${encodeURIComponent(uuid)}`)
        .catch(() => null),
    ]);
    const cumulativeCostUsd = activity?.[0]?.cumulativeCostUsd ?? null;

    const epicLabel = ticketEpics.length === 0
      ? '-'
      : ticketEpics
          .map((e) => `${e.emoji ? e.emoji + ' ' : ''}${e.name ?? ''}`.trim())
          .filter((s) => s !== '')
          .join(', ') || '-';

    if (isJsonMode()) {
      const includeComments = opts.withComments || opts.full;
      const includeDeliverables = opts.withDeliverables || opts.full;
      const [comments, deliverables] = await Promise.all([
        includeComments ? apiGet<Comment[]>(`${base}/api/tickets/${uuid}/comments`) : Promise.resolve(undefined),
        includeDeliverables ? apiGet<Deliverable[]>(`${base}/api/tickets/${uuid}/deliverables`) : Promise.resolve(undefined),
      ]);
      const payload = {
        ...ticket,
        uuid,
        epics: ticketEpics,
        cumulativeCostUsd,
        ...(comments ? { comments } : {}),
        ...(deliverables ? { deliverables } : {}),
      };
      process.stdout.write(JSON.stringify(payload) + '\n');
      return;
    }

    const colored = statusColor(ticket.status)(ticket.status);
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold(`Ticket #${ticket.displayId}`)}  ${colored} | ${ticket.priority}\n`);
    process.stdout.write(`  ─────────────────────────────────────────────────────────\n`);
    process.stdout.write(`  ${c.bold('Title:')}       ${ticket.title}\n`);
    process.stdout.write(`  ${c.bold('Type:')}        ${ticket.type ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('Cost:')}        ${cumulativeCostUsd === null ? '-' : colorizeCost(cumulativeCostUsd)}\n`);
    process.stdout.write(`  ${c.bold('Assignee:')}    ${ticket.assignee ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('Tags:')}        ${ticket.tags?.length ? ticket.tags.join(', ') : '-'}\n`);
    process.stdout.write(`  ${c.bold('Epic:')}        ${epicLabel}\n`);
    process.stdout.write(`  ${c.bold('Blocked:')}     ${ticket.blocked ?? false}\n`);
    process.stdout.write(`  ${c.bold('Favorite:')}    ${ticket.favorite ?? false}\n`);
    process.stdout.write(`  ${c.bold('Due:')}         ${ticket.dueDate ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('Created:')}     ${ticket.createdAt ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('Updated:')}     ${ticket.updatedAt ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('UUID:')}        ${c.dim(uuid)}\n`);

    if (ticket.description && ticket.description !== 'null') {
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold('Description:')}\n`);
      for (const line of ticket.description.split('\n')) {
        process.stdout.write(`    ${line}\n`);
      }
    }

    const links = ticket.links ?? [];
    const prs = links.filter((l) => l.type === 'github_pr');
    if (prs.length > 0) {
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold('Pull Requests:')}\n`);
      for (const l of prs) process.stdout.write(`    ${l.label ?? ''} ${l.url ?? ''}\n`);
    }
    const others = links.filter((l) => l.type !== 'github_pr');
    if (others.length > 0) {
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold('Links:')}\n`);
      for (const l of others) {
        process.stdout.write(`    [${l.type}] ${l.label ?? ''} ${l.url ?? l.ref ?? ''}\n`);
      }
    }

    const wantComments = opts.withComments || opts.full;
    const wantDeliverables = opts.withDeliverables || opts.full;

    if (wantComments) {
      const comments = await apiGet<Comment[]>(`${base}/api/tickets/${uuid}/comments`);
      process.stdout.write('\n');
      process.stdout.write('  ════════════════════════════════════════════════════════════\n');
      process.stdout.write(`  COMMENTS (${comments.length})\n`);
      process.stdout.write('  ════════════════════════════════════════════════════════════\n');
      if (comments.length === 0) {
        process.stdout.write(`\n    ${c.dim('No comments.')}\n`);
      }
      for (const cm of comments) {
        const color = cm.authorType === 'agent' ? c.cyan : cm.authorType === 'user' ? c.green : (s: string) => s;
        process.stdout.write('\n');
        process.stdout.write(`    ${color(c.bold(cm.authorName))} ${c.dim(`(${cm.authorType})`)}  ${c.dim(cm.createdAt)}\n`);
        for (const line of cm.body.split('\n')) {
          process.stdout.write(`      ${line}\n`);
        }
      }
    }

    if (wantDeliverables) {
      const deliverables = await apiGet<Deliverable[]>(`${base}/api/tickets/${uuid}/deliverables`);
      process.stdout.write('\n');
      process.stdout.write('  ════════════════════════════════════════════════════════════\n');
      process.stdout.write(`  DELIVERABLES (${deliverables.length})\n`);
      process.stdout.write('  ════════════════════════════════════════════════════════════\n');
      if (deliverables.length === 0) {
        process.stdout.write(`\n    ${c.dim('No deliverables.')}\n`);
      }
      for (const d of deliverables) {
        const sc = d.status === 'final' ? c.green : c.yellow;
        process.stdout.write('\n');
        process.stdout.write(`    ${c.bold(d.title)}  ${c.dim(`[${d.type}]`)}  by ${c.cyan(d.agentName)}  ${sc(d.status)}  ${c.dim(`v${d.version}`)}\n`);
        process.stdout.write('    ────────────────────────────────────────────────────────\n');
        for (const line of String(d.content).split('\n')) {
          process.stdout.write(`      ${line}\n`);
        }
      }
    }

    process.stdout.write('\n');
  },
};

export default def;
