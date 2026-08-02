import { describe, it, expect } from 'vitest';
import { insertReferenceToken } from './NativeActionsEditor';

const TOKEN = '{{ output.priority }}';

/**
 * The reference picker sits next to a field the author may already have typed
 * into. What it does to that text is the whole behaviour under test.
 */
describe('insertReferenceToken', () => {
  it('keeps the prose already written in a comment body', () => {
    // The regression this pins: picking a variable used to wipe the sentence.
    // `post_comment.body` is exactly where "write a sentence, then insert a
    // value" is the intended workflow, so overwriting it is the worst case.
    expect(insertReferenceToken('Triaged as ', TOKEN, 'text'))
      .toBe(`Triaged as ${TOKEN}`);
  });

  it('appends to a plain string field too', () => {
    expect(insertReferenceToken('Fix: ', TOKEN, 'string')).toBe(`Fix: ${TOKEN}`);
  });

  it('appends a second reference rather than dropping the first', () => {
    expect(insertReferenceToken('{{ ticket.title }} — ', TOKEN, 'text'))
      .toBe(`{{ ticket.title }} — ${TOKEN}`);
  });

  it('replaces the value on a typed param, where a reference must stand alone', () => {
    // `validateNativeSteps` rejects an embedded reference on these types, so
    // appending would produce a step that refuses to save.
    expect(insertReferenceToken('high', TOKEN, 'enum')).toBe(TOKEN);
    expect(insertReferenceToken(3, TOKEN, 'number')).toBe(TOKEN);
    expect(insertReferenceToken(true, TOKEN, 'boolean')).toBe(TOKEN);
    expect(insertReferenceToken('2026-01-01', TOKEN, 'date')).toBe(TOKEN);
  });

  it('replaces an empty or unset value rather than prefixing it', () => {
    expect(insertReferenceToken('', TOKEN, 'text')).toBe(TOKEN);
    expect(insertReferenceToken(undefined, TOKEN, 'text')).toBe(TOKEN);
  });
});
