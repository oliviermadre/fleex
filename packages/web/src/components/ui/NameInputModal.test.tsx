import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { NameInputModal } from './NameInputModal';

afterEach(cleanup);

function setup(withEmoji: boolean) {
  const onConfirm = vi.fn();
  render(
    <NameInputModal
      open
      title="Créer un board"
      placeholder="Nom du board"
      emoji={withEmoji ? { defaultValue: '📋' } : undefined}
      onConfirm={onConfirm}
      onClose={() => {}}
    />,
  );
  return { onConfirm, name: screen.getByPlaceholderText('Nom du board') };
}

describe('NameInputModal', () => {
  it('without the emoji prop, shows no emoji field and confirms the name only (epic creation is unchanged)', () => {
    const { onConfirm, name } = setup(false);
    expect(screen.queryByLabelText('Emoji')).toBeNull();
    fireEvent.change(name, { target: { value: 'Onboarding' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('Onboarding', undefined);
  });

  it('with the emoji prop, pre-fills the default and still focuses the name', () => {
    const { onConfirm, name } = setup(true);
    expect((screen.getByLabelText('Emoji') as HTMLInputElement).value).toBe('📋');
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: 'Roadmap Q1' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('Roadmap Q1', '📋');
  });

  it('confirms the chosen emoji, normalised to its first grapheme', () => {
    const { onConfirm, name } = setup(true);
    const emoji = screen.getByLabelText('Emoji');
    fireEvent.change(emoji, { target: { value: '🚀abc' } });
    fireEvent.change(name, { target: { value: 'Perso' } });
    fireEvent.keyDown(emoji, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('Perso', '🚀');
  });

  it('omits a blanked emoji so the server applies its default', () => {
    const { onConfirm, name } = setup(true);
    fireEvent.change(screen.getByLabelText('Emoji'), { target: { value: '' } });
    fireEvent.change(name, { target: { value: 'Perso' } });
    fireEvent.click(screen.getByText('Créer'));
    expect(onConfirm).toHaveBeenCalledWith('Perso', undefined);
  });
});
