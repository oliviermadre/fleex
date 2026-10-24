import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Screenshots are taken with ?demo=1 and published (release notes, fleex.dev):
// the footer must not leak the absolute path of the machine that took them.
vi.mock('../../lib/demoMode', () => ({ DEMO_MODE: true, FORCED_THEME_ID: null, DEMO_MODE_CSS: '' }));

import { WorkStatusBar } from './WorkStatusBar';
import { useTicketStore } from '../../stores/ticketStore';
import { useSettingsStore } from '../../stores/settingsStore';

describe('WorkStatusBar in demo mode', () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, basePath: '/Users/someone/.fleex/demo/repos' } }));
    useTicketStore.setState({ tickets: [{ id: 't1', displayId: 7, title: 'Paiement en 3 fois' } as never] });
  });

  it('shows the ticket but not the workspace path', () => {
    render(<WorkStatusBar task={{ id: 't1', number: 7, title: 'Paiement en 3 fois', boardName: 'Atelier Nova' } as never} />);
    expect(screen.getByText('Paiement en 3 fois')).toBeTruthy();
    expect(screen.queryByText(/\/Users\/someone/)).toBeNull();
    expect(screen.queryByLabelText('Copy workspace path')).toBeNull();
  });
});
