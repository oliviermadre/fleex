import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useRoutineLiveUpdates', () => ({ useRoutineLiveUpdates: () => {} }));
vi.mock('../notifications/NotificationNavItem', () => ({ NotificationNavItem: () => null }));
vi.mock('../../stores/focusStore', () => ({ useFocusCount: () => 0 }));
vi.mock('../../stores/routineStore', () => ({
  useRoutineStore: (sel: (s: unknown) => unknown) => sel({ routines: [], load: async () => {} }),
}));

import { NavSidebar } from './NavSidebar';

describe('<NavSidebar/>', () => {
  it('puts the Agenda right above the Assistant', () => {
    const { container } = render(<MemoryRouter><NavSidebar /></MemoryRouter>);
    const text = container.textContent ?? '';
    expect(text.indexOf('Agenda')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Agenda')).toBeLessThan(text.indexOf('Assistant'));
  });
});
