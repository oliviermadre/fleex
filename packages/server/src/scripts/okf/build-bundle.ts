/**
 * Pure core of the OKF export: turns a snapshot of Fleex knowledge DTOs into a
 * deterministic list of `{ path, content }` files forming an OKF v0.1 bundle.
 *
 * This module performs NO I/O and reads NO clock — given identical input it
 * returns byte-identical output (spec §7). The CLI (`export-okf.ts`) is
 * responsible for loading DTOs from Supabase and writing these files to disk.
 */
import type {
  Board,
  TicketGroup,
  Ticket,
  TicketComment,
  TicketDeliverable,
  TicketMention,
  TicketGroupMembership,
  TicketRelationship,
  AgentPersona,
  Panel,
  Skill,
  WorkflowTemplate,
  WorkflowStep,
  WorkflowEdge,
  TicketLink,
} from '@fleex/shared';
import { frontmatter, type FmPair } from './frontmatter.js';
import { dayOf, firstLine, flatten, maxIso, summarizeOneLine, toZ } from './format.js';
import { assignSlugs, slugifyOr } from './slugify.js';

export interface OkfInput {
  boards: Board[];
  epics: TicketGroup[];
  tickets: Ticket[];
  comments: TicketComment[];
  deliverables: TicketDeliverable[];
  mentions: TicketMention[];
  memberships: TicketGroupMembership[];
  relationships: TicketRelationship[];
  personas: AgentPersona[];
  panels: Panel[];
  skills: Skill[];
  workflows: WorkflowTemplate[];
}

export interface OkfFile {
  /** Bundle-relative path, e.g. `tickets/0042-fix-login/ticket.md`. */
  path: string;
  content: string;
}

/** Canonical status display order for grouping (spec §5.1). */
const STATUS_ORDER = ['backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled'] as const;

// ── Comparators ───────────────────────────────────────────────────────────────

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Case-insensitive name compare, then id as a stable tie-break. */
const cmpName =
  <T>(name: (t: T) => string, id: (t: T) => string) =>
  (a: T, b: T): number =>
    cmpStr(name(a).toLowerCase(), name(b).toLowerCase()) || cmpStr(id(a), id(b));
/** `(createdAt, id)` compare — the canonical order for comments/deliverables/mentions. */
const cmpCreated =
  <T extends { createdAt: string; id: string }>() =>
  (a: T, b: T): number =>
    cmpStr(a.createdAt, b.createdAt) || cmpStr(a.id, b.id);

// ── File assembly ─────────────────────────────────────────────────────────────

/** A concept file: frontmatter block + body, single trailing newline. */
function conceptFile(path: string, fm: readonly FmPair[], body: string): OkfFile {
  const block = frontmatter(fm);
  const trimmed = body.trim();
  return { path, content: trimmed ? `${block}\n\n${trimmed}\n` : `${block}\n` };
}

/** An index/log file: no frontmatter (except the root index, handled separately). */
function plainFile(path: string, body: string): OkfFile {
  const trimmed = body.replace(/\n+$/, '');
  return { path, content: `${trimmed}\n` };
}

/** Join body sections, dropping empties, separated by a blank line. */
function sections(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join('\n\n');
}

function heading(title: string, body: string): string | null {
  const t = body.trim();
  return t ? `# ${title}\n\n${t}` : null;
}

// ── Bundle builder ────────────────────────────────────────────────────────────

export function buildBundle(input: OkfInput): OkfFile[] {
  // 1. Stable sort every collection (spec §7.1).
  const boards = [...input.boards].sort(cmpName((b) => b.name, (b) => b.id));
  const epics = [...input.epics].sort(cmpName((e) => e.name, (e) => e.id));
  const tickets = [...input.tickets].sort((a, b) => a.displayId - b.displayId || cmpStr(a.id, b.id));
  const personas = [...input.personas].sort(cmpName((p) => p.name, (p) => p.id));
  const panels = [...input.panels].sort(cmpName((p) => p.name, (p) => p.id));
  const skills = [...input.skills].sort(cmpName((s) => s.commandName, (s) => s.id));
  const workflows = [...input.workflows].sort(cmpName((w) => w.slug, (w) => w.id));

  // 2. Deterministic slugs.
  const boardSlug = assignSlugs(boards, (b) => b.id, (b) => b.name);
  const epicSlug = assignSlugs(epics, (e) => e.id, (e) => e.name);
  const personaSlug = assignSlugs(personas, (p) => p.id, (p) => p.name);
  const panelSlug = assignSlugs(panels, (p) => p.id, (p) => p.name);
  const skillSlug = assignSlugs(skills, (s) => s.id, (s) => s.commandName);
  const workflowSlug = assignSlugs(workflows, (w) => w.id, (w) => w.slug);

  const ticketDir = new Map<string, string>(); // ticketId → `<NNNN>-<slug>`
  for (const t of tickets) {
    ticketDir.set(t.id, `${pad4(t.displayId)}-${slugifyOr(t.title)}`);
  }

  // 3. Lookups & groupings.
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const personaById = new Map(personas.map((p) => [p.id, p]));

  const publicCommentsByTicket = groupBy(
    input.comments.filter((c) => c.visibility === 'public'),
    (c) => c.ticketId,
  );
  for (const list of publicCommentsByTicket.values()) list.sort(cmpCreated());

  const deliverablesByTicket = groupBy(input.deliverables, (d) => d.ticketId);
  for (const list of deliverablesByTicket.values()) list.sort(cmpCreated());
  // ordinal (01, 02, …) and slug per deliverable, derived from the sorted order.
  const deliverableMeta = new Map<string, { ordinal: string; slug: string }>();
  for (const list of deliverablesByTicket.values()) {
    list.forEach((d, i) => {
      deliverableMeta.set(d.id, { ordinal: pad2(i + 1), slug: slugifyOr(d.title) });
    });
  }

  const mentionsByTicket = groupBy(input.mentions, (m) => m.ticketId);
  for (const list of mentionsByTicket.values()) list.sort(cmpCreated());

  const ticketIdsByEpic = groupBy(input.memberships, (m) => m.groupId);
  const epicsByBoard = new Map<string, TicketGroup[]>();
  for (const e of epics) {
    for (const bid of e.boardIds) {
      (epicsByBoard.get(bid) ?? epicsByBoard.set(bid, []).get(bid)!).push(e);
    }
  }
  const epicsByTicket = new Map<string, TicketGroup[]>();
  for (const m of input.memberships) {
    const epic = epics.find((e) => e.id === m.groupId);
    if (epic) (epicsByTicket.get(m.ticketId) ?? epicsByTicket.set(m.ticketId, []).get(m.ticketId)!).push(epic);
  }

  const childrenByTicket = groupBy(input.relationships, (r) => r.parentId);
  const parentsByTicket = groupBy(input.relationships, (r) => r.childId);

  // Link builders (always produced from deterministic slug maps, never re-derived).
  const ticketLink = (id: string): string | null => {
    const dir = ticketDir.get(id);
    return dir ? `/tickets/${dir}/ticket.md` : null;
  };
  const boardLink = (id: string): string | null => {
    const s = boardSlug.get(id);
    return s ? `/boards/${s}.md` : null;
  };
  const epicLink = (id: string): string | null => {
    const s = epicSlug.get(id);
    return s ? `/epics/${s}.md` : null;
  };

  const files: OkfFile[] = [];

  // ── Boards ──
  for (const board of boards) {
    const slug = boardSlug.get(board.id)!;
    const boardTickets = tickets.filter((t) => t.boardId === board.id);
    const statusCount = new Set(boardTickets.map((t) => t.status)).size;
    const title = withEmoji(board.emoji, board.name);

    const epicsBody = (epicsByBoard.get(board.id) ?? [])
      .map((e) => bullet(withEmoji(e.emoji, e.name), epicLink(e.id), summarizeOneLine(e.description)))
      .join('\n');

    const ticketsBody = STATUS_ORDER.map((status) => {
      const group = boardTickets.filter((t) => t.status === status);
      if (group.length === 0) return '';
      const items = group
        .map((t) => bullet(t.title, ticketLink(t.id), summarizeOneLine(t.description)))
        .join('\n');
      return `## ${status}\n\n${items}`;
    })
      .filter(Boolean)
      .join('\n\n');

    files.push(
      conceptFile(
        `boards/${slug}.md`,
        [
          ['type', 'Fleex Board'],
          ['title', title],
          ['description', `${boardTickets.length} tickets across ${statusCount} statuses.`],
          ['tags', ['board']],
          ['timestamp', toZ(maxIso(board.updatedAt, board.createdAt))],
          ['fleex_id', board.id],
          ['fleex_kind', 'board'],
        ],
        sections(heading('Epics', epicsBody), heading('Tickets', ticketsBody)),
      ),
    );
  }

  // ── Epics ──
  for (const epic of epics) {
    const slug = epicSlug.get(epic.id)!;
    const memberIds = (ticketIdsByEpic.get(epic.id) ?? []).map((m) => m.ticketId);
    const memberTickets = tickets
      .filter((t) => memberIds.includes(t.id))
      .sort((a, b) => a.displayId - b.displayId);

    const boardsBody = epic.boardIds
      .map((bid) => {
        const b = boardById.get(bid);
        return b ? bullet(withEmoji(b.emoji, b.name), boardLink(bid)) : null;
      })
      .filter(Boolean)
      .join('\n');

    const ticketsBody = memberTickets
      .map((t) => bullet(t.title, ticketLink(t.id), summarizeOneLine(t.description)))
      .join('\n');

    files.push(
      conceptFile(
        `epics/${slug}.md`,
        [
          ['type', 'Fleex Epic'],
          ['title', withEmoji(epic.emoji, epic.name)],
          ['description', summarizeOneLine(epic.description) || epic.name],
          ['tags', ['epic', epic.timeframe, epic.groupStatus]],
          ['timestamp', toZ(maxIso(epic.updatedAt, epic.createdAt))],
          ['fleex_id', epic.id],
          ['fleex_kind', 'epic'],
          ['fleex_timeframe', epic.timeframe],
          ['fleex_status', epic.groupStatus],
          ['fleex_blocked', epic.blocked],
        ],
        sections(
          heading('Description', epic.description),
          heading('Boards', boardsBody),
          heading('Tickets', ticketsBody),
        ),
      ),
    );
  }

  // ── Tickets (one folder each) ──
  for (const ticket of tickets) {
    const dir = ticketDir.get(ticket.id)!;
    const comments = publicCommentsByTicket.get(ticket.id) ?? [];
    const deliverables = deliverablesByTicket.get(ticket.id) ?? [];
    const mentions = mentionsByTicket.get(ticket.id) ?? [];
    const ticketEpics = (epicsByTicket.get(ticket.id) ?? []).sort(cmpName((e) => e.name, (e) => e.id));

    // # Context
    const contextLines: string[] = [];
    const bLink = boardLink(ticket.boardId);
    if (bLink) {
      const b = boardById.get(ticket.boardId);
      contextLines.push(`- Board: [${withEmoji(b?.emoji ?? '', b?.name ?? ticket.boardId)}](${bLink})`);
    }
    for (const e of ticketEpics) {
      const l = epicLink(e.id);
      if (l) contextLines.push(`- Epic: [${withEmoji(e.emoji, e.name)}](${l})`);
    }
    for (const r of childrenByTicket.get(ticket.id) ?? []) {
      const l = ticketLink(r.childId);
      const child = tickets.find((t) => t.id === r.childId);
      if (l) contextLines.push(`- Child: [${child ? child.title : r.childId}](${l})`);
    }
    for (const r of parentsByTicket.get(ticket.id) ?? []) {
      const l = ticketLink(r.parentId);
      const parent = tickets.find((t) => t.id === r.parentId);
      if (l) contextLines.push(`- Parent: [${parent ? parent.title : r.parentId}](${l})`);
    }

    // # Discussion (link to the discussion concept)
    const discussionBody =
      comments.length > 0 ? `> Voir la [discussion](./discussion.md) (${comments.length} commentaires).` : '';

    // # Deliverables
    const deliverablesBody = deliverables
      .map((d) => {
        const meta = deliverableMeta.get(d.id)!;
        return `- [${d.title}](./deliverables/${meta.ordinal}-${meta.slug}.md) — ${d.type}, ${d.status}, v${d.version}`;
      })
      .join('\n');

    // # Handoffs
    const handoffsBody = mentions
      .map((m) => {
        const resolved = m.resolvedAt ? ` (resolved ${toZ(m.resolvedAt)})` : '';
        return `- ${m.sourceAgent ?? '—'} → ${m.targetAgent} · ${m.status}${resolved}`;
      })
      .join('\n');

    // # Links
    const linksBody = ticket.links.map(renderTicketLink).join('\n');

    files.push(
      conceptFile(
        `tickets/${dir}/ticket.md`,
        [
          ['type', 'Fleex Ticket'],
          ['title', ticket.title],
          ['description', summarizeOneLine(ticket.description)],
          ['tags', dedupe(['ticket', ticket.status, ticket.priority, ...ticket.tags])],
          ['timestamp', toZ(maxIso(ticket.updatedAt, ticket.createdAt))],
          ['fleex_id', ticket.id],
          ['fleex_kind', 'ticket'],
          ['fleex_display_id', ticket.displayId],
          ['fleex_status', ticket.status],
          ['fleex_priority', ticket.priority],
          ['fleex_type', ticket.type ?? null],
          ['fleex_board', boardSlug.get(ticket.boardId) ?? null],
          ['fleex_epics', ticketEpics.map((e) => epicSlug.get(e.id)!).filter(Boolean)],
          ['fleex_assignee', ticket.assignee ?? null],
          ['fleex_blocked', ticket.blocked],
          ['fleex_due_date', toZ(ticket.dueDate) || null],
          ['fleex_created_at', toZ(ticket.createdAt)],
        ],
        sections(
          heading('Description', ticket.description),
          heading('Context', contextLines.join('\n')),
          heading('Discussion', discussionBody),
          heading('Deliverables', deliverablesBody),
          heading('Handoffs', handoffsBody),
          heading('Links', linksBody),
        ),
      ),
    );

    // ── discussion.md (only when ≥1 public comment) ──
    if (comments.length > 0) {
      const ts = comments.reduce((acc, c) => maxIso(acc, c.updatedAt), ticket.updatedAt);
      files.push(
        conceptFile(
          `tickets/${dir}/discussion.md`,
          [
            ['type', 'Fleex Discussion'],
            ['title', `Discussion — ${ticket.title}`],
            ['description', `${comments.length} commentaires publics sur le ticket #${ticket.displayId}.`],
            ['tags', ['discussion']],
            ['timestamp', toZ(ts)],
            ['fleex_kind', 'discussion'],
            ['fleex_ticket', dir],
            ['fleex_comment_count', comments.length],
          ],
          sections(
            `> Discussion du ticket [${ticket.title}](./ticket.md).`,
            renderThread(comments),
          ),
        ),
      );
    }

    // ── deliverables/*.md ──
    for (const d of deliverables) {
      const meta = deliverableMeta.get(d.id)!;
      files.push(
        conceptFile(
          `tickets/${dir}/deliverables/${meta.ordinal}-${meta.slug}.md`,
          [
            ['type', 'Fleex Deliverable'],
            ['title', d.title],
            ['description', `${d.type} by ${d.agentName} (v${d.version}, ${d.status})`],
            ['tags', dedupe(['deliverable', d.type, d.status])],
            ['timestamp', toZ(maxIso(d.updatedAt, d.createdAt))],
            ['fleex_id', d.id],
            ['fleex_kind', 'deliverable'],
            ['fleex_deliverable_type', d.type],
            ['fleex_version', d.version],
            ['fleex_status', d.status],
            ['fleex_ticket', dir],
            ['fleex_agent', d.agentName],
          ],
          sections(`> Produit pour le ticket [${ticket.title}](../ticket.md).`, d.content),
        ),
      );
    }
  }

  // ── Agents: personas ──
  for (const p of personas) {
    const slug = personaSlug.get(p.id)!;
    files.push(
      conceptFile(
        `agents/personas/${slug}.md`,
        [
          ['type', 'Fleex Agent Persona'],
          ['title', p.displayName || p.name],
          ['description', firstLine(p.soulMd) || firstLine(p.identityMd)],
          ['tags', ['agent', 'persona']],
          ['timestamp', toZ(maxIso(p.updatedAt, p.createdAt))],
          ['fleex_id', p.id],
          ['fleex_kind', 'persona'],
          ['fleex_name', p.name],
          ['fleex_model', p.model],
          ['fleex_human_mention', p.humanMentionName ?? null],
        ],
        sections(
          heading('Soul', p.soulMd),
          heading('Identity', p.identityMd),
          heading('Memory', p.memoryMd),
        ),
      ),
    );
  }

  // ── Agents: panels ──
  for (const panel of panels) {
    const slug = panelSlug.get(panel.id)!;
    const membersBody = [...panel.members]
      .sort((a, b) => a.order - b.order || cmpStr(a.personaId, b.personaId))
      .map((m) => {
        const persona = personaById.get(m.personaId);
        const name = persona ? persona.displayName || persona.name : m.personaId;
        const link = personaSlug.get(m.personaId);
        const label = link ? `[${name}](/agents/personas/${link}.md)` : name;
        const model = m.modelOverride && m.modelOverride !== 'inherited' ? ` — ${m.modelOverride}` : '';
        return `- ${label}${model}`;
      })
      .join('\n');
    const orchestrator = sections(
      panel.orchestratorModel ? `Model: ${panel.orchestratorModel}` : '',
      panel.orchestratorPrompt,
    );
    files.push(
      conceptFile(
        `agents/panels/${slug}.md`,
        [
          ['type', 'Fleex Panel'],
          ['title', panel.displayName || panel.name],
          ['description', summarizeOneLine(panel.description)],
          ['tags', ['agent', 'panel']],
          ['timestamp', toZ(maxIso(panel.updatedAt, panel.createdAt))],
          ['fleex_id', panel.id],
          ['fleex_kind', 'panel'],
          ['fleex_name', panel.name],
          ['fleex_enabled', panel.enabled],
        ],
        sections(
          heading('Description', panel.description),
          heading('Members', membersBody),
          heading('Orchestrator', orchestrator),
        ),
      ),
    );
  }

  // ── Agents: skills ──
  for (const skill of skills) {
    const slug = skillSlug.get(skill.id)!;
    const persona = skill.personaId ? personaById.get(skill.personaId) : undefined;
    const personaLink = persona && personaSlug.get(persona.id)
      ? `> Persona: [${persona.displayName || persona.name}](/agents/personas/${personaSlug.get(persona.id)}.md).`
      : '';
    files.push(
      conceptFile(
        `agents/skills/${slug}.md`,
        [
          ['type', 'Fleex Skill'],
          ['title', skill.displayName || skill.name],
          ['description', `/${skill.commandName}`],
          ['tags', ['agent', 'skill']],
          ['timestamp', toZ(maxIso(skill.updatedAt, skill.createdAt))],
          ['fleex_id', skill.id],
          ['fleex_kind', 'skill'],
          ['fleex_command', skill.commandName],
          ['fleex_persona', persona ? persona.name : null],
          ['fleex_enabled', skill.enabled],
        ],
        sections(personaLink, skill.markdownContent),
      ),
    );
  }

  // ── Agents: workflows ──
  for (const wf of workflows) {
    const slug = workflowSlug.get(wf.id)!;
    const orderedSteps = topoSteps(wf.steps, wf.edges, wf.entryStepId);
    const stepsBody = renderStepsTable(orderedSteps);
    const transitionsBody = renderEdgesTable(wf.edges, wf.steps);
    files.push(
      conceptFile(
        `agents/workflows/${slug}.md`,
        [
          ['type', 'Fleex Workflow'],
          ['title', withEmoji(wf.emoji, wf.name)],
          ['description', summarizeOneLine(wf.description)],
          ['tags', ['agent', 'workflow']],
          ['timestamp', toZ(maxIso(wf.updatedAt, wf.createdAt))],
          ['fleex_id', wf.id],
          ['fleex_kind', 'workflow'],
          ['fleex_slug', wf.slug],
          ['fleex_enabled', wf.enabled],
        ],
        sections(
          heading('Description', wf.description),
          heading('Steps', stepsBody),
          heading('Transitions', transitionsBody),
        ),
      ),
    );
  }

  // ── index.md files ──
  files.push(...buildIndexes({ boards, epics, tickets, personas, panels, skills, workflows }, {
    boardSlug,
    epicSlug,
    personaSlug,
    panelSlug,
    skillSlug,
    workflowSlug,
    ticketDir,
    publicCommentsByTicket,
    deliverablesByTicket,
    deliverableMeta,
  }));

  // ── log.md ──
  files.push(buildLog({ boards, epics, tickets, personas, panels, skills, workflows }, {
    boardSlug,
    epicSlug,
    personaSlug,
    panelSlug,
    skillSlug,
    workflowSlug,
    ticketDir,
    deliverablesByTicket,
    deliverableMeta,
  }));

  // Deterministic file ordering (does not affect bytes, but keeps the plan stable).
  files.sort((a, b) => cmpStr(a.path, b.path));
  return files;
}

// ── Index & log builders ──────────────────────────────────────────────────────

interface SlugMaps {
  boardSlug: Map<string, string>;
  epicSlug: Map<string, string>;
  personaSlug: Map<string, string>;
  panelSlug: Map<string, string>;
  skillSlug: Map<string, string>;
  workflowSlug: Map<string, string>;
  ticketDir: Map<string, string>;
  publicCommentsByTicket?: Map<string, TicketComment[]>;
  deliverablesByTicket: Map<string, TicketDeliverable[]>;
  deliverableMeta: Map<string, { ordinal: string; slug: string }>;
}

interface SortedCollections {
  boards: Board[];
  epics: TicketGroup[];
  tickets: Ticket[];
  personas: AgentPersona[];
  panels: Panel[];
  skills: Skill[];
  workflows: WorkflowTemplate[];
}

function buildIndexes(c: SortedCollections, m: SlugMaps): OkfFile[] {
  const files: OkfFile[] = [];

  // Root index.md — the ONLY index with frontmatter (okf_version).
  const rootBody = sections(
    `---\nokf_version: "0.1"\n---`,
    heading(
      'Boards',
      c.boards.map((b) => bullet(withEmoji(b.emoji, b.name), `boards/${m.boardSlug.get(b.id)}.md`)).join('\n'),
    ),
    heading(
      'Epics',
      c.epics.map((e) => bullet(withEmoji(e.emoji, e.name), `epics/${m.epicSlug.get(e.id)}.md`)).join('\n'),
    ),
    heading(
      'Tickets',
      c.tickets
        .map((t) => bullet(t.title, `tickets/${m.ticketDir.get(t.id)}/ticket.md`, summarizeOneLine(t.description)))
        .join('\n'),
    ),
    heading(
      'Agents',
      [
        '* [Personas](agents/personas/) - agent personas',
        '* [Panels](agents/panels/) - deliberation panels',
        '* [Skills](agents/skills/) - slash-command skills',
        '* [Workflows](agents/workflows/) - workflow templates',
      ].join('\n'),
    ),
  );
  files.push({ path: 'index.md', content: `${rootBody.replace(/\n+$/, '')}\n` });

  // boards/index.md, epics/index.md
  files.push(plainFile('boards/index.md', listIndex('Boards', c.boards.map((b) => ({
    title: withEmoji(b.emoji, b.name),
    url: `${m.boardSlug.get(b.id)}.md`,
    desc: '',
  })))));
  files.push(plainFile('epics/index.md', listIndex('Epics', c.epics.map((e) => ({
    title: withEmoji(e.emoji, e.name),
    url: `${m.epicSlug.get(e.id)}.md`,
    desc: summarizeOneLine(e.description),
  })))));

  // tickets/index.md (all tickets)
  files.push(plainFile('tickets/index.md', listIndex('Tickets', c.tickets.map((t) => ({
    title: t.title,
    url: `${m.ticketDir.get(t.id)}/ticket.md`,
    desc: summarizeOneLine(t.description),
  })))));

  // per-ticket index.md + deliverables/index.md
  for (const t of c.tickets) {
    const dir = m.ticketDir.get(t.id)!;
    const entries: IndexEntry[] = [{ title: t.title, url: 'ticket.md', desc: 'Ticket concept' }];
    if ((m.publicCommentsByTicket?.get(t.id) ?? []).length > 0) {
      entries.push({ title: 'Discussion', url: 'discussion.md', desc: 'Public comment thread' });
    }
    const deliverables = m.deliverablesByTicket.get(t.id) ?? [];
    if (deliverables.length > 0) {
      entries.push({ title: 'Deliverables', url: 'deliverables/', desc: `${deliverables.length} deliverables` });
    }
    files.push(plainFile(`tickets/${dir}/index.md`, listIndex(`Ticket #${t.displayId}`, entries)));

    if (deliverables.length > 0) {
      files.push(
        plainFile(
          `tickets/${dir}/deliverables/index.md`,
          listIndex(
            'Deliverables',
            deliverables.map((d) => {
              const meta = m.deliverableMeta.get(d.id)!;
              return { title: d.title, url: `${meta.ordinal}-${meta.slug}.md`, desc: `${d.type}, ${d.status}` };
            }),
          ),
        ),
      );
    }
  }

  // agents indexes
  files.push(plainFile('agents/index.md', listIndex('Agents', [
    { title: 'Personas', url: 'personas/', desc: 'agent personas' },
    { title: 'Panels', url: 'panels/', desc: 'deliberation panels' },
    { title: 'Skills', url: 'skills/', desc: 'slash-command skills' },
    { title: 'Workflows', url: 'workflows/', desc: 'workflow templates' },
  ])));
  files.push(plainFile('agents/personas/index.md', listIndex('Personas', c.personas.map((p) => ({
    title: p.displayName || p.name,
    url: `${m.personaSlug.get(p.id)}.md`,
    desc: firstLine(p.soulMd) || firstLine(p.identityMd),
  })))));
  files.push(plainFile('agents/panels/index.md', listIndex('Panels', c.panels.map((p) => ({
    title: p.displayName || p.name,
    url: `${m.panelSlug.get(p.id)}.md`,
    desc: summarizeOneLine(p.description),
  })))));
  files.push(plainFile('agents/skills/index.md', listIndex('Skills', c.skills.map((s) => ({
    title: s.displayName || s.name,
    url: `${m.skillSlug.get(s.id)}.md`,
    desc: `/${s.commandName}`,
  })))));
  files.push(plainFile('agents/workflows/index.md', listIndex('Workflows', c.workflows.map((w) => ({
    title: withEmoji(w.emoji, w.name),
    url: `${m.workflowSlug.get(w.id)}.md`,
    desc: summarizeOneLine(w.description),
  })))));

  return files;
}

function buildLog(c: SortedCollections, m: SlugMaps): OkfFile {
  interface LogItem { createdAt: string; id: string; title: string; path: string; }
  const items: LogItem[] = [];
  const add = (createdAt: string, id: string, title: string, path: string) =>
    items.push({ createdAt, id, title, path });

  for (const b of c.boards) add(b.createdAt, b.id, withEmoji(b.emoji, b.name), `/boards/${m.boardSlug.get(b.id)}.md`);
  for (const e of c.epics) add(e.createdAt, e.id, withEmoji(e.emoji, e.name), `/epics/${m.epicSlug.get(e.id)}.md`);
  for (const t of c.tickets) {
    const dir = m.ticketDir.get(t.id)!;
    add(t.createdAt, t.id, t.title, `/tickets/${dir}/ticket.md`);
    for (const d of m.deliverablesByTicket.get(t.id) ?? []) {
      const meta = m.deliverableMeta.get(d.id)!;
      add(d.createdAt, d.id, d.title, `/tickets/${dir}/deliverables/${meta.ordinal}-${meta.slug}.md`);
    }
  }
  for (const p of c.personas) add(p.createdAt, p.id, p.displayName || p.name, `/agents/personas/${m.personaSlug.get(p.id)}.md`);
  for (const p of c.panels) add(p.createdAt, p.id, p.displayName || p.name, `/agents/panels/${m.panelSlug.get(p.id)}.md`);
  for (const s of c.skills) add(s.createdAt, s.id, s.displayName || s.name, `/agents/skills/${m.skillSlug.get(s.id)}.md`);
  for (const w of c.workflows) add(w.createdAt, w.id, withEmoji(w.emoji, w.name), `/agents/workflows/${m.workflowSlug.get(w.id)}.md`);

  // Group by day, newest day first; within a day order by (createdAt, id).
  const byDay = new Map<string, LogItem[]>();
  for (const it of items) {
    const day = dayOf(it.createdAt) || 'unknown';
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(it);
  }
  const days = [...byDay.keys()].sort((a, b) => cmpStr(b, a));
  const body = days
    .map((day) => {
      const entries = byDay
        .get(day)!
        .sort((a, b) => cmpStr(a.createdAt, b.createdAt) || cmpStr(a.id, b.id))
        .map((it) => `* **Creation**: [${it.title}](${it.path})`)
        .join('\n');
      return `## ${day}\n\n${entries}`;
    })
    .join('\n\n');

  return plainFile('log.md', sections('# Update Log', body));
}

// ── Small pure helpers ─────────────────────────────────────────────────────────

interface IndexEntry { title: string; url: string; desc: string; }

function listIndex(title: string, entries: IndexEntry[]): string {
  const list = entries.map((e) => bullet(e.title, e.url, e.desc)).join('\n');
  return `# ${title}\n\n${list}`;
}

function bullet(title: string, url: string | null, desc?: string): string {
  const link = url ? `[${title}](${url})` : title;
  const suffix = desc && desc.trim() ? ` - ${desc.trim()}` : '';
  return `* ${link}${suffix}`;
}

function withEmoji(emoji: string | null | undefined, name: string): string {
  const e = (emoji ?? '').trim();
  return e ? `${e} ${name}`.trim() : name.trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    (map.get(k) ?? map.set(k, []).get(k)!).push(item);
  }
  return map;
}

function renderTicketLink(l: TicketLink): string {
  if (l.url) return `- [${l.label || l.ref}](${l.url})`;
  return `- ${l.type}: ${l.ref}${l.label ? ` (${l.label})` : ''}`;
}

/** Render public comments threaded by parentId, with 2-space indentation per depth. */
function renderThread(comments: TicketComment[]): string {
  const byParent = groupBy(comments, (c) => c.parentId ?? '__root__');
  const lines: string[] = [];
  const walk = (parentKey: string, depth: number) => {
    for (const c of byParent.get(parentKey) ?? []) {
      const indent = '  '.repeat(depth);
      const header = `${indent}**${c.authorName}** (${c.authorType}) · ${toZ(c.createdAt)}`;
      const body = c.body
        .split('\n')
        .map((line) => (line ? `${indent}${line}` : line))
        .join('\n');
      lines.push(`${header}\n\n${body}`);
      walk(c.id, depth + 1);
    }
  };
  walk('__root__', 0);
  return lines.join('\n\n');
}

/** Order steps by a deterministic BFS from the entry step, then append the rest by id. */
function topoSteps(steps: WorkflowStep[], edges: WorkflowEdge[], entryStepId: string): WorkflowStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const outgoing = groupBy(
    [...edges].sort((a, b) => cmpStr(a.source, b.source) || cmpStr(a.target, b.target) || cmpStr(a.id, b.id)),
    (e) => e.source,
  );
  const ordered: WorkflowStep[] = [];
  const visited = new Set<string>();
  const queue: string[] = byId.has(entryStepId) ? [entryStepId] : [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const step = byId.get(id);
    if (step) ordered.push(step);
    for (const e of outgoing.get(id) ?? []) {
      if (!visited.has(e.target)) queue.push(e.target);
    }
  }
  for (const s of [...steps].sort((a, b) => cmpStr(a.id, b.id))) {
    if (!visited.has(s.id)) ordered.push(s);
  }
  return ordered;
}

function renderStepsTable(steps: WorkflowStep[]): string {
  if (steps.length === 0) return '';
  const rows = steps
    .map((s) => `| ${s.id} | ${esc(s.name)} | ${s.executorType} | ${esc(s.executorRef)} | ${s.mode ?? ''} |`)
    .join('\n');
  return `| id | name | executorType | executorRef | mode |\n|----|------|--------------|-------------|------|\n${rows}`;
}

function renderEdgesTable(edges: WorkflowEdge[], steps: WorkflowStep[]): string {
  if (edges.length === 0) return '';
  const name = new Map(steps.map((s) => [s.id, s.name]));
  const rows = [...edges]
    .sort((a, b) => cmpStr(a.source, b.source) || cmpStr(a.target, b.target) || cmpStr(a.id, b.id))
    .map((e) => {
      const cond = e.condition ? `${e.condition.field} ${e.condition.operator} ${JSON.stringify(e.condition.value)}` : '';
      const src = name.get(e.source) ?? e.source;
      const tgt = name.get(e.target) ?? e.target;
      return `| ${esc(src)} | ${esc(tgt)} | ${esc(cond)} | ${e.isDefault} |`;
    })
    .join('\n');
  return `| source | target | condition | default |\n|--------|--------|-----------|---------|\n${rows}`;
}

/** Escape a value for safe inclusion inside a markdown table cell. */
function esc(s: string): string {
  return flatten(s).replace(/\|/g, '\\|');
}
