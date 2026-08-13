import { describe, it, expect } from 'vitest';
import {
  splitMarkdown,
  embeddableText,
  chunkTicket,
  chunkCommentThread,
  chunkDeliverable,
  chunkPersona,
  chunkScratchpad,
  TARGET_CHUNK_CHARS,
  MAX_CHUNK_CHARS,
} from '../../src/application/memory/chunker.js';

const para = (n: number, char = 'a') => char.repeat(n);

describe('splitMarkdown', () => {
  it('keeps short text whole', () => {
    expect(splitMarkdown('a short note')).toEqual(['a short note']);
  });

  it('returns nothing for blank input', () => {
    expect(splitMarkdown('   \n\n  ')).toEqual([]);
  });

  it('splits on h2+ headings rather than mid-section', () => {
    const text = [
      '# Title',
      para(900),
      '## Second',
      para(900),
      '## Third',
      para(900),
    ].join('\n\n');

    const parts = splitMarkdown(text);
    expect(parts.length).toBeGreaterThan(1);
    // The h1 stays with the intro; each h2 opens its own chunk.
    expect(parts[0]).toContain('# Title');
    expect(parts.some((p) => p.startsWith('## Second'))).toBe(true);
    expect(parts.some((p) => p.startsWith('## Third'))).toBe(true);
  });

  it('hard-splits a single paragraph that overflows on its own', () => {
    const parts = splitMarkdown(para(TARGET_CHUNK_CHARS * 2 + 100));
    expect(parts.length).toBeGreaterThanOrEqual(2);
    // The tail merge may exceed the target, but never the encoder's window.
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it('never merges a runt tail past the encoder window', () => {
    // 1500 + 1500 + 100: the 100-char tail is a runt, and folding it back keeps
    // the chunk under the ceiling.
    const parts = splitMarkdown(para(TARGET_CHUNK_CHARS * 2 + 100));
    expect(parts).toHaveLength(2);
    expect(parts[1]!.length).toBeGreaterThan(TARGET_CHUNK_CHARS);
    expect(parts[1]!.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });

  it('never emits an empty chunk', () => {
    const text = ['## A', para(2000), '## B', '', '## C', para(2000)].join('\n\n');
    for (const part of splitMarkdown(text)) {
      expect(part.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('embeddableText', () => {
  it('prefixes the breadcrumb so short chunks carry their topic', () => {
    expect(embeddableText({ title: 'Ticket #42: Fix login', content: 'yes do that' }))
      .toBe('Ticket #42: Fix login\nyes do that');
  });

  it('omits the separator when there is no breadcrumb', () => {
    expect(embeddableText({ title: '', content: 'body' })).toBe('body');
  });
});

describe('chunkTicket', () => {
  const ticket = {
    id: 't1',
    displayId: 42,
    title: 'Fix login',
    status: 'done',
    boardId: 'b1',
    tags: ['auth', 'bug'],
    repo: 'org/app',
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  };

  it('indexes a ticket with no description using its title as content', () => {
    const chunks = chunkTicket({ ...ticket, description: null });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('Fix login');
    expect(chunks[0]?.title).toBe('Ticket #42: Fix login');
  });

  it('carries the scoring metadata onto every chunk', () => {
    const chunks = chunkTicket({ ...ticket, description: [para(1200), '## More', para(1200)].join('\n\n') });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.metadata).toMatchObject({ ticketId: 't1', boardId: 'b1', repo: 'org/app', tags: ['auth', 'bug'] });
      expect(chunk.sourceKind).toBe('ticket');
    }
  });

  it('numbers multi-part breadcrumbs so a reader can tell them apart', () => {
    const chunks = chunkTicket({ ...ticket, description: [para(1200), '## More', para(1200)].join('\n\n') });
    expect(chunks[0]?.title).toMatch(/\(1\/\d\)$/);
  });

  it('assigns contiguous chunk indexes from zero', () => {
    const chunks = chunkTicket({ ...ticket, description: [para(1200), '## B', para(1200), '## C', para(1200)].join('\n\n') });
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });
});

describe('chunkCommentThread', () => {
  const ticket = { id: 't1', displayId: 7, title: 'Fix login', boardId: 'b1', tags: ['auth'] };

  it('returns nothing for an empty thread', () => {
    expect(chunkCommentThread(ticket, [])).toEqual([]);
  });

  it('packs a short thread into a single window', () => {
    const chunks = chunkCommentThread(ticket, [
      { id: 'c1', authorName: 'Olivier', authorType: 'user', body: 'what about option 2?' },
      { id: 'c2', authorName: 'Builder', authorType: 'agent', body: 'agreed, doing that' },
    ]);
    expect(chunks).toHaveLength(1);
    // The deictic reply keeps its question in the same window.
    expect(chunks[0]?.content).toContain('option 2');
    expect(chunks[0]?.content).toContain('agreed');
  });

  it('overlaps one comment between windows so an exchange stays readable', () => {
    const comments = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      authorName: 'A',
      authorType: 'user',
      body: para(600, String.fromCharCode(97 + i)),
    }));
    const chunks = chunkCommentThread(ticket, comments);
    expect(chunks.length).toBeGreaterThan(1);

    // The last comment of window N reappears as the first of window N+1.
    const firstWindowLast = chunks[0]!.content.split('\n\n').slice(-1)[0]!;
    expect(chunks[1]!.content.startsWith(firstWindowLast)).toBe(true);
  });

  it('cuts only at comment boundaries', () => {
    const comments = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`, authorName: 'A', authorType: 'user', body: para(700),
    }));
    for (const chunk of chunkCommentThread(ticket, comments)) {
      // Every window starts with a rendered comment header, never mid-body.
      expect(chunk.content.startsWith('**A** (user):')).toBe(true);
    }
  });

  it('anchors the thread to its ticket, not to individual comments', () => {
    const chunks = chunkCommentThread(ticket, [
      { id: 'c1', authorName: 'A', authorType: 'user', body: 'hello' },
    ]);
    expect(chunks[0]?.sourceKind).toBe('comment_thread');
    expect(chunks[0]?.sourceId).toBe('t1');
  });
});

describe('chunkDeliverable', () => {
  const base = {
    id: 'd1',
    title: 'Auth rework',
    content: [para(1200), '## Decisions', para(1200)].join('\n\n'),
    agentName: 'Builder',
    ticketId: 't1',
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  };

  it('never splits a ticket summary, which is written to be injected whole', () => {
    const chunks = chunkDeliverable({ ...base, type: 'ticket-summary' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sourceKind).toBe('ticket_summary');
  });

  it('maps a CLI session summary onto its own kind', () => {
    const chunks = chunkDeliverable({ ...base, type: 'cli-session-summary' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sourceKind).toBe('cli_session_summary');
  });

  it('splits an ordinary deliverable on its headings', () => {
    const chunks = chunkDeliverable({ ...base, type: 'report' });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.sourceKind === 'deliverable')).toBe(true);
  });

  it('skips an empty deliverable rather than indexing a blank row', () => {
    expect(chunkDeliverable({ ...base, type: 'report', content: '   ' })).toEqual([]);
  });

  it('names the origin in the breadcrumb so a routine output is attributable', () => {
    const chunks = chunkDeliverable({
      ...base, type: 'ticket-summary', ticketId: null, originLabel: 'Nightly dependency watch',
    });
    expect(chunks[0]?.title).toContain('Nightly dependency watch');
  });
});

describe('chunkPersona', () => {
  it('indexes memory and identity but never soul', () => {
    const chunks = chunkPersona({
      id: 'p1', name: 'Builder', memoryMd: 'learned: the CI is flaky on arm', identityMd: 'I am terse',
    });
    const joined = chunks.map((c) => c.content).join(' ');
    expect(joined).toContain('CI is flaky');
    expect(joined).toContain('terse');
    expect(chunks.map((c) => c.title)).toEqual([
      'Agent Builder > memory',
      'Agent Builder > identity',
    ]);
  });

  it('produces nothing for a persona with no learned content', () => {
    expect(chunkPersona({ id: 'p1', name: 'Builder', memoryMd: '', identityMd: null })).toEqual([]);
  });

  it('keeps chunk indexes contiguous across both documents', () => {
    const chunks = chunkPersona({
      id: 'p1', name: 'B',
      memoryMd: [para(1200), '## More', para(1200)].join('\n\n'),
      identityMd: 'terse',
    });
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });
});

describe('chunkScratchpad', () => {
  it('carries the repo so retrieval can be scoped to the checkout', () => {
    const chunks = chunkScratchpad({ key: 'repo:org/app', label: 'org/app', content: 'remember the migration order', repo: 'org/app' });
    expect(chunks[0]?.metadata.repo).toBe('org/app');
    expect(chunks[0]?.title).toBe('Scratchpad: org/app');
  });
});
