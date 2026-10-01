import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { PinnedIcon } from '@fleex/shared';
import { SettingsNav } from './SettingsNav';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';

const icon = (id: string): PinnedIcon => ({ id, icon: '', iconType: 'svg', label: id, actionType: 'shell', actionValue: 'true' });
let path = '';
function Where() {
  path = useLocation().pathname;
  return null;
}

afterEach(cleanup);

describe('SettingsNav › Actions scopes', () => {
  it('shows both scopes with their counts even outside the Actions tab, and jumps straight to one', () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [icon('a'), icon('b')], workspaceActions: [] } });
    useUIStore.setState({ activePanel: 'settings', settingsTab: 'general', actionsRoute: { scope: 'pinned', id: null } });
    render(<MemoryRouter initialEntries={['/settings/general']}><SettingsNav /><Where /></MemoryRouter>);

    const topBar = screen.getByRole('button', { name: /Top bar/ });
    const ticket = screen.getByRole('button', { name: /Ticket/ });
    expect(topBar.textContent).toContain('2');
    expect(ticket.textContent).toContain('0');
    // Not the current page while another tab is open.
    expect(topBar.getAttribute('aria-current')).toBeNull();

    fireEvent.click(ticket);
    expect(path).toBe('/settings/actions/ticket');
  });

  it('marks the current scope only when Settings › Actions is open', () => {
    useUIStore.setState({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope: 'ticket', id: null } });
    render(<MemoryRouter><SettingsNav /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Ticket/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: /Top bar/ }).getAttribute('aria-current')).toBeNull();
  });
});
