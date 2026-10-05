import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QuestionPicker } from './QuestionPicker';

afterEach(cleanup);

const one = [{ prompt: 'Scope ?', options: ['Global', 'Per board'] }];
const two = [
  { prompt: 'Front (lot 5) ?', options: ['Attacher ici', 'Ticket séparé'] },
  { prompt: 'Les 6 écarts ?', options: ['Je valide', 'On en parle'] },
];

describe('QuestionPicker', () => {
  it('single question: a click submits the option right away', () => {
    const onSubmit = vi.fn();
    render(<QuestionPicker questions={one} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Per board' }));
    expect(onSubmit).toHaveBeenCalledWith('Per board');
  });

  it('multiple questions: one radio group per question, labelled by its prompt', () => {
    render(<QuestionPicker questions={two} onSubmit={vi.fn()} />);
    expect(screen.getByText(/À toi de trancher · 2 questions/)).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Front (lot 5) ?' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Les 6 écarts ?' })).toBeTruthy();
  });

  it('multiple questions: counts answers and only enables the send button once all are picked', () => {
    const onSubmit = vi.fn();
    render(<QuestionPicker questions={two} onSubmit={onSubmit} />);
    const send = screen.getByRole('button', { name: 'Envoyer les 2 réponses' }) as HTMLButtonElement;
    expect(screen.getByText('0/2 répondues')).toBeTruthy();
    expect(screen.getByText('Encore 2 à choisir')).toBeTruthy();
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Ticket séparé' }));
    expect(screen.getByText('1/2 répondues')).toBeTruthy();
    expect(screen.getByText('Encore 1 à choisir')).toBeTruthy();
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Je valide' }));
    expect(send.disabled).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('multiple questions: re-picking replaces the pick, and send posts the latest picks', () => {
    const onSubmit = vi.fn();
    render(<QuestionPicker questions={two} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Attacher ici' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Ticket séparé' }));
    expect(screen.getByRole('radio', { name: 'Attacher ici' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Ticket séparé' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Je valide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer les 2 réponses' }));
    expect(onSubmit).toHaveBeenCalledWith('**Front (lot 5) ?** Ticket séparé\n**Les 6 écarts ?** Je valide');
  });

  it('disabled: no option can be picked', () => {
    render(<QuestionPicker questions={one} onSubmit={vi.fn()} disabled />);
    expect((screen.getByRole('button', { name: 'Global' }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe('custom answer (Autre…)', () => {
    const group = (name: string) => within(screen.getByRole('radiogroup', { name }));

    it('multiple questions: Autre… opens a free-text field that only counts once filled', () => {
      render(<QuestionPicker questions={two} onSubmit={vi.fn()} />);
      fireEvent.click(group('Front (lot 5) ?').getByRole('radio', { name: 'Autre…' }));
      const field = screen.getByRole('textbox', { name: 'Réponse libre — Front (lot 5) ?' });
      expect(screen.getByText('0/2 répondues')).toBeTruthy();
      fireEvent.change(field, { target: { value: '   ' } });
      expect(screen.getByText('0/2 répondues')).toBeTruthy();
      fireEvent.change(field, { target: { value: 'Plus tard' } });
      expect(screen.getByText('1/2 répondues')).toBeTruthy();
    });

    it('multiple questions: the typed text is sent as that question\'s answer', () => {
      const onSubmit = vi.fn();
      render(<QuestionPicker questions={two} onSubmit={onSubmit} />);
      fireEvent.click(group('Front (lot 5) ?').getByRole('radio', { name: 'Autre…' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Réponse libre — Front (lot 5) ?' }), { target: { value: ' Plus tard ' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Je valide' }));
      fireEvent.click(screen.getByRole('button', { name: 'Envoyer les 2 réponses' }));
      expect(onSubmit).toHaveBeenCalledWith('**Front (lot 5) ?** Plus tard\n**Les 6 écarts ?** Je valide');
    });

    it('multiple questions: picking a predefined option again replaces the custom answer', () => {
      const onSubmit = vi.fn();
      render(<QuestionPicker questions={two} onSubmit={onSubmit} />);
      fireEvent.click(group('Front (lot 5) ?').getByRole('radio', { name: 'Autre…' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Réponse libre — Front (lot 5) ?' }), { target: { value: 'Plus tard' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Attacher ici' }));
      expect(screen.queryByRole('textbox', { name: 'Réponse libre — Front (lot 5) ?' })).toBeNull();
      fireEvent.click(screen.getByRole('radio', { name: 'Je valide' }));
      fireEvent.click(screen.getByRole('button', { name: 'Envoyer les 2 réponses' }));
      expect(onSubmit).toHaveBeenCalledWith('**Front (lot 5) ?** Attacher ici\n**Les 6 écarts ?** Je valide');
    });

    it('single question: Autre… opens a field, Enter sends the typed text', () => {
      const onSubmit = vi.fn();
      render(<QuestionPicker questions={one} onSubmit={onSubmit} />);
      fireEvent.click(screen.getByRole('button', { name: 'Autre…' }));
      expect(onSubmit).not.toHaveBeenCalled();
      const field = screen.getByRole('textbox', { name: 'Réponse libre — Scope ?' });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(onSubmit).not.toHaveBeenCalled();
      fireEvent.change(field, { target: { value: 'Les deux' } });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(onSubmit).toHaveBeenCalledWith('Les deux');
    });
  });
});
