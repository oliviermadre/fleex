import { describe, it, expect } from 'vitest';
import { sanitizeQuestions, questionsToKeep } from '../../src/application/utils/agent-questions.js';

const q = (prompt: string, options: unknown[]) => ({ prompt, options });

describe('sanitizeQuestions', () => {
  it('keeps a well-formed list', () => {
    expect(sanitizeQuestions([q('Front ?', ['Attacher ici', 'Ticket séparé'])])).toEqual([
      { prompt: 'Front ?', options: ['Attacher ici', 'Ticket séparé'] },
    ]);
  });

  it.each([undefined, null, 'x', 42, {}])('returns null for a non-array (%s)', (raw) => {
    expect(sanitizeQuestions(raw)).toBeNull();
  });

  it('drops an entry without a non-empty string prompt', () => {
    expect(sanitizeQuestions([q('  ', ['A', 'B']), { options: ['A', 'B'] }, q('Ok ?', ['A', 'B'])])).toEqual([
      { prompt: 'Ok ?', options: ['A', 'B'] },
    ]);
  });

  it('drops non-string, blank and over-80-char options, trims and dedupes the rest', () => {
    const long = 'x'.repeat(81);
    expect(sanitizeQuestions([q('P', [' A ', 'A', '', 3, long, 'B'])])).toEqual([{ prompt: 'P', options: ['A', 'B'] }]);
  });

  it('drops a question left with fewer than 2 options', () => {
    expect(sanitizeQuestions([q('P', ['A'])])).toBeNull();
  });

  it('caps options at 5 and questions at 4', () => {
    const many = q('P', ['1', '2', '3', '4', '5', '6']);
    const out = sanitizeQuestions([many, many, many, many, many])!;
    expect(out).toHaveLength(4);
    expect(out[0]!.options).toEqual(['1', '2', '3', '4', '5']);
  });

  it('truncates a prompt over 200 chars', () => {
    expect(sanitizeQuestions([q('p'.repeat(250), ['A', 'B'])])![0]!.prompt).toHaveLength(200);
  });
});

describe('questionsToKeep', () => {
  const questions = [q('P', ['A', 'B'])];

  it('keeps questions only with waiting_for_info', () => {
    expect(questionsToKeep({ mentionStatus: 'waiting_for_info', questions })).toEqual(questions);
    expect(questionsToKeep({ mentionStatus: 'resolved', questions })).toBeNull();
    expect(questionsToKeep({ questions })).toBeNull();
    expect(questionsToKeep(null)).toBeNull();
  });

  it('sanitizes raw SDK input', () => {
    expect(questionsToKeep({ mentionStatus: 'waiting_for_info', questions: [q('P', ['A', 3, 'B', 'B'])] })).toEqual([
      { prompt: 'P', options: ['A', 'B'] },
    ]);
  });
});
