import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from './Toaster';
import { toast } from '../../../lib/toast';
import { resetToasts, useToastStore } from '../../../stores/toastStore';

function renderToaster(linksEnabled = true) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route path="/tickets/42" element={<div>ticket 42</div>} />
      </Routes>
      <Toaster linksEnabled={linksEnabled} />
    </MemoryRouter>,
  );
}

beforeEach(() => resetToasts());
afterEach(cleanup);

describe('<Toaster/>', () => {
  it('renders an error as an alert inside a polite live region', () => {
    renderToaster();
    act(() => void toast.error('Request failed (500)', { detail: 'POST /api/tickets' }));
    expect(screen.getByRole('alert').textContent).toContain('Request failed (500)');
    expect(screen.getByText('POST /api/tickets')).toBeTruthy();
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('runs the action then closes the toast', () => {
    const onClick = vi.fn();
    renderToaster();
    act(() => void toast.info('"Build" deleted', { action: { label: 'Undo', onClick } }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByText('"Build" deleted')).toBeNull();
  });

  it('a linked toast navigates on click (or Enter) and closes', () => {
    renderToaster();
    act(() => void toast.show({ message: 'Workflow failed', link: '/tickets/42' }));
    fireEvent.keyDown(screen.getByRole('button', { name: /Workflow failed/ }), { key: 'Enter' });
    expect(screen.getByText('ticket 42')).toBeTruthy();
    expect(screen.queryByText('Workflow failed')).toBeNull();
  });

  it('ignores links where routes do not apply (mobile shell)', () => {
    renderToaster(false);
    act(() => void toast.show({ message: 'Workflow failed', link: '/tickets/42' }));
    expect(screen.getByRole('status').textContent).toContain('Workflow failed');
  });

  it('shows the expiry bar only for toasts that leave by themselves, and pauses it on hover', () => {
    renderToaster();
    act(() => void toast.show({ id: 'p', message: 'persistent', durationMs: null }));
    act(() => void toast.info('timed'));
    expect(screen.getAllByTestId('toast-progress')).toHaveLength(1);
    const card = screen.getByText('timed').closest('[data-paused]')!;
    fireEvent.mouseEnter(card);
    expect(card.getAttribute('data-paused')).toBe('true');
    fireEvent.mouseLeave(card);
    expect(card.getAttribute('data-paused')).toBe('false');
  });

  it('sits bottom-centre, lifted by the layout offset, or top while anchored', () => {
    renderToaster();
    const region = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(region.style.bottom).toBe('calc(0px + 1.5rem)');
    act(() => void useToastStore.getState().pushOffset(64));
    expect(region.style.bottom).toBe('calc(64px + 1.5rem)');
    act(() => void useToastStore.getState().pushAnchor('top'));
    expect(region.getAttribute('data-anchor')).toBe('top');
    expect(region.style.bottom).toBe('');
  });
});
