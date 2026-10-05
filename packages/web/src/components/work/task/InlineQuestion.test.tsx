import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InlineQuestion } from './InlineQuestion';
import { formatQuestionAnswer } from './questionAnswer';

afterEach(cleanup);

const one = [{ prompt: 'Scope ?', options: ['Global', 'Per board'] }];
const two = [
  { prompt: 'Front (lot 5) ?', options: ['Attacher ici', 'Ticket séparé'] },
  { prompt: 'Les 6 écarts ?', options: ['Je valide', 'On en parle'] },
];

describe('formatQuestionAnswer', () => {
  it('is the bare option for a single question', () => {
    expect(formatQuestionAnswer(one, ['Global'])).toBe('Global');
  });
  it('is one bold-prompt line per question otherwise', () => {
    expect(formatQuestionAnswer(two, ['Ticket séparé', 'Je valide'])).toBe(
      '**Front (lot 5) ?** Ticket séparé\n**Les 6 écarts ?** Je valide',
    );
  });
});

describe('InlineQuestion', () => {
  it('single question: a click posts the option and the card turns answered', () => {
    const onAnswer = vi.fn();
    render(<InlineQuestion authorName="Dev" body="Where?" questions={one} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Per board' }));
    expect(onAnswer).toHaveBeenCalledWith('Per board');
    expect(screen.getByText(/ANSWERED · Per board/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Global' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('multiple questions: sending posts every answer and locks the card', () => {
    const onAnswer = vi.fn();
    render(<InlineQuestion authorName="Dev" body="Two things" questions={two} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Ticket séparé' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Je valide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer les 2 réponses' }));
    expect(onAnswer).toHaveBeenCalledWith('**Front (lot 5) ?** Ticket séparé\n**Les 6 écarts ?** Je valide');
    expect(screen.getByText('ANSWERED')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'On en parle' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
