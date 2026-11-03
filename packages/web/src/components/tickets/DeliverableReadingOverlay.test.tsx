import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { TicketDeliverable } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import { DeliverableReadingOverlay } from './DeliverableReadingOverlay';
import { FloatingDeliverablePanel } from './FloatingDeliverablePanel';

const deliverable = (extra: Partial<TicketDeliverable> = {}): TicketDeliverable => ({
  id: 'd1', ticketId: 't1', agentName: 'builder', type: 'html', title: 'Interactive mockup',
  content: '<!DOCTYPE html><p>hi</p>', version: 1, status: 'final', mentionId: null,
  createdAt: new Date().toISOString(), ...extra,
}) as TicketDeliverable;

const panel = () => document.querySelector<HTMLElement>('.deliverable-overlay-panel')!;
const bar = () => document.querySelector<HTMLElement>('[data-deliverable-bar]')!;
const placement = () => panel().getAttribute('data-placement');
const open = (d: TicketDeliverable = deliverable()) => act(() => useUIStore.getState().openDeliverableOverlay(d));
const titleBar = (bottom: number) => {
  const el = document.createElement('div');
  el.id = 'fleex-desktop-titlebar';
  el.getBoundingClientRect = () => ({ bottom }) as DOMRect;
  document.body.appendChild(el);
};

beforeEach(() => {
  useUIStore.setState({ deliverableOverlay: null, floatingDeliverableIds: [], floatingDeliverables: {} });
});
afterEach(() => {
  cleanup();
  document.getElementById('fleex-desktop-titlebar')?.remove();
});

describe('DeliverableReadingOverlay · maximize', () => {
  it('Maximize fills the window (16px margin, below the desktop title bar) with no 1200px / 85vh cap, and turns into Restore', () => {
    titleBar(38);
    render(<DeliverableReadingOverlay />);
    open();
    expect(placement()).toBe('centered');
    expect(panel().style.height).toBe('85vh');

    fireEvent.click(screen.getByRole('button', { name: /^Maximize/ }));

    expect(placement()).toBe('maximized');
    expect(panel().classList.contains('deliverable-overlay-panel--maximized')).toBe(true);
    const s = panel().style;
    expect([s.top, s.left, s.right, s.bottom]).toEqual(['54px', '16px', '16px', '16px']);
    // The interactive mockup is no longer squeezed into 85vh.
    expect(s.height).toBe('');
    expect(screen.queryByRole('button', { name: /^Maximize/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore size (double-click the bar)' }).getAttribute('data-window-button')).toBe('restore');
  });

  it('Restore brings back the centred pop-up', () => {
    render(<DeliverableReadingOverlay />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /^Maximize/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Restore size/ }));
    expect(placement()).toBe('centered');
    expect(panel().style.height).toBe('85vh');
  });

  it('double-clicking the bar maximizes, and again restores — like the Action terminal', () => {
    render(<DeliverableReadingOverlay />);
    open();
    fireEvent.doubleClick(screen.getByText('Interactive mockup', { selector: 'span' }));
    expect(placement()).toBe('maximized');
    fireEvent.doubleClick(bar());
    expect(placement()).toBe('centered');
  });

  it('the bar can be double-clicked without selecting the title', () => {
    render(<DeliverableReadingOverlay />);
    open();
    expect(bar().classList.contains('select-none')).toBe(true);
  });

  it('a double-click on one of the bar buttons is that button, never a maximize', () => {
    render(<DeliverableReadingOverlay />);
    open();
    const buttons = [
      screen.getByRole('button', { name: /Copy to clipboard/ }),
      screen.getByRole('button', { name: /Copy to…/ }),
      screen.getByRole('button', { name: /Detach/ }),
      screen.getByRole('button', { name: /^Maximize/ }),
      screen.getByRole('button', { name: /^Close/ }),
      // The type badge is a picker button too.
      bar().querySelector('button')!,
    ];
    for (const b of buttons) {
      fireEvent.doubleClick(b);
      expect(placement()).toBe('centered');
    }
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['Close', () => fireEvent.click(screen.getByRole('button', { name: /^Close/ }))],
    ['a click on the backdrop', () => fireEvent.mouseDown(document.querySelector('.deliverable-overlay-backdrop')!)],
  ])('closed while maximized (%s), the next deliverable opens centred', (_, closeIt) => {
    render(<DeliverableReadingOverlay />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /^Maximize/ }));
    act(closeIt);
    expect(useUIStore.getState().deliverableOverlay).toBeNull();
    open();
    expect(placement()).toBe('centered');
  });

  it('opening another deliverable over a maximized one starts centred', () => {
    render(<DeliverableReadingOverlay />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /^Maximize/ }));
    open(deliverable({ id: 'd2', title: 'Another one' }));
    expect(placement()).toBe('centered');
  });

  it('Detach from maximized opens a free (not maximized) floating window and closes the pop-up', () => {
    render(<DeliverableReadingOverlay />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /^Maximize/ }));
    fireEvent.click(screen.getByRole('button', { name: /Detach/ }));

    const ui = useUIStore.getState();
    expect(ui.deliverableOverlay).toBeNull();
    expect(ui.floatingDeliverableIds).toEqual(['d1']);
    render(<FloatingDeliverablePanel deliverable={ui.floatingDeliverables.d1!} onClose={() => {}} />);
    expect(document.querySelector('[data-floating-panel]')!.getAttribute('data-placement')).toBe('floating');
  });
});
