import { describe, it, expect } from 'vitest';
import {
  findReferences,
  containsReference,
  asFullValueReference,
  allowsEmbeddedReference,
} from '@fleex/shared';

/**
 * The reference helpers are public API of `@fleex/shared`, consumed by the
 * editor (static validation) and by the server (runtime resolution). They are
 * pure functions, and callers rely on that: nothing here may carry state from
 * one call into the next.
 */

describe('reference helpers are stateless', () => {
  const value = 'Ticket {{ ticket.title }} handled by {{ workflow }}';

  it('finds the same references however many times it is called', () => {
    expect(findReferences(value).map((r) => r.raw)).toEqual(['{{ ticket.title }}', '{{ workflow }}']);
    expect(findReferences(value).map((r) => r.raw)).toEqual(['{{ ticket.title }}', '{{ workflow }}']);
  });

  it('is not disturbed by a preceding containsReference call', () => {
    // The trap this guards: a shared global regex advances `lastIndex` on
    // `.test`, and `matchAll` copies that index — so the next scan would start
    // mid-string and silently drop the first reference. A parameter would then
    // validate clean and resolve to the wrong value.
    expect(containsReference(value)).toBe(true);

    expect(findReferences(value).map((r) => r.raw)).toEqual(['{{ ticket.title }}', '{{ workflow }}']);
    expect(asFullValueReference('{{ workflow }}')?.kind).toBe('workflow');
  });

  it('answers containsReference the same way on repeated calls', () => {
    expect(containsReference(value)).toBe(true);
    expect(containsReference(value)).toBe(true);
  });

  it('does not parse, so a malformed reference is still reported as present', () => {
    // It answers "is there a reference here?", which the editor uses to pick a
    // widget. Throwing on malformed input would break the field the author is
    // still in the middle of typing.
    expect(containsReference('{{ nonsense }}')).toBe(true);
    expect(containsReference('no reference here')).toBe(false);
    expect(containsReference(42)).toBe(false);
  });
});

describe('allowsEmbeddedReference', () => {
  it('permits mixing text and references only where the validator does', () => {
    // The editor's reference picker appends on these types and replaces on the
    // others. Diverging from the validator would let the picker build a value
    // that then refuses to save.
    expect(allowsEmbeddedReference('string')).toBe(true);
    expect(allowsEmbeddedReference('text')).toBe(true);

    for (const type of ['enum', 'number', 'boolean', 'date', 'string[]'] as const) {
      expect(allowsEmbeddedReference(type)).toBe(false);
    }
  });
});
