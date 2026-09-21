import { describe, it, expect } from 'vitest';
import { deriveTitle, migrateDraft, EMPTY_DRAFT } from './draftMigration';

describe('deriveTitle', () => {
  it('takes the first sentence', () => {
    expect(deriveTitle('Fix login. Details follow here.')).toBe('Fix login.');
  });
  it('caps at 70 characters', () => {
    const long = 'x'.repeat(100);
    expect(deriveTitle(long)).toHaveLength(70);
  });
  it('falls back to a placeholder for empty text', () => {
    expect(deriveTitle('   ')).toBe('Untitled task');
  });
});

describe('migrateDraft', () => {
  it('returns the empty draft (ENTRY) for a missing blob', () => {
    expect(migrateDraft(undefined)).toEqual(EMPTY_DRAFT);
  });

  it('derives a title and opens in COMPOSE for a legacy blob with text but no title', () => {
    // WHY: pre-title blobs stored the whole task in `text`; the title used to be
    // the first sentence. Migrating must preserve the description and reopen the
    // composer so an in-progress task isn't lost.
    const migrated = migrateDraft({ text: 'Fix login. Details…', boardId: 'b1' });
    expect(migrated.title).toBe('Fix login.');
    expect(migrated.text).toBe('Fix login. Details…');
    expect(migrated.stage).toBe('compose');
    expect(migrated.boardId).toBe('b1');
  });

  it('returns ENTRY for a legacy blob with an empty text', () => {
    const migrated = migrateDraft({ text: '', boardId: 'b2' });
    expect(migrated.stage).toBe('entry');
    expect(migrated.title).toBe('');
    expect(migrated.boardId).toBe('b2');
  });

  it('keeps a current blob and repairs an invalid stage', () => {
    const migrated = migrateDraft({ title: 'A task', text: 'body', stage: 'bogus' as never, boardId: 'b1' });
    expect(migrated.title).toBe('A task');
    expect(migrated.stage).toBe('compose');
  });

  it('guarantees the collections even from a truncated blob', () => {
    const migrated = migrateDraft({ title: 'x', repoKeys: undefined as never });
    expect(migrated.repoKeys).toEqual([]);
    expect(migrated.repoBaseBranches).toEqual({});
    expect(migrated.repoCheckoutRefs).toEqual({});
    expect(migrated.source).toBeNull();
  });
});
