import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';
import { WorkTopBarActions } from './WorkTopBarActions';

const SVG = '<svg viewBox="0 0 8 8"></svg>';

const pinned = { id: 'p1', icon: SVG, iconType: 'svg', label: 'Open Slack', actionType: 'url', actionValue: 'https://slack.com' } as const;
const workspaceAction = { id: 'w1', icon: SVG, iconType: 'svg', label: 'Open in Cursor', actionType: 'shell', actionValue: 'cursor .' } as const;
const ticket = { id: 'abc123def456', displayId: 7, title: 'Fix the thing', links: [] } as unknown as Ticket;

const executePinnedAction = vi.fn();
const executeWorkspaceAction = vi.fn();

beforeEach(() => {
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, basePath: '/base', pinnedIcons: [pinned], workspaceActions: [workspaceAction] },
    executePinnedAction,
    executeWorkspaceAction,
  });
  useTicketStore.setState({ tickets: [ticket] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * The bar's icon buttons used a native `title`, which the browser shows only
 * after ~1s. They now use the instant <Tooltip>. Keeping `title` alongside it
 * would show BOTH bubbles, so its absence is part of the contract — and since
 * the buttons are icon-only, the name must move to `aria-label` rather than
 * vanish for screen readers.
 */
describe('WorkTopBarActions tooltips', () => {
  it.each([
    ['a PINNED action', 'Open Slack'],
    ['a TICKET action', 'Open in Cursor'],
  ])('%s shows its label at once on hover, with no native title', (_group, label) => {
    render(<WorkTopBarActions ticketId={ticket.id} />);
    const button = screen.getByRole('button', { name: label });

    expect(button.hasAttribute('title')).toBe(false);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip').textContent).toBe(label);
  });

  it('still runs the pinned action when clicked', () => {
    render(<WorkTopBarActions ticketId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Slack' }));
    expect(executePinnedAction).toHaveBeenCalledWith(pinned);
  });

  it('still runs the ticket action, bound to the ticket workspace, when clicked', () => {
    render(<WorkTopBarActions ticketId={ticket.id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Cursor' }));
    expect(executeWorkspaceAction).toHaveBeenCalledTimes(1);
    expect(executeWorkspaceAction.mock.calls[0]![0]).toBe(workspaceAction);
    expect(executeWorkspaceAction.mock.calls[0]![1]).toMatchObject({ ticket_id: ticket.id });
  });
});
