import { describe, it, expect } from 'vitest';

import {
  computeInheritedAttributes,
  toCreateFields,
  toUpdateFields,
  type InheritableFilters,
} from './filterInheritance';

/** No filter active — the baseline the board resets to. */
const NO_FILTERS: InheritableFilters = {
  priority: null,
  type: null,
  tag: null,
  favorite: null,
};

describe('computeInheritedAttributes', () => {
  it('inherits the single active epic so the ticket stays under the epic filter (AC1)', () => {
    // WHY: this is the reported bug — a ticket created under an epic filter must
    // join that epic, otherwise filterColumnsByEpics() hides it immediately.
    const attrs = computeInheritedAttributes(NO_FILTERS, ['epic-1']);
    expect(attrs.epicIds).toEqual(['epic-1']);
  });

  it('inherits ALL selected epics when several are active (AC2)', () => {
    // WHY: the board filter is a union of epics; joining only one would still hide
    // the ticket under some epic combinations.
    const attrs = computeInheritedAttributes(NO_FILTERS, ['epic-1', 'epic-2']);
    expect(attrs.epicIds).toEqual(['epic-1', 'epic-2']);
  });

  it('inherits the active priority (AC3)', () => {
    const attrs = computeInheritedAttributes({ ...NO_FILTERS, priority: 'high' }, []);
    expect(attrs.priority).toBe('high');
  });

  it('inherits the active type (AC4)', () => {
    const attrs = computeInheritedAttributes({ ...NO_FILTERS, type: 'fix' }, []);
    expect(attrs.type).toBe('fix');
  });

  it('inherits favorite only when the filter demands starred tickets (AC5)', () => {
    const attrs = computeInheritedAttributes({ ...NO_FILTERS, favorite: true }, []);
    expect(attrs.favorite).toBe(true);
  });

  it('inherits the active tag as a single-element tag list (AC6)', () => {
    const attrs = computeInheritedAttributes({ ...NO_FILTERS, tag: 'delivery' }, []);
    expect(attrs.tags).toEqual(['delivery']);
  });

  it('inherits every active filter simultaneously (AC7)', () => {
    const attrs = computeInheritedAttributes(
      { priority: 'medium', type: 'build', tag: 'delivery', favorite: true },
      ['epic-1', 'epic-2'],
    );
    expect(attrs).toEqual({
      priority: 'medium',
      type: 'build',
      tags: ['delivery'],
      favorite: true,
      epicIds: ['epic-1', 'epic-2'],
    });
  });

  it('inherits nothing when no filter is active (AC8)', () => {
    const attrs = computeInheritedAttributes(NO_FILTERS, []);
    expect(attrs).toEqual({ epicIds: [] });
  });

  it('treats an "All"/null filter as a no-op (AC9)', () => {
    // WHY: selecting "All" clears the filter to null; it must never stamp an attribute.
    const attrs = computeInheritedAttributes(NO_FILTERS, []);
    expect(attrs.priority).toBeUndefined();
    expect(attrs.type).toBeUndefined();
    expect(attrs.tags).toBeUndefined();
    expect(attrs.favorite).toBeUndefined();
  });

  it('does NOT stamp favorite when the filter targets non-starred tickets', () => {
    // WHY: favorite=false means "show non-favorites"; a fresh ticket already
    // defaults to favorite=false, so forcing the flag would be wrong.
    const attrs = computeInheritedAttributes({ ...NO_FILTERS, favorite: false }, []);
    expect(attrs.favorite).toBeUndefined();
  });

  it('applies priority="none" because it is a real (non-null) filter value', () => {
    // WHY: 'none' is the default priority but still a distinct, harmless filter value.
    const attrs = computeInheritedAttributes({ ...NO_FILTERS, priority: 'none' }, []);
    expect(attrs.priority).toBe('none');
  });

  it('returns a fresh epicIds array (never aliases the store array)', () => {
    // WHY: mutating the caller's selectedEpicIds through the returned object would
    // corrupt the filter state.
    const selected = ['epic-1'];
    const attrs = computeInheritedAttributes(NO_FILTERS, selected);
    expect(attrs.epicIds).not.toBe(selected);
    expect(attrs.epicIds).toEqual(selected);
  });
});

describe('toCreateFields', () => {
  it('maps inherited scalars supported by CreateTicketRequest', () => {
    const fields = toCreateFields({
      priority: 'high',
      type: 'fix',
      tags: ['delivery'],
      favorite: true,
      epicIds: ['epic-1'],
    });
    expect(fields).toEqual({ priority: 'high', type: 'fix', tags: ['delivery'] });
  });

  it('omits keys that were not inherited', () => {
    expect(toCreateFields({ epicIds: [] })).toEqual({});
  });

  it('never carries favorite (CreateTicketRequest cannot set it)', () => {
    const fields = toCreateFields({ favorite: true, epicIds: [] });
    expect('favorite' in fields).toBe(false);
  });
});

describe('toUpdateFields', () => {
  it('carries favorite so it can be applied via PATCH after creation', () => {
    const fields = toUpdateFields({ favorite: true, epicIds: [] });
    expect(fields).toEqual({ favorite: true });
  });

  it('carries every scalar for import parity (imports never see create fields)', () => {
    const fields = toUpdateFields({
      priority: 'low',
      type: 'ops',
      tags: ['x'],
      favorite: true,
      epicIds: ['epic-1'],
    });
    expect(fields).toEqual({ priority: 'low', type: 'ops', tags: ['x'], favorite: true });
  });

  it('is empty when nothing was inherited', () => {
    expect(toUpdateFields({ epicIds: [] })).toEqual({});
  });
});
