import { describe, it, expect } from 'vitest';
import type { AgentExecution, AgentThread, TicketActivity, TicketComment, TicketDeliverable } from '@fleex/shared';
import {
  parseModeRequest,
  stripModeRequest,
  threadTurns,
  threadMentionIds,
  lastAgentQuestion,
  threadActivityDetail,
  partitionQueue,
  parseInlineOptions,
  suggestionsFor,
  formatActivity,
  buildStream,
  personasForTicket,
  type QueueItem,
} from './selectors';

function item(over: Partial<QueueItem> & Pick<QueueItem, 'id' | 'activity'>): QueueItem {
  return {
    title: over.id,
    boardId: null,
    boardName: null,
    since: null,
    lastActivityAt: null,
    ...over,
  };
}

describe('partitionQueue', () => {
  it('splits tasks into needs / running / idle by activity', () => {
    const { needs, running, idle } = partitionQueue([
      item({ id: 'a', activity: 'waiting' }),
      item({ id: 'b', activity: 'running' }),
      item({ id: 'c', activity: 'idle' }),
      item({ id: 'd', activity: 'waiting' }),
    ]);
    expect(needs.map((t) => t.id)).toEqual(['a', 'd']);
    expect(running.map((t) => t.id)).toEqual(['b']);
    expect(idle.map((t) => t.id)).toEqual(['c']);
  });

  it('puts each task in exactly one section', () => {
    const tasks = [
      item({ id: 'a', activity: 'waiting' }),
      item({ id: 'b', activity: 'running' }),
      item({ id: 'c', activity: 'idle' }),
    ];
    const { needs, running, idle } = partitionQueue(tasks);
    expect(needs.length + running.length + idle.length).toBe(tasks.length);
  });

  it('orders NEEDS YOU oldest question first (since ascending)', () => {
    const { needs } = partitionQueue([
      item({ id: 'new', activity: 'waiting', since: 300 }),
      item({ id: 'old', activity: 'waiting', since: 100 }),
      item({ id: 'mid', activity: 'waiting', since: 200 }),
    ]);
    expect(needs.map((t) => t.id)).toEqual(['old', 'mid', 'new']);
  });

  it('orders RUNNING most recently started first (since descending)', () => {
    const { running } = partitionQueue([
      item({ id: 'early', activity: 'running', since: 100 }),
      item({ id: 'late', activity: 'running', since: 300 }),
    ]);
    expect(running.map((t) => t.id)).toEqual(['late', 'early']);
  });

  it('orders IDLE most recently active first (lastActivityAt descending)', () => {
    const { idle } = partitionQueue([
      item({ id: 'stale', activity: 'idle', lastActivityAt: 100 }),
      item({ id: 'fresh', activity: 'idle', lastActivityAt: 900 }),
    ]);
    expect(idle.map((t) => t.id)).toEqual(['fresh', 'stale']);
  });

  it('returns empty sections for an empty list', () => {
    expect(partitionQueue([])).toEqual({ needs: [], running: [], idle: [] });
  });
});

describe('suggestionsFor', () => {
  it('offers Move to Reviewing for a doing task', () => {
    const ids = suggestionsFor({ status: 'doing', type: 'build', hasPR: false }).map((s) => s.id);
    expect(ids).toContain('move-reviewing');
    expect(ids).not.toContain('mark-done');
  });

  it('offers Mark done for a reviewing task', () => {
    const ids = suggestionsFor({ status: 'reviewing', type: 'build', hasPR: false }).map((s) => s.id);
    expect(ids).toContain('mark-done');
    expect(ids).not.toContain('move-reviewing');
  });

  it('the status move is the first chip when present', () => {
    expect(suggestionsFor({ status: 'doing', type: 'build', hasPR: true })[0]?.id).toBe('move-reviewing');
  });

  it('adds the PM persona only for think tasks', () => {
    expect(suggestionsFor({ status: 'doing', type: 'think', hasPR: false }).map((s) => s.id)).toContain('see-with-pm');
    expect(suggestionsFor({ status: 'doing', type: 'build', hasPR: false }).map((s) => s.id)).not.toContain('see-with-pm');
  });

  it('a move chip carries its target status, a persona chip carries a mention', () => {
    const chips = suggestionsFor({ status: 'reviewing', type: 'build', hasPR: false });
    expect(chips.find((s) => s.id === 'mark-done')?.moveTo).toBe('done');
    expect(chips.find((s) => s.id === 'see-with-dev')?.mention).toBe('Vois ça avec @agent:builder : ');
  });
});

describe('parseInlineOptions', () => {
  it('parses inline lettered options', () => {
    expect(parseInlineOptions('a) Run now b) Wait')).toEqual(['Run now', 'Wait']);
  });

  it('parses lettered options with a dot', () => {
    expect(parseInlineOptions('A. Approve B. Read first')).toEqual(['Approve', 'Read first']);
  });

  it('parses inline numbered options', () => {
    expect(parseInlineOptions('1. Push it 2. Hold')).toEqual(['Push it', 'Hold']);
  });

  it('parses numbered options with a paren', () => {
    expect(parseInlineOptions('1) Run now 2) Wait 3) Cancel')).toEqual(['Run now', 'Wait', 'Cancel']);
  });

  it('parses a bulleted list across lines', () => {
    expect(parseInlineOptions('Choose:\n- Run now\n- Wait for rotation')).toEqual([
      'Run now',
      'Wait for rotation',
    ]);
  });

  it('parses bullets with • and *', () => {
    expect(parseInlineOptions('• Yes\n* No')).toEqual(['Yes', 'No']);
  });

  it('returns [] when there is no option list', () => {
    expect(parseInlineOptions('Should I run the migration on staging now?')).toEqual([]);
  });

  it('returns [] for a single option (needs at least two)', () => {
    expect(parseInlineOptions('a) Just do it')).toEqual([]);
  });

  it('returns [] for empty text', () => {
    expect(parseInlineOptions('')).toEqual([]);
  });

  it('does not treat a decimal number in prose as an option marker', () => {
    expect(parseInlineOptions('The budget is 1. something and 2. another thing?')).toBeInstanceOf(Array);
  });
});

function activity(over: Partial<TicketActivity> & Pick<TicketActivity, 'action'>): TicketActivity {
  return {
    id: over.id ?? `act-${over.action}`,
    ticketId: 't1',
    changes: {},
    actorType: 'user',
    actorName: null,
    source: 'web',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function comment(over: Partial<TicketComment> & Pick<TicketComment, 'id' | 'createdAt'>): TicketComment {
  return {
    ticketId: 't1',
    authorType: 'user',
    authorName: 'Olivier',
    body: 'hi',
    visibility: 'public',
    privateRecipients: [],
    mentions: [],
    parentId: null,
    threadId: null,
    updatedAt: over.createdAt,
    ...over,
  };
}

function execution(over: Partial<AgentExecution> & Pick<AgentExecution, 'id' | 'startedAt'>): AgentExecution {
  return {
    personaId: 'p1',
    ticketId: 't1',
    mentionId: 'm1',
    eventCount: 0,
    status: 'completed',
    completedAt: null,
    lastEventAt: null,
    ...over,
  };
}

function deliverable(over: Partial<TicketDeliverable> & Pick<TicketDeliverable, 'id' | 'createdAt'>): TicketDeliverable {
  return {
    ticketId: 't1',
    agentName: 'The Builder',
    type: 'CODE',
    title: 'Deliverable',
    content: '',
    version: 1,
    status: 'final',
    mentionId: null,
    updatedAt: over.createdAt,
    ...over,
  };
}

describe('formatActivity', () => {
  it('labels ticket creation', () => {
    expect(formatActivity(activity({ action: 'created' }))).toBe('Ticket created');
  });

  it('labels a status move with the capitalised target', () => {
    expect(
      formatActivity(activity({ action: 'moved', changes: { status: { from: 'doing', to: 'reviewing' } } })),
    ).toBe('Moved to Reviewing');
  });

  it('returns null for a move with no status change', () => {
    expect(formatActivity(activity({ action: 'moved', changes: {} }))).toBeNull();
  });

  it('labels a repo attach and a PR link with their ref', () => {
    expect(
      formatActivity(activity({ action: 'linked', changes: { link: { from: null, to: { type: 'repository', ref: 'evaneos/odys' } } } })),
    ).toBe('Repo attached · evaneos/odys');
    expect(
      formatActivity(activity({ action: 'linked', changes: { link: { from: null, to: { type: 'github_pr', ref: 'evaneos/odys#12' } } } })),
    ).toBe('PR linked · evaneos/odys#12');
  });

  it('labels a repo detach from the unlinked "from" side', () => {
    expect(
      formatActivity(activity({ action: 'unlinked', changes: { link: { from: { type: 'repository', ref: 'evaneos/odys' }, to: null } } })),
    ).toBe('Repo detached · evaneos/odys');
  });

  it('labels a worktree link and skips an internal session link', () => {
    expect(formatActivity(activity({ action: 'linked', changes: { worktree: { from: null, to: '/wt' } } }))).toBe('Worktree created');
    expect(formatActivity(activity({ action: 'linked', changes: { session: { from: null, to: 's1' } } }))).toBeNull();
  });

  it('drops comments, edits and other book-keeping', () => {
    expect(formatActivity(activity({ action: 'commented' }))).toBeNull();
    expect(formatActivity(activity({ action: 'updated', changes: { favorite: { from: false, to: true } } }))).toBeNull();
    expect(formatActivity(activity({ action: 'answer' }))).toBeNull();
  });

  it('drops deliverable_submitted — the rich deliverable card renders it instead', () => {
    expect(formatActivity(activity({ action: 'deliverable_submitted' }))).toBeNull();
  });
});

describe('buildStream', () => {
  it('merges comments and event lines oldest-first', () => {
    const stream = buildStream(
      [
        comment({ id: 'c1', createdAt: '2026-01-01T10:00:00.000Z', body: 'first' }),
        comment({ id: 'c2', createdAt: '2026-01-01T12:00:00.000Z', body: 'second' }),
      ],
      [
        activity({ id: 'a1', action: 'created', createdAt: '2026-01-01T09:00:00.000Z' }),
        activity({ id: 'a2', action: 'moved', changes: { status: { from: 'doing', to: 'reviewing' } }, createdAt: '2026-01-01T11:00:00.000Z' }),
      ],
    );
    expect(stream.map((e) => (e.kind === 'comment' ? e.comment.id : e.kind === 'event' ? e.text : e.kind))).toEqual([
      'Ticket created',
      'c1',
      'Moved to Reviewing',
      'c2',
    ]);
  });

  it('excludes activities that format to null', () => {
    const stream = buildStream(
      [comment({ id: 'c1', createdAt: '2026-01-01T10:00:00.000Z' })],
      [activity({ id: 'a1', action: 'commented', createdAt: '2026-01-01T10:00:00.000Z' })],
    );
    expect(stream).toHaveLength(1);
    expect(stream[0]!.kind).toBe('comment');
  });

  it('keeps a comment before an event stamped the same millisecond', () => {
    const stream = buildStream(
      [comment({ id: 'c1', createdAt: '2026-01-01T10:00:00.000Z' })],
      [activity({ id: 'a1', action: 'moved', changes: { status: { from: 'doing', to: 'done' } }, createdAt: '2026-01-01T10:00:00.000Z' })],
    );
    expect(stream.map((e) => e.kind)).toEqual(['comment', 'event']);
  });

  it('places a run before the comment it produced and the deliverable after', () => {
    const stream = buildStream(
      [comment({ id: 'c1', createdAt: '2026-01-01T10:02:00.000Z', authorType: 'agent', body: 'done' })],
      [],
      [execution({ id: 'r1', startedAt: '2026-01-01T10:00:00.000Z', commentId: 'c1', deliverableId: 'd1' })],
      [deliverable({ id: 'd1', createdAt: '2026-01-01T10:02:30.000Z' })],
    );
    expect(stream.map((e) => e.kind)).toEqual(['run', 'comment', 'deliverable']);
  });

  it('keeps a failed run with no comment or deliverable', () => {
    const stream = buildStream(
      [],
      [],
      [execution({ id: 'r1', startedAt: '2026-01-01T10:00:00.000Z', status: 'failed' })],
      [],
    );
    expect(stream).toHaveLength(1);
    const entry = stream[0]!;
    expect(entry.kind).toBe('run');
    if (entry.kind === 'run') expect(entry.execution.status).toBe('failed');
  });

  it('interleaves two runs with their comments in time order', () => {
    const stream = buildStream(
      [
        comment({ id: 'c1', createdAt: '2026-01-01T10:01:00.000Z', authorType: 'agent' }),
        comment({ id: 'c2', createdAt: '2026-01-01T11:01:00.000Z', authorType: 'agent' }),
      ],
      [],
      [
        execution({ id: 'r2', startedAt: '2026-01-01T11:00:00.000Z' }),
        execution({ id: 'r1', startedAt: '2026-01-01T10:00:00.000Z' }),
      ],
    );
    expect(stream.map((e) => (e.kind === 'run' ? e.execution.id : e.kind === 'comment' ? e.comment.id : e.kind))).toEqual([
      'r1',
      'c1',
      'r2',
      'c2',
    ]);
  });

  it('is unchanged when no runs or deliverables are passed (default args)', () => {
    const stream = buildStream([comment({ id: 'c1', createdAt: '2026-01-01T10:00:00.000Z' })], []);
    expect(stream.map((e) => e.kind)).toEqual(['comment']);
  });

  it('skips CLI-source executions (represented by their summary deliverable instead)', () => {
    const stream = buildStream(
      [],
      [],
      [
        execution({ id: 'sdk1', startedAt: '2026-01-01T10:00:00.000Z' }),
        execution({ id: 'cli:abc', startedAt: '2026-01-01T11:00:00.000Z', source: 'cli', personaId: 'cli' }),
      ],
    );
    expect(stream).toHaveLength(1);
    const entry = stream[0]!;
    if (entry.kind === 'run') expect(entry.execution.id).toBe('sdk1');
  });
});

describe('personasForTicket', () => {
  const personas = [
    { id: 'p1', displayName: 'The Builder' },
    { id: 'p2', displayName: 'The Reviewer' },
  ];

  it('lists distinct personas that ran the ticket with their display name', () => {
    const rows = personasForTicket(
      [
        { personaId: 'p1', status: 'completed' },
        { personaId: 'p1', status: 'completed' },
        { personaId: 'p2', status: 'completed' },
      ],
      personas,
      {},
    );
    expect(rows.map((r) => r.name)).toEqual(['The Builder', 'The Reviewer']);
  });

  it('marks a persona running when this ticket has a running execution', () => {
    const rows = personasForTicket([{ personaId: 'p1', status: 'running' }], personas, {});
    expect(rows[0]).toMatchObject({ id: 'p1', state: 'running' });
  });

  it('marks a persona running from its live status even with no running execution here', () => {
    const rows = personasForTicket(
      [{ personaId: 'p1', status: 'completed' }],
      personas,
      { p1: { running: true, pendingMentions: 0 } },
    );
    expect(rows[0]!.state).toBe('running');
  });

  it('marks a persona waiting when it has pending mentions and is not running', () => {
    const rows = personasForTicket(
      [{ personaId: 'p1', status: 'completed' }],
      personas,
      { p1: { running: false, pendingMentions: 2 } },
    );
    expect(rows[0]!.state).toBe('waiting');
  });

  it('is idle when neither running nor waiting', () => {
    const rows = personasForTicket([{ personaId: 'p1', status: 'completed' }], personas, {});
    expect(rows[0]!.state).toBe('idle');
  });

  it('orders running → waiting → idle, then by name', () => {
    const rows = personasForTicket(
      [
        { personaId: 'idle1', status: 'completed' },
        { personaId: 'run1', status: 'running' },
        { personaId: 'wait1', status: 'completed' },
      ],
      [
        { id: 'idle1', displayName: 'Zoe' },
        { id: 'run1', displayName: 'Ada' },
        { id: 'wait1', displayName: 'Max' },
      ],
      { wait1: { running: false, pendingMentions: 1 } },
    );
    expect(rows.map((r) => `${r.name}:${r.state}`)).toEqual(['Ada:running', 'Max:waiting', 'Zoe:idle']);
  });

  it('falls back to the persona id when metadata is missing', () => {
    const rows = personasForTicket([{ personaId: 'ghost', status: 'completed' }], personas, {});
    expect(rows[0]!.name).toBe('ghost');
  });

  it('returns [] when no persona ran the ticket', () => {
    expect(personasForTicket([], personas, {})).toEqual([]);
  });
});

// ── Assistant threads ─────────────────────────────────────────────────────

function thread(over: Partial<AgentThread> & { id: string }): AgentThread {
  return {
    ticketId: 't1', initiator: 'assistant', personaId: 'p-builder', personaName: 'builder', assistantPersonaId: 'pa',
    brief: 'Fix e2e', forwardedContext: ['ticket'], status: 'running', currentMentionId: null, exchanges: 1, failures: 0,
    summary: null, createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z', concludedAt: null,
    ...over,
  };
}

describe('buildStream — threads', () => {
  it('hides thread turns, shows a delegation card at the thread creation time', () => {
    const stream = buildStream(
      [
        comment({ id: 'ann', createdAt: '2026-01-01T09:59:00.000Z', authorType: 'assistant' }),
        comment({ id: 'turn', createdAt: '2026-01-01T10:01:00.000Z', threadId: 'th1' }),
        comment({ id: 'later', createdAt: '2026-01-01T10:05:00.000Z' }),
      ],
      [], [], [],
      [thread({ id: 'th1' })],
    );
    expect(stream.map((e) => (e.kind === 'comment' ? e.comment.id : e.kind))).toEqual(['ann', 'delegation', 'later']);
  });

  it('drops assistant executions from the run cards', () => {
    const exec = (id: string, mentionId: string): AgentExecution =>
      ({ id, personaId: 'p', ticketId: 't1', mentionId, eventCount: 0, status: 'completed', startedAt: '2026-01-01T10:00:00.000Z', completedAt: null, lastEventAt: null }) as AgentExecution;
    const stream = buildStream([], [], [exec('e1', 'assistant:abc'), exec('e2', 'm1')]);
    expect(stream.map((e) => (e.kind === 'run' ? e.execution.id : e.kind))).toEqual(['e2']);
  });
});

describe('threadTurns / lastAgentQuestion / threadActivityDetail', () => {
  it('threadTurns filters and orders the thread comments', () => {
    const turns = threadTurns([
      comment({ id: 'b', createdAt: '2026-01-01T10:02:00.000Z', threadId: 'th1' }),
      comment({ id: 'x', createdAt: '2026-01-01T10:01:00.000Z' }),
      comment({ id: 'a', createdAt: '2026-01-01T10:00:00.000Z', threadId: 'th1' }),
    ], 'th1');
    expect(turns.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('lastAgentQuestion returns the options of the last agent turn, or null', () => {
    const turns = [
      comment({ id: 'a', createdAt: '2026-01-01T10:00:00.000Z', authorType: 'assistant', body: 'go' }),
      comment({ id: 'q', createdAt: '2026-01-01T10:01:00.000Z', authorType: 'agent', body: 'Keep it?\n- Keep\n- Drop' }),
    ];
    expect(lastAgentQuestion(turns)?.options).toEqual(['Keep', 'Drop']);
    expect(lastAgentQuestion([...turns, comment({ id: 'p', createdAt: '2026-01-01T10:02:00.000Z', authorType: 'agent', body: 'done' })])).toBeNull();
    expect(lastAgentQuestion([])).toBeNull();
  });

  it('threadActivityDetail labels a running thread and ignores the rest', () => {
    expect(threadActivityDetail([thread({ id: 'a', status: 'waiting' })])).toBeNull();
    expect(threadActivityDetail([thread({ id: 'a' })], (t) => t.personaName.toUpperCase())).toBe('BUILDER · in thread with assistant');
    expect(threadActivityDetail([])).toBeNull();
  });
});

describe('buildStream — thread runs and threadMentionIds', () => {
  it('threadMentionIds picks the mentions opened by thread turns', () => {
    const ids = threadMentionIds(
      [comment({ id: 'turn', createdAt: '2026-01-01T10:00:00.000Z', threadId: 'th1' }), comment({ id: 'main', createdAt: '2026-01-01T10:01:00.000Z' })],
      [{ id: 'm1', commentId: 'turn' }, { id: 'm2', commentId: 'main' }],
    );
    expect([...ids]).toEqual(['m1']);
  });
  it('hides the runs of hidden mentions', () => {
    const exec = (id: string, mentionId: string): AgentExecution =>
      ({ id, personaId: 'p', ticketId: 't1', mentionId, eventCount: 0, status: 'failed', startedAt: '2026-01-01T10:00:00.000Z', completedAt: null, lastEventAt: null }) as AgentExecution;
    const stream = buildStream([], [], [exec('e1', 'm1'), exec('e2', 'm2')], [], [], new Set(['m1']));
    expect(stream.map((e) => (e.kind === 'run' ? e.execution.id : e.kind))).toEqual(['e2']);
  });
});

describe('parseModeRequest / stripModeRequest', () => {
  const body = 'The Builder doit écrire.\n\n<!-- fleex:mode-request {"mode":"edit","threadId":"th1"} -->';
  it('extracts the request and strips the marker', () => {
    expect(parseModeRequest(body)).toEqual({ mode: 'edit', threadId: 'th1' });
    expect(stripModeRequest(body)).toBe('The Builder doit écrire.');
  });
  it('ignores plain comments and malformed markers', () => {
    expect(parseModeRequest('hello')).toBeNull();
    expect(parseModeRequest('<!-- fleex:mode-request {"mode":"god","threadId":"x"} -->')).toBeNull();
    expect(stripModeRequest('hello')).toBe('hello');
  });
});
