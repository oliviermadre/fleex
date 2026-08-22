import { describe, it, expect } from 'vitest';
import { filterMentionOptions, detectMentionTrigger, MAX_DEFERRED_SUGGESTIONS } from './useMentionAutocomplete';
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
