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
  it('single question: a click posts the option right away', () => {
    const onAnswer = vi.fn();
    render(<InlineQuestion authorName="Dev" body="Where?" questions={one} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Per board' }));
    expect(onAnswer).toHaveBeenCalledWith('Per board');
    expect(screen.getByText(/ANSWERED · Per board/)).toBeTruthy();
  });

  it('multiple questions: Send is disabled until every group has a pick', () => {
    const onAnswer = vi.fn();
    render(<InlineQuestion authorName="Dev" body="Two things" questions={two} onAnswer={onAnswer} />);
    const send = screen.getByRole('button', { name: 'Envoyer' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ticket séparé' }));
    expect(send.disabled).toBe(true);
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Je valide' }));
    expect(send.disabled).toBe(false);
  });

  it('multiple questions: re-picking in a group replaces the pick, Send posts the latest', () => {
    const onAnswer = vi.fn();
    render(<InlineQuestion authorName="Dev" body="Two things" questions={two} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attacher ici' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ticket séparé' }));
    fireEvent.click(screen.getByRole('button', { name: 'Je valide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(onAnswer).toHaveBeenCalledWith('**Front (lot 5) ?** Ticket séparé\n**Les 6 écarts ?** Je valide');
  });

  it('shows each question prompt as its group label', () => {
    render(<InlineQuestion authorName="Dev" body="x" questions={two} onAnswer={vi.fn()} />);
    expect(screen.getByText('Front (lot 5) ?')).toBeTruthy();
    expect(screen.getByText('Les 6 écarts ?')).toBeTruthy();
  });
});
