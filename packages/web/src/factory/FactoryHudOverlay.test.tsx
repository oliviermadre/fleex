import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ConsoleStrip, FactoryCounters, HOLD_MS, StopChip } from './FactoryHudOverlay';
import { FactoryFinder, FiltersTab } from './FactoryFinder';
import { NO_FINDER } from './finder';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the overlays over the floor', () => {
  it('counts tickets, items, runs and what waits for you, each told on hover', () => {
    render(<FactoryCounters c={{ tickets: 60, items: 14, running: 1, maxRunning: 10, runsHour: 23, maxRunsHour: 100, waiting: 3 }} />);
    expect(screen.getByLabelText('60 tickets on the floor').textContent).toBe('60');
    expect(screen.getByLabelText(/14 items on the floor/)).toBeTruthy();
    expect(screen.getByLabelText('1 run in progress, 10 at most at once').textContent).toBe('1/10');
    expect(screen.getByLabelText('23 runs started this hour, 100 at most per hour').textContent).toBe('23/100');
    expect(screen.getByLabelText(/3 wait for you/)).toBeTruthy();
  });

  it('stops the floor only when the stop is held a second; let go before, nothing happens', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const onHalt = vi.fn();
    render(<StopChip halted={false} onHalt={onHalt} />);
    const stop = screen.getByRole('button', { name: /Emergency stop: hold/ });
    fireEvent.pointerDown(stop, { pointerId: 1 });
    act(() => { vi.advanceTimersByTime(HOLD_MS / 2); });
    expect(Number.parseFloat(screen.getByTestId('stop-fill').style.width)).toBeGreaterThan(30);
    fireEvent.pointerUp(stop, { pointerId: 1 });
    expect(screen.getByTestId('stop-fill').style.width).toBe('0%');
    fireEvent.click(stop);
    expect(onHalt).not.toHaveBeenCalled();
    fireEvent.pointerDown(stop, { pointerId: 1 });
    act(() => { vi.advanceTimersByTime(HOLD_MS + 50); });
    expect(onHalt).toHaveBeenCalledWith(true);
  });

  it('stopped, it says so and restarts on a plain click; the strip also hides the console', () => {
    const onHalt = vi.fn(), onHide = vi.fn();
    render(<ConsoleStrip halted onHalt={onHalt} hidden={false} onHide={onHide} />);
    fireEvent.click(screen.getByRole('button', { name: /Stopped.*Restart/ }));
    expect(onHalt).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Hide the console' }));
    expect(onHide).toHaveBeenCalled();
  });

  it('the Filters tab counts what is on and what it keeps; the popup filters by chips, Enter jumps, Escape clears then closes', () => {
    const tickets = [{ ticketId: 'a', info: { boardId: 'b1' } }, { ticketId: 'b', info: { boardId: 'b1' } }] as never[];
    render(<FiltersTab finder={{ ...NO_FINDER, q: 'retry', types: ['fix'] }} found={[tickets[0]!]} total={2} open={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Filters/ }).textContent).toContain('2');
    expect(screen.getByText('1 of 2 shown')).toBeTruthy();
    cleanup();
    const onChange = vi.fn(), onJump = vi.fn(), onClose = vi.fn();
    const { rerender } = render(<FactoryFinder finder={NO_FINDER} onChange={onChange} tickets={tickets} found={null} onJump={onJump} inputRef={{ current: null }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Fix/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_FINDER, types: ['fix'] });
    const input = screen.getByLabelText('Find a ticket by title, number or tag');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onJump).toHaveBeenCalled();
    rerender(<FactoryFinder finder={{ ...NO_FINDER, q: 'x' }} onChange={onChange} tickets={tickets} found={[]} onJump={onJump} inputRef={{ current: null }} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText('Find a ticket by title, number or tag'), { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_FINDER, q: '' });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<FactoryFinder finder={NO_FINDER} onChange={onChange} tickets={tickets} found={null} onJump={onJump} inputRef={{ current: null }} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText('Find a ticket by title, number or tag'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
