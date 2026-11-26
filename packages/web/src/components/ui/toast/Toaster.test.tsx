import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FloorLine, Toaster } from './Toaster';
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

describe('<Toaster/> on the floor skin', () => {
  it('draws lines with no card, more of them, keeps a history, and draws nothing while quiet', () => {
    const key = useToastStore.getState().pushSkin('floor');
    renderToaster();
    const undo = vi.fn();
    act(() => { toast.success('Floor imported: 12 machines'); toast.info('"Build" deleted', { action: { label: 'Undo', onClick: undo } }); toast.warning('No room to paste here'); toast.error('Run failed'); toast.info('Fifth'); });
    expect(document.querySelector('[data-skin="floor"]')).toBeTruthy();
    expect(document.querySelectorAll('.fleex-floor-line')).toHaveLength(5);              // five lines, where cards stop at three
    expect(document.querySelector('.fleex-toast')).toBeNull();
    expect(screen.getByText('Floor imported: 12 machines').closest('.fleex-floor-line')!.textContent).toContain('✓');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalled();
    expect(useToastStore.getState().history.map((h) => h.message)).toEqual(['Floor imported: 12 machines', '"Build" deleted', 'No room to paste here', 'Run failed', 'Fifth']);
    act(() => { useToastStore.getState().popLayout(key); useToastStore.getState().pushSkin('quiet'); });
    expect(document.querySelector('.fleex-toaster')).toBeNull();
  });

  it('over the floor, a message keeps to one line and its choices wait for the log; there, it is whole and its choices answer', () => {
    useToastStore.getState().pushSkin('floor');
    renderToaster();
    const pick = vi.fn();
    act(() => void toast.show({ tone: 'action', title: 'From #786 · Spec', message: 'Two ways:\nkeep it or cut it', choices: [{ label: 'Couper : evaneos_informations seulement (recommandé)', onClick: () => pick('cut') }, { label: 'Garder et documenter', onClick: () => pick('keep') }] }));
    const line = document.querySelector<HTMLElement>('[data-skin="floor"] .fleex-floor-line')!;
    expect(line.querySelector('.truncate')!.textContent).toBe('From #786 · Spec Two ways: keep it or cut it');
    expect(line.textContent).toContain('Enter to answer');
    expect(screen.queryByRole('button', { name: /Couper/ })).toBeNull();
    cleanup();
    render(<MemoryRouter><FloorLine toast={useToastStore.getState().history.at(-1)!} /></MemoryRouter>);
    expect(document.querySelector('.whitespace-pre-line')!.textContent).toBe('From #786 · Spec Two ways:\nkeep it or cut it');
    fireEvent.click(screen.getByRole('button', { name: /Couper/ }));
    expect(pick).toHaveBeenCalledWith('cut');
  });

  it('draws the floor lines with the colours of the page that set the skin, not the app theme', () => {
    useToastStore.getState().pushSkin('floor', { '--theme-text-primary': '#fafafa', '--theme-bg-base': '#0b0b10' });
    renderToaster();
    act(() => void toast.info('Deliverable ready'));
    const host = document.querySelector<HTMLElement>('[data-skin="floor"]')!;
    expect(host.style.getPropertyValue('--theme-text-primary')).toBe('#fafafa');
    expect(host.style.getPropertyValue('--theme-bg-base')).toBe('#0b0b10');
  });
});
