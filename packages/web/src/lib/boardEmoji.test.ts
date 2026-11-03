import { describe, it, expect } from 'vitest';
import { normalizeEmoji, boardChanges } from './boardEmoji';

describe('normalizeEmoji', () => {
  it('keeps only the first grapheme, so a stray paste does not become the emoji', () => {
    expect(normalizeEmoji('🚀abc')).toBe('🚀');
    expect(normalizeEmoji('  🎯 ')).toBe('🎯');
  });

  it('keeps multi-code-point emojis whole (ZWJ sequences, flags)', () => {
    expect(normalizeEmoji('👩‍💻')).toBe('👩‍💻');
    expect(normalizeEmoji('🇫🇷x')).toBe('🇫🇷');
  });

  it('returns null for a blank field, so callers can tell "no emoji" apart', () => {
    expect(normalizeEmoji('')).toBeNull();
    expect(normalizeEmoji('   ')).toBeNull();
  });
});

describe('boardChanges', () => {
  const board = { name: 'Personal', emoji: '🏠' };

  it('sends nothing when nothing changed', () => {
    expect(boardChanges(board, { name: ' Personal ', emoji: '🏠' })).toBeNull();
  });

  it('sends only the emoji when only the emoji changed', () => {
    expect(boardChanges(board, { name: 'Personal', emoji: '🗺️' })).toEqual({ emoji: '🗺️' });
  });

  it('sends both fields in one body when both changed', () => {
    expect(boardChanges(board, { name: 'Perso', emoji: '🚀' })).toEqual({ name: 'Perso', emoji: '🚀' });
  });

  it('never blanks the emoji or the name: an emptied field keeps the current value', () => {
    expect(boardChanges(board, { name: '', emoji: '' })).toBeNull();
    expect(boardChanges(board, { name: 'Perso', emoji: '  ' })).toEqual({ name: 'Perso' });
  });
});
