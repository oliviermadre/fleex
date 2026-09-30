import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ToolStrip } from './ToolStrip';
import { useWorkStore } from '../../../stores/workStore';
import type { WorkTask } from '../types';

afterEach(cleanup);

const task = { id: 't1', sessionCount: 0, changedLines: 0 } as unknown as WorkTask;

describe('ToolStrip — bottom panels', () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkStore.setState({ shellOpen: false, timelineOpen: false, shellMode: false });
  });

  it('shows Timeline right above Shell, disabled without a task', () => {
    render(<ToolStrip task={null} />);
    const timeline = screen.getByRole('button', { name: /Timeline/ });
    const shell = screen.getByRole('button', { name: /Shell/ });
    expect(timeline).toHaveProperty('disabled', true);
    expect(timeline.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opening the Timeline closes the shell drawer and vice versa', () => {
    render(<ToolStrip task={task} />);
    fireEvent.click(screen.getByRole('button', { name: /Shell/ }));
    expect(useWorkStore.getState().shellOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Timeline/ }));
    expect([useWorkStore.getState().timelineOpen, useWorkStore.getState().shellOpen]).toEqual([true, false]);
    expect(screen.getByRole('button', { name: /Timeline/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Shell/ }));
    expect([useWorkStore.getState().timelineOpen, useWorkStore.getState().shellOpen]).toEqual([false, true]);
  });
});
