import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Session } from '@fleex/shared';
import { ShellSurface } from './ShellSurface';
import { useWorkStore } from '../../../stores/workStore';
import { terminalManager } from '../../../services/terminalManager';

/**
 * Opening a shell should leave you typing in it. The tab bar's "+" used to throw
 * the new session's id away: the shell appeared in a pane, its terminal mounted,
 * and the keyboard stayed nowhere — one click on the pane before you could type.
 */

const TICKET = 't-1';

const { focus, terminals } = vi.hoisted(() => ({
  focus: vi.fn(),
  terminals: new Map<string, { terminal: { focus: () => void } }>(),
}));

// xterm needs a real canvas, so the hook is stubbed — but it keeps the contract
// that matters here: the terminal comes into existence in the pane's own mount
// effect, and not one moment earlier.
vi.mock('../../../hooks/useTerminal', async () => {
  const { useEffect } = await import('react');
  return {
    useTerminal: (sessionId: string | null) => {
      useEffect(() => {
        if (sessionId) terminals.set(sessionId, { terminal: { focus } });
      }, [sessionId]);
    },
  };
});

vi.mock('../../../services/terminalManager', () => ({
  terminalManager: { get: (id: string) => terminals.get(id) ?? null },
}));

let sessions: Session[] = [];
const newShell = vi.fn();
vi.mock('./useShellSessions', () => ({
  useShellSessions: () => ({
    sessions,
    creating: false,
    newShell,
    killShell: vi.fn(),
    renameShell: vi.fn(),
  }),
}));

function session(id: string): Session {
  return { id, displayName: id, cwd: `/ws/${id}`, type: 'shell', status: 'running' } as unknown as Session;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessions = [];
  terminals.clear();
  useWorkStore.setState({ shellLayoutByTicket: {}, shellPaneIdsByTicket: {} } as never);
});

afterEach(cleanup);

describe('ShellSurface — a new shell takes the keyboard', () => {
  it('focuses the terminal of the shell it just opened', async () => {
    newShell.mockImplementation(async () => {
      // The session lands in the store the way the real refetch delivers it.
      sessions = [session('s-new')];
      return 's-new';
    });
    const { rerender } = render(<ShellSurface ticketId={TICKET} />);

    fireEvent.click(screen.getByTitle('New shell'));
    await waitFor(() => expect(newShell).toHaveBeenCalled());
    rerender(<ShellSurface ticketId={TICKET} />);

    await waitFor(() => expect(focus).toHaveBeenCalled());
  });

  it('shows the new shell in the focused pane, since panes never auto-fill', async () => {
    newShell.mockImplementation(async () => {
      sessions = [session('s-new')];
      return 's-new';
    });
    render(<ShellSurface ticketId={TICKET} />);

    fireEvent.click(screen.getByTitle('New shell'));

    await waitFor(() => {
      expect(useWorkStore.getState().shellPaneIdsByTicket[TICKET]?.[0]).toBe('s-new');
    });
  });

  /**
   * The terminal does not exist until the pane mounts it, so nothing can focus
   * it before that — the focus has to be applied by the pane itself rather than
   * by whoever asked for the shell.
   */
  it('focuses a terminal that did not exist when the shell was asked for', async () => {
    newShell.mockImplementation(async () => {
      sessions = [session('s-new')];
      return 's-new';
    });
    render(<ShellSurface ticketId={TICKET} />);
    expect(terminals.has('s-new')).toBe(false);

    fireEvent.click(screen.getByTitle('New shell'));

    await waitFor(() => expect(focus).toHaveBeenCalled());
  });

  /**
   * The POST answers with the session id, but the session itself reaches the
   * store on the next WS refetch. Between the two, the id belongs to no session
   * the surface can see — which must read as "not yet", never as "gone".
   */
  it('waits for a session that the refetch has not delivered yet', async () => {
    newShell.mockResolvedValue('s-late');
    const { rerender } = render(<ShellSurface ticketId={TICKET} />);

    fireEvent.click(screen.getByTitle('New shell'));
    await waitFor(() => expect(newShell).toHaveBeenCalled());
    expect(focus).not.toHaveBeenCalled();

    // The refetch lands.
    sessions = [session('s-late')];
    rerender(<ShellSurface ticketId={TICKET} />);

    await waitFor(() => expect(focus).toHaveBeenCalled());
  });

  it('does not steal focus when opening a shell fails', async () => {
    newShell.mockResolvedValue(null);
    render(<ShellSurface ticketId={TICKET} />);

    fireEvent.click(screen.getByTitle('New shell'));
    await waitFor(() => expect(newShell).toHaveBeenCalled());

    expect(focus).not.toHaveBeenCalled();
  });
});
