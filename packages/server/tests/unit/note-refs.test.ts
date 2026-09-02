import { describe, it, expect } from 'vitest';
import { parseNoteRefs, normaliseNoteKey, collectNoteRefs, referencesNote, GLOBAL_NOTE_KEY } from '@fleex/shared';

describe('parseNoteRefs', () => {
  it('finds a repo note reference', () => {
    const [ref] = parseNoteRefs('conventions live in @scratchpad:acme/app today');
    expect(ref).toMatchObject({ raw: '@scratchpad:acme/app', key: 'acme/app' });
  });

  it('resolves the global note to its storage key', () => {
    expect(parseNoteRefs('see @scratchpad:global')[0]?.key).toBe(GLOBAL_NOTE_KEY);
  });

  it('lowercases a repo key so references match however they were typed', () => {
    expect(parseNoteRefs('@scratchpad:Acme/App')[0]?.key).toBe('acme/app');
    expect(parseNoteRefs('@scratchpad:GLOBAL')[0]?.key).toBe(GLOBAL_NOTE_KEY);
  });

  it('reports offsets so a renderer can splice the source', () => {
    const text = 'before @scratchpad:acme/app after';
    const [ref] = parseNoteRefs(text);
    expect(text.slice(ref!.start, ref!.end)).toBe('@scratchpad:acme/app');
  });

  it('stops before trailing punctuation', () => {
    // A reference at the end of a sentence must not swallow the period, or the
    // key would never match the one the list endpoint reports.
    const [ref] = parseNoteRefs('written up in @scratchpad:acme/app.');
    expect(ref?.key).toBe('acme/app');
    expect(ref?.raw).toBe('@scratchpad:acme/app');
  });

  it('declines a bare word that is neither global nor owner/name', () => {
    // Fleex notes are the global one plus one per repo; there is no free-form
    // namespace, so an arbitrary word points at nothing.
    expect(parseNoteRefs('@scratchpad:my-idea')).toEqual([]);
  });

  it('requires the colon, so a longer primitive name does not match', () => {
    expect(parseNoteRefs('@scratchpads:global names nothing')).toEqual([]);
    expect(parseNoteRefs('@scratchpadding/thing')).toEqual([]);
  });

  it('matches a reference glued to a preceding word', () => {
    // The parser is deliberately context-free: whether an `@` opens a mention is
    // the editor's business, and the backlink scan must see every reference a
    // document contains however it was punctuated.
    expect(parseNoteRefs('(see@scratchpad:global)')[0]?.key).toBe(GLOBAL_NOTE_KEY);
  });

  it('finds several references in one document', () => {
    expect(collectNoteRefs('@scratchpad:global and @scratchpad:acme/app')).toEqual([GLOBAL_NOTE_KEY, 'acme/app']);
  });

  it('is stateless across calls', () => {
    // A module-level global regex would carry `lastIndex` between calls and skip
    // matches on the second document it saw.
    const text = 'see @scratchpad:acme/app';
    expect(collectNoteRefs(text)).toEqual(['acme/app']);
    expect(collectNoteRefs(text)).toEqual(['acme/app']);
  });

  it('ignores a reference inside an inline code span', () => {
    expect(collectNoteRefs('write `@scratchpad:acme/app` verbatim')).toEqual([]);
  });

  it('ignores a reference inside a fenced code block', () => {
    expect(collectNoteRefs('```\n@scratchpad:acme/app\n```')).toEqual([]);
  });

  it('still finds a reference outside a fence in a document that also has one', () => {
    // Guards against an over-broad exclusion that treats everything after the
    // opening fence as code, swallowing references that come later in prose.
    const text = '```\n@scratchpad:acme/app\n```\n\nsee also @scratchpad:acme/other';
    expect(collectNoteRefs(text)).toEqual(['acme/other']);
  });
});

describe('collectNoteRefs', () => {
  it('deduplicates repeated references', () => {
    expect(collectNoteRefs('@scratchpad:acme/app twice @scratchpad:Acme/App')).toEqual(['acme/app']);
  });

  it('returns nothing for prose without references', () => {
    expect(collectNoteRefs('plain prose about scratchpads')).toEqual([]);
  });
});

describe('referencesNote', () => {
  it('is true when the document points at the key', () => {
    expect(referencesNote('see @scratchpad:global', GLOBAL_NOTE_KEY)).toBe(true);
  });

  it('does not confuse two neighbouring keys', () => {
    expect(referencesNote('@scratchpad:acme/app', 'acme/apparel')).toBe(false);
  });
});

describe('normaliseNoteKey', () => {
  it('maps every spelling of global to the storage key', () => {
    expect(normaliseNoteKey('global')).toBe(GLOBAL_NOTE_KEY);
    expect(normaliseNoteKey('Global')).toBe(GLOBAL_NOTE_KEY);
  });

  it('returns null for a value that names no note', () => {
    expect(normaliseNoteKey('an idea')).toBeNull();
    expect(normaliseNoteKey('acme/app/extra')).toBeNull();
  });
});
