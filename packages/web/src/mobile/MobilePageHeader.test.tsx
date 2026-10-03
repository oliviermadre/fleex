import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { MobilePageHeader, HeaderIconButton } from './MobilePageHeader';

afterEach(cleanup);

describe('MobilePageHeader', () => {
  it('always renders the screen title as an h1, with the count and contextual actions on the same line', () => {
    render(
      <MobilePageHeader
        title="Kanban"
        count={5}
        trailing={<HeaderIconButton label="Action" onClick={() => {}}>x</HeaderIconButton>}
      />,
    );
    const title = screen.getByRole('heading', { level: 1, name: 'Kanban' });
    // Title, count and action share one row so every screen reads the same.
    const row = title.parentElement!;
    expect(row.textContent).toContain('5');
    expect(row.querySelector('[aria-label="Action"]')).toBeTruthy();
  });

  it('gives the back button and icon buttons a 44px touch target', () => {
    const onBack = vi.fn();
    render(<MobilePageHeader title="Ticket" onBack={onBack} trailing={<HeaderIconButton label="Star" onClick={() => {}}>x</HeaderIconButton>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(onBack).toHaveBeenCalled();
    for (const name of ['Retour', 'Star']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\bh-11\b.*\bw-11\b/);
    }
  });
});
