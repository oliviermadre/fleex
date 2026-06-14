import { describe, it, expect } from 'vitest';
import { buildBundle, type OkfInput } from '../../src/scripts/okf/build-bundle.js';
import type {
  Board,
  Ticket,
  TicketGroup,
  TicketComment,
  TicketDeliverable,
  TicketMention,
  AgentPersona,
  Panel,
  Skill,
  WorkflowTemplate,
} from '@fleex/shared';

// ── Fixture factories (only the fields buildBundle reads need to be realistic) ──

const board = (over: Partial<Board> = {}): Board => ({
  id: 'board-1',
  name: 'Engineering',
  emoji: '🛠️',
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-02T10:00:00.000Z',
  ...over,
});

const epic = (over: Partial<TicketGroup> = {}): TicketGroup => ({
  id: 'epic-1',
  boardIds: ['board-1'],
  boardId: 'board-1',
  name: 'OKF Export',
  emoji: '📦',
  color: 'blue',
  description: 'Materialize Fleex knowledge as OKF.\nSecond line.',
  timeframe: 'now',
  groupStatus: 'active',
  blocked: false,
  favorite: false,
  createdAt: '2026-05-01T09:00:00.000Z',
  updatedAt: '2026-05-03T09:00:00.000Z',
  ...over,
});

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 'ticket-1',
  boardId: 'board-1',
  displayId: 42,
  title: 'Fix login',
  description: 'The login button is broken. Investigate and fix.',
  status: 'doing',
  priority: 'high',
  type: 'fix',
  position: 1,
  tags: ['auth'],
  links: [],
  blocked: false,
  favorite: false,
  dueDate: null,
  assignee: 'builder',
  agentClaimedAt: null,
  githubMetadata: null,
  archivedAt: null,
  firstDoingAt: null,
  statusChangedAt: '2026-05-04T10:00:00.000Z',
  conversationMode: 'plan',
  modelOverride: null,
  effortOverride: null,
  fastMode: false,
  createdAt: '2026-05-04T08:00:00.000Z',
  updatedAt: '2026-05-05T08:00:00.000Z',
  ...over,
});

const comment = (over: Partial<TicketComment> = {}): TicketComment => ({
  id: 'comment-1',
  ticketId: 'ticket-1',
  authorType: 'user',
  authorName: 'NaS',
  body: 'Please prioritize this.',
  visibility: 'public',
  privateRecipients: [],
  mentions: [],
  parentId: null,
  createdAt: '2026-05-04T09:00:00.000Z',
  updatedAt: '2026-05-04T09:00:00.000Z',
  ...over,
});

const deliverable = (over: Partial<TicketDeliverable> = {}): TicketDeliverable => ({
  id: 'deliv-1',
  ticketId: 'ticket-1',
  agentName: 'builder',
  type: 'spec',
  title: 'Auth Spec',
  content: '# Spec\n\nThe content.',
  version: 2,
  status: 'final',
  mentionId: null,
  createdAt: '2026-05-04T11:00:00.000Z',
  updatedAt: '2026-05-04T12:00:00.000Z',
  ...over,
});

const persona = (over: Partial<AgentPersona> = {}): AgentPersona => ({
  id: 'persona-1',
  name: 'builder',
  displayName: 'The Builder',
  model: 'claude-opus-4-8',
  executionMode: 'edit',
  soulMd: 'I build things.\nClean, tested, shipped.',
  identityMd: 'Craftsman.',
  memoryMd: '',
  humanMentionName: null,
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-02T10:00:00.000Z',
  ...over,
});

const emptyInput = (): OkfInput => ({
  boards: [],
  epics: [],
  tickets: [],
  comments: [],
  deliverables: [],
  mentions: [],
  memberships: [],
  relationships: [],
  personas: [],
  panels: [],
  skills: [],
  workflows: [],
});

const fileMap = (input: OkfInput): Map<string, string> =>
  new Map(buildBundle(input).map((f) => [f.path, f.content]));

// ── Tests ──

describe('buildBundle — structure', () => {
  it('puts the ticket concept in ticket.md (never in index.md) under a per-ticket folder', () => {
    const files = fileMap({ ...emptyInput(), boards: [board()], tickets: [ticket()] });
    expect(files.has('tickets/0042-fix-login/ticket.md')).toBe(true);
    // index.md is a reserved listing file: it must NOT carry frontmatter.
    const idx = files.get('tickets/0042-fix-login/index.md')!;
    expect(idx.startsWith('---')).toBe(false);
    const concept = files.get('tickets/0042-fix-login/ticket.md')!;
    expect(concept).toMatch(/^---\ntype: Fleex Ticket\n/);
  });

  it('omits discussion.md when there is no public comment, includes it otherwise', () => {
    const withoutComments = fileMap({ ...emptyInput(), boards: [board()], tickets: [ticket()] });
    expect(withoutComments.has('tickets/0042-fix-login/discussion.md')).toBe(false);

    const withPrivateOnly = fileMap({
      ...emptyInput(),
      boards: [board()],
      tickets: [ticket()],
      comments: [comment({ visibility: 'private' })],
    });
    expect(withPrivateOnly.has('tickets/0042-fix-login/discussion.md')).toBe(false);

    const withPublic = fileMap({
      ...emptyInput(),
      boards: [board()],
      tickets: [ticket()],
      comments: [comment()],
    });
    expect(withPublic.has('tickets/0042-fix-login/discussion.md')).toBe(true);
    expect(withPublic.get('tickets/0042-fix-login/discussion.md')!).toContain('**NaS** (user)');
  });

  it('renders a deliverable with a backlink to its parent ticket and full content', () => {
    const files = fileMap({
      ...emptyInput(),
      boards: [board()],
      tickets: [ticket()],
      deliverables: [deliverable()],
    });
    const path = 'tickets/0042-fix-login/deliverables/01-auth-spec.md';
    expect(files.has(path)).toBe(true);
    const content = files.get(path)!;
    expect(content).toContain('](../ticket.md)');
    expect(content).toContain('# Spec\n\nThe content.');
    expect(content).toMatch(/^---\ntype: Fleex Deliverable\n/);
    // ticket.md links to the deliverable
    expect(files.get('tickets/0042-fix-login/ticket.md')!).toContain(
      './deliverables/01-auth-spec.md',
    );
  });

  it('numbers deliverables deterministically by (createdAt, id)', () => {
    const files = fileMap({
      ...emptyInput(),
      boards: [board()],
      tickets: [ticket()],
      deliverables: [
        deliverable({ id: 'd-b', title: 'Second', createdAt: '2026-05-04T12:00:00.000Z' }),
        deliverable({ id: 'd-a', title: 'First', createdAt: '2026-05-04T11:00:00.000Z' }),
      ],
    });
    expect(files.has('tickets/0042-fix-login/deliverables/01-first.md')).toBe(true);
    expect(files.has('tickets/0042-fix-login/deliverables/02-second.md')).toBe(true);
  });

  it('root index.md is the only index with frontmatter and declares okf_version', () => {
    const files = fileMap({ ...emptyInput(), boards: [board()], tickets: [ticket()] });
    expect(files.get('index.md')!).toMatch(/^---\nokf_version: "0.1"\n---/);
    expect(files.get('boards/index.md')!.startsWith('---')).toBe(false);
  });
});

describe('buildBundle — conformance & determinism', () => {
  const fullInput = (): OkfInput => ({
    ...emptyInput(),
    boards: [board()],
    epics: [epic()],
    tickets: [ticket()],
    comments: [comment(), comment({ id: 'c-2', authorName: 'builder', authorType: 'agent', parentId: 'comment-1', body: 'On it.' })],
    deliverables: [deliverable()],
    mentions: [
      {
        id: 'm-1',
        ticketId: 'ticket-1',
        commentId: 'comment-1',
        targetAgent: 'builder',
        sourceAgent: 'catalyst',
        targetType: 'agent',
        executionMode: 'edit',
        status: 'resolved',
        resolvedAt: '2026-05-05T08:00:00.000Z',
        resolvedCommentId: null,
        resolvedDeliverableId: 'deliv-1',
        createdAt: '2026-05-04T10:30:00.000Z',
      } satisfies TicketMention,
    ],
    memberships: [{ ticketId: 'ticket-1', groupId: 'epic-1' }],
    relationships: [],
    personas: [persona()],
    panels: [
      {
        id: 'panel-1',
        name: 'archi-committee',
        displayName: 'Architecture Committee',
        description: 'Reviews big decisions.',
        executionMode: 'plan',
        members: [{ personaId: 'persona-1', order: 0, modelOverride: 'inherited' }],
        orchestratorPrompt: 'Synthesize the members.',
        orchestratorModel: 'claude-opus-4-8',
        orchestratorPersonaId: null,
        defaultMemberModel: 'claude-sonnet-4-6',
        enabled: true,
        createdAt: '2026-04-05T10:00:00.000Z',
        updatedAt: '2026-04-06T10:00:00.000Z',
      } satisfies Panel,
    ],
    skills: [
      {
        id: 'skill-1',
        commandName: 'ship',
        name: 'ship',
        displayName: 'Ship',
        markdownContent: '# Ship\n\nCommit and PR.',
        enabled: true,
        personaId: 'persona-1',
        createdAt: '2026-04-07T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      } satisfies Skill,
    ],
    workflows: [
      {
        id: 'wf-1',
        name: 'Spec Dev PR',
        slug: 'spec-dev-pr',
        emoji: '🔁',
        description: 'Spec then build.',
        steps: [
          { id: 's2', name: 'Build', executorType: 'agent', executorRef: 'builder', position: { x: 1, y: 0 } },
          { id: 's1', name: 'Spec', executorType: 'agent', executorRef: 'catalyst', mode: 'plan', position: { x: 0, y: 0 } },
        ],
        edges: [{ id: 'e1', source: 's1', target: 's2', isDefault: true }],
        entryStepId: 's1',
        enabled: true,
        createdAt: '2026-04-09T10:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z',
      } satisfies WorkflowTemplate,
    ],
  });

  it('produces byte-identical output across repeated runs (same DB ⇒ same bytes)', () => {
    const a = buildBundle(fullInput());
    const b = buildBundle(fullInput());
    expect(a).toEqual(b);
    // and the concatenation is byte-identical
    expect(a.map((f) => `${f.path}\n${f.content}`).join(' ')).toBe(
      b.map((f) => `${f.path}\n${f.content}`).join(' '),
    );
  });

  it('every non-reserved .md concept has parseable frontmatter with a non-empty type', () => {
    const files = buildBundle(fullInput());
    for (const f of files) {
      const isIndex = f.path.endsWith('index.md');
      const isLog = f.path === 'log.md';
      if (isLog) continue;
      if (isIndex && f.path !== 'index.md') {
        expect(f.content.startsWith('---')).toBe(false); // sub-index: no frontmatter
        continue;
      }
      if (f.path === 'index.md') {
        expect(f.content).toMatch(/^---\nokf_version: "0.1"\n---/);
        continue;
      }
      const m = f.content.match(/^---\n([\s\S]*?)\n---/);
      expect(m, `frontmatter in ${f.path}`).not.toBeNull();
      expect(m![1]).toMatch(/(^|\n)type: .+/);
    }
  });

  it('contains no wall-clock dates: output is independent of when it runs', () => {
    // The only dates present come from the fixtures' updatedAt/createdAt.
    const blob = buildBundle(fullInput())
      .map((f) => f.content)
      .join('\n');
    // All timestamps are normalized to second precision and to fixture years.
    const dates = blob.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g) ?? [];
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(d.startsWith('2026-04') || d.startsWith('2026-05')).toBe(true);
    // no millisecond precision leaked through
    expect(blob).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it('cross-links the ticket to its board, epic, discussion and deliverable', () => {
    const files = new Map(buildBundle(fullInput()).map((f) => [f.path, f.content]));
    const t = files.get('tickets/0042-fix-login/ticket.md')!;
    expect(t).toContain('/boards/engineering.md');
    expect(t).toContain('/epics/okf-export.md');
    expect(t).toContain('./discussion.md');
    expect(t).toContain('./deliverables/01-auth-spec.md');
  });
});
