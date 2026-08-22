import { describe, it, expect } from 'vitest';
import {
  filterMentionOptions,
  detectMentionTrigger,
  MAX_DEFERRED_SUGGESTIONS,
  MAX_EMPTY_QUERY_PER_KIND,
} from './useMentionAutocomplete';
import type { MentionOption } from './MentionMenu';

const OPTIONS: MentionOption[] = [
  { insertText: '@agent:catalyst', label: 'Catalyst', type: 'agent' },
  { insertText: '@skill:commit', label: 'commit', type: 'skill' },
  { insertText: '@scratchpad:global', label: 'Global', type: 'scratchpad' },
  ...Array.from({ length: 12 }, (_, i) => ({
    insertText: `@ticket:${i + 1}`,
    label: `#${i + 1} Ticket ${i + 1}`,
    type: 'ticket' as const,
    deferred: true,
  })),
];

describe('detectMentionTrigger', () => {
  it('opens on an @ at the start of the text', () => {
    expect(detectMentionTrigger('@cat', 4)).toEqual({ triggerPos: 0, query: 'cat' });
  });

  it('opens on an @ preceded by whitespace', () => {
    expect(detectMentionTrigger('hello @cat', 10)).toEqual({ triggerPos: 6, query: 'cat' });
  });

  it('stays closed for an @ glued to a previous word (an email address)', () => {
    expect(detectMentionTrigger('write to me@example.com', 23)).toBeNull();
  });

  it('closes once a space follows the @', () => {
    expect(detectMentionTrigger('@agent:catalyst do it', 21)).toBeNull();
  });

  it('strips the primitive prefix so the query matches the label', () => {
    // Typing "@agent:cat" must match "Catalyst", and "@ticket:37" must match #37.
    expect(detectMentionTrigger('@agent:cat', 10)?.query).toBe('cat');
    expect(detectMentionTrigger('@scratchpad:acm', 15)?.query).toBe('acm');
  });

  it('reads the text before the cursor, not the whole value', () => {
    expect(detectMentionTrigger('@cat and more', 4)).toEqual({ triggerPos: 0, query: 'cat' });
  });
});

describe('detectMentionTrigger — the typed prefix pins the kind', () => {
  it('reports the kind for a prefix with nothing typed after it', () => {
    // `@ticket:` names the kind and nothing else. Reporting only the empty query
    // is what made the menu answer with agents.
    expect(detectMentionTrigger('@ticket:', 8)).toEqual({ triggerPos: 0, query: '', kind: 'ticket' });
  });

  it('reports the kind alongside the remaining query', () => {
    expect(detectMentionTrigger('@agent:cat', 10)).toEqual({ triggerPos: 0, query: 'cat', kind: 'agent' });
  });

  it('reports no kind for a bare mention', () => {
    expect(detectMentionTrigger('@cat', 4)).toEqual({ triggerPos: 0, query: 'cat' });
  });

  it('treats an unknown prefix as part of the query, not a kind', () => {
    // `@foo:` names no kind, so the colon is just text the user typed.
    expect(detectMentionTrigger('@foo:bar', 8)).toEqual({ triggerPos: 0, query: 'foo:bar' });
  });
});

describe('filterMentionOptions — a named kind', () => {
  it('lists that kind for an empty query, deferral notwithstanding', () => {
    // Tickets are deferred so a bare `@` cannot dump them all. But `@ticket:`
    // asks for them by name, so hiding them behind a further query is the bug.
    const out = filterMentionOptions(OPTIONS, '', 'ticket');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.type === 'ticket')).toBe(true);
  });

  it('excludes every other kind', () => {
    const out = filterMentionOptions(OPTIONS, '', 'agent');
    expect(out.map((o) => o.insertText)).toEqual(['@agent:catalyst']);
  });

  it('still filters within the kind', () => {
    const out = filterMentionOptions(OPTIONS, '3', 'ticket');
    expect(out.every((o) => o.type === 'ticket')).toBe(true);
    expect(out.map((o) => o.insertText)).toContain('@ticket:3');
    expect(out.map((o) => o.insertText)).not.toContain('@ticket:1');
  });

  it('caps a numerous kind so a thousand tickets stay usable', () => {
    expect(filterMentionOptions(OPTIONS, '', 'ticket')).toHaveLength(MAX_DEFERRED_SUGGESTIONS);
  });

  it('does not apply the per-kind cap, which exists only for a bare @', () => {
    // With the kind named there is nothing to crowd out, so the 3-per-kind
    // sampling must not also clip the one kind the user asked for.
    expect(filterMentionOptions(OPTIONS, '', 'ticket').length).toBeGreaterThan(MAX_EMPTY_QUERY_PER_KIND);
  });
});

describe('filterMentionOptions', () => {
  it('shows only non-deferred options for a bare @', () => {
    // A bare "@" would otherwise dump every ticket into the dropdown.
    const out = filterMentionOptions(OPTIONS, '');
    expect(out.every((o) => !o.deferred)).toBe(true);
    expect(out).toHaveLength(3);
  });

  it('matches on label', () => {
    expect(filterMentionOptions(OPTIONS, 'cataly').map((o) => o.insertText)).toEqual(['@agent:catalyst']);
  });

  it('matches on insert text', () => {
    expect(filterMentionOptions(OPTIONS, 'scratchpad').map((o) => o.insertText)).toEqual(['@scratchpad:global']);
  });

  it('caps deferred matches so a long list stays usable', () => {
    const out = filterMentionOptions(OPTIONS, 'ticket');
    expect(out.filter((o) => o.deferred)).toHaveLength(MAX_DEFERRED_SUGGESTIONS);
  });

  it('puts non-deferred options before deferred ones', () => {
    // 'c' matches all three immediate options and every ticket, so the ordering
    // is what the assertion actually measures.
    const out = filterMentionOptions(OPTIONS, 'c');
    expect(out[0]?.deferred).not.toBe(true);
    expect(out.some((o) => o.deferred)).toBe(true);
  });

  it('returns nothing when no option matches', () => {
    expect(filterMentionOptions(OPTIONS, 'zzzz')).toEqual([]);
  });
});

describe('filterMentionOptions — per-kind cap at empty query', () => {
  // One numerous kind (personas, as on the real instance) and two sparse ones,
  // so a bare "@" dominated by the numerous kind alone would be a regression.
  const MANY_PERSONAS: MentionOption[] = Array.from({ length: 10 }, (_, i) => ({
    insertText: `@agent:persona${i + 1}`,
    label: `Persona ${i + 1}`,
    type: 'agent' as const,
  }));
  const SPARSE_KINDS: MentionOption[] = [
    { insertText: '@panel:squad', label: 'Squad', type: 'panel' },
    { insertText: '@routine:daily', label: 'Daily recap', type: 'routine' },
  ];
  const MIXED = [...MANY_PERSONAS, ...SPARSE_KINDS];

  it('caps the numerous kind to MAX_EMPTY_QUERY_PER_KIND for a bare @, but still surfaces the sparse kinds', () => {
    const out = filterMentionOptions(MIXED, '');
    expect(out.filter((o) => o.type === 'agent')).toHaveLength(MAX_EMPTY_QUERY_PER_KIND);
    expect(out.some((o) => o.type === 'panel')).toBe(true);
    expect(out.some((o) => o.type === 'routine')).toBe(true);
  });

  it('typing a query returns the full filtered set, not the empty-query per-kind cap', () => {
    const out = filterMentionOptions(MIXED, 'persona');
    expect(out.filter((o) => o.type === 'agent')).toHaveLength(MANY_PERSONAS.length);
  });
});
