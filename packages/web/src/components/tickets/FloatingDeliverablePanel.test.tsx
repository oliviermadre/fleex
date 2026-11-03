import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { TicketDeliverable } from '@fleex/shared';
import { FloatingDeliverablePanel } from './FloatingDeliverablePanel';

const deliverable = (extra: Partial<TicketDeliverable> = {}): TicketDeliverable => ({
  id: 'd1', ticketId: 't1', agentName: 'builder', type: 'report', title: 'Analysis',
  content: '# Hello', version: 1, status: 'final', mentionId: null,
  createdAt: new Date().toISOString(), ...extra,
}) as TicketDeliverable;

const panels = () => [...document.querySelectorAll<HTMLElement>('[data-floating-panel]')];
const placement = (el = panels()[0]!) => el.getAttribute('data-placement');
const bar = (el = panels()[0]!) => el.querySelector<HTMLElement>('[data-deliverable-bar]')!;
const box = (el = panels()[0]!) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) });
const grips = () => [...document.querySelectorAll<HTMLElement>('[style*="-resize"]')];
const drag = (from: Element, dx: number, dy: number) => {
  fireEvent.mouseDown(from, { button: 0, clientX: 300, clientY: 200 });
  fireEvent.mouseMove(window, { clientX: 300 + dx, clientY: 200 + dy });
  fireEvent.mouseUp(window);
};

afterEach(cleanup);

describe('FloatingDeliverablePanel · maximize', () => {
  it('Maximize fills the window and turns into Restore, which frees it again', () => {
    render(<FloatingDeliverablePanel deliverable={deliverable()} onClose={() => {}} />);
    expect(placement()).toBe('floating');
    fireEvent.click(screen.getByRole('button', { name: 'Maximize (double-click the bar)' }));
    expect(placement()).toBe('maximized');
    const s = panels()[0]!.style;
    expect([s.top, s.left, s.right, s.bottom, s.width, s.height]).toEqual(['16px', '16px', '16px', '16px', '', '']);
    fireEvent.click(screen.getByRole('button', { name: 'Restore size (double-click the bar)' }));
    expect(placement()).toBe('floating');
  });

  it('double-clicking the bar toggles; a double-click on a bar button does not', () => {
    render(<FloatingDeliverablePanel deliverable={deliverable()} onClose={() => {}} />);
    fireEvent.doubleClick(bar());
    expect(placement()).toBe('maximized');
    fireEvent.doubleClick(bar());
    expect(placement()).toBe('floating');
    for (const b of within(bar()).getAllByRole('button')) {
      fireEvent.doubleClick(b);
      expect(placement()).toBe('floating');
    }
  });

  it('Restore puts it back exactly where and as big as the user left it', () => {
    render(<FloatingDeliverablePanel deliverable={deliverable()} onClose={() => {}} />);
    const start = box();
    drag(bar(), -50, -20);
    drag(document.querySelector('[style*="se-resize"]')!, 40, 30);
    const before = box();
    expect(before).toEqual({ x: start.x - 50, y: start.y - 20, width: start.width + 40, height: start.height + 30 });

    fireEvent.doubleClick(bar());
    fireEvent.doubleClick(bar());
    expect(box()).toEqual(before);
  });

  it('maximized is pinned: no grips, no grab cursor, and dragging the bar does nothing', () => {
    render(<FloatingDeliverablePanel deliverable={deliverable()} onClose={() => {}} />);
    expect(grips()).toHaveLength(8);
    const before = box();
    fireEvent.doubleClick(bar());
    expect(grips()).toHaveLength(0);
    expect(bar().style.cursor).toBe('default');
    drag(bar(), -100, -60);
    fireEvent.doubleClick(bar());
    expect(box()).toEqual(before);
    expect(bar().style.cursor).toBe('grab');
  });

  it.each([/^Maximize/, '×'])('a press on a bar button (%s) does not start a drag', (name) => {
    render(<FloatingDeliverablePanel deliverable={deliverable()} onClose={() => {}} />);
    const before = box();
    drag(screen.getByRole('button', { name }), -100, -60);
    expect(box()).toEqual(before);
  });

  it('each floating window has its own maximize', () => {
    render(
      <>
        <FloatingDeliverablePanel deliverable={deliverable()} onClose={() => {}} />
        <FloatingDeliverablePanel deliverable={deliverable({ id: 'd2', title: 'Other' })} onClose={() => {}} />
      </>,
    );
    const [a, b] = panels();
    fireEvent.doubleClick(bar(a));
    expect(placement(a)).toBe('maximized');
    expect(placement(b)).toBe('floating');
  });
});
