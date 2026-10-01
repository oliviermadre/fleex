import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import type { PinnedIcon } from '@fleex/shared';
import { RouterSync } from '../../../router/RouterSync';
import { useSettingsStore } from '../../../stores/settingsStore';
import { usePinnedActionsStore } from '../../../stores/pinnedActionsStore';
import { useToastStore } from '../../../stores/toastStore';
import { isLeaveGuarded, useUIStore } from '../../../stores/uiStore';
import { useActionsSettingsStore } from '../../../stores/actionsSettingsStore';
import { useCommandItems } from '../../command-palette/useCommandItems';
import { PinnedActionButton } from '../../actions/PinnedActionButton';
import { SettingsNav } from '../SettingsNav';
import { ActionsTab } from './ActionsTab';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  updateConfig: vi.fn(async () => ({})),
  fetchActionRuns: vi.fn(async () => []),
  fetchActionsAiStatus: vi.fn(async () => ({ available: false })),
}));

/**
 * Every way out of a dirty ActionDetail must open Save / Discard / Stay rather
 * than drop the draft — and nothing may stay guarded once the screen is gone.
 */

const icon = (id: string): PinnedIcon => ({ id, icon: '', iconType: 'svg', label: id.toUpperCase(), actionType: 'shell', actionValue: `echo ${id}` });

let navigate: NavigateFunction;
let path = '';
let paletteItems: ReturnType<typeof useCommandItems> = [];
function Probe() {
  navigate = useNavigate();
  path = useLocation().pathname;
  paletteItems = useCommandItems('');
  return null;
}

/** RouterSync ignores store changes until the tick after a URL sync. */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

function renderScreen(entries = ['/settings/actions/pinned/a'], index = entries.length - 1) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <RouterSync />
      <Probe />
      <div role="toolbar" aria-label="Top bar">
        <PinnedActionButton action={icon('b')} kind="pinned" onRun={() => {}} />
      </div>
      <aside aria-label="Settings nav"><SettingsNav /></aside>
      <ActionsTab />
    </MemoryRouter>,
  );
}

const dialog = () => screen.queryByText('Unsaved changes', { selector: 'h2' });
const route = () => useUIStore.getState().actionsRoute;
const makeDirty = () => fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/** The dialog is up, nothing moved, and Stay keeps the draft. */
function expectAskedAndStay() {
  expect(dialog()).toBeTruthy();
  expect(route()).toEqual({ scope: 'pinned', id: 'a' });
  expect(path).toBe('/settings/actions/pinned/a');
  click('Stay');
  expect(dialog()).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Renamed');
}

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [icon('a'), icon('b'), icon('c')], workspaceActions: [] } });
  usePinnedActionsStore.setState({ statuses: {}, runs: {}, running: {}, logs: null });
  useToastStore.setState({ toasts: [] });
  useActionsSettingsStore.setState({ aiAvailable: false, pendingNew: null, composeOpen: false });
  useUIStore.setState({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope: 'pinned', id: 'a' } });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('ActionDetail leave guard — every exit path', () => {
  it('(a) command palette navigation', () => {
    renderScreen();
    makeDirty();
    act(() => paletteItems.find((i) => i.id === 'view:tickets')!.onExecute());
    expect(useUIStore.getState().activePanel).toBe('settings');
    expectAskedAndStay();

    act(() => paletteItems.find((i) => i.id === 'view:tickets')!.onExecute());
    click('Discard');
    expect(useUIStore.getState().activePanel).toBe('tickets');
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('A');
  });

  it('(b) Esc', () => {
    renderScreen();
    makeDirty();
    fireEvent.keyDown(window, { key: 'Escape' });
    expectAskedAndStay();
  });

  it('(c) the ‹ › buttons', async () => {
    renderScreen();
    makeDirty();
    click('Previous action');
    expectAskedAndStay();
    click('Next action');
    expectAskedAndStay();

    await settle();
    click('Next action');
    await act(async () => click('Discard'));
    expect(route()).toEqual({ scope: 'pinned', id: 'b' });
    expect(path).toBe('/settings/actions/pinned/b');
  });

  it('(d) the Top bar / Ticket scope links of the Settings nav', async () => {
    renderScreen();
    makeDirty();
    const nav = within(screen.getByRole('complementary', { name: 'Settings nav' }));
    await act(async () => fireEvent.click(nav.getByRole('button', { name: /^Ticket/ })));
    expectAskedAndStay();
    await act(async () => fireEvent.click(nav.getByRole('button', { name: /^Top bar/ })));
    expectAskedAndStay();

    await act(async () => fireEvent.click(nav.getByRole('button', { name: /^Ticket/ })));
    await act(async () => click('Discard'));
    expect(route()).toEqual({ scope: 'ticket', id: null });
    expect(path).toBe('/settings/actions/ticket');
  });

  it('(e) "Edit…" in an action button context menu', async () => {
    renderScreen();
    makeDirty();
    const button = within(screen.getByRole('toolbar', { name: 'Top bar' })).getByRole('button', { name: 'B' });
    fireEvent.contextMenu(button);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit…' }));
    expectAskedAndStay();

    fireEvent.contextMenu(button);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit…' }));
    click('Discard');
    expect(route()).toEqual({ scope: 'pinned', id: 'b' });
  });

  it('(f) browser Back', async () => {
    renderScreen(['/settings/general', '/settings/actions/pinned/a'], 1);
    makeDirty();
    await act(async () => navigate(-1));
    expect(useUIStore.getState().settingsTab).toBe('actions');
    expectAskedAndStay();

    // Stay must not have eaten the previous history entry: Back asks again.
    await settle();
    await act(async () => navigate(-1));
    expect(dialog()).toBeTruthy();
    await act(async () => click('Discard'));
    expect(useUIStore.getState().settingsTab).toBe('general');
    expect(path).toBe('/settings/general');
  });

  it('(f) browser Forward', async () => {
    renderScreen(['/settings/actions/pinned/a', '/settings/actions/pinned/c'], 0);
    makeDirty();
    await act(async () => navigate(1));
    expectAskedAndStay();
  });

  it('leaves no guard behind once the detail screen is gone', async () => {
    const { unmount } = renderScreen();
    makeDirty();
    expect(isLeaveGuarded()).toBe(true);

    // Left through Discard: the list shows, navigation is immediate again.
    click('Back to the list (Esc)');
    click('Discard');
    expect(route()).toEqual({ scope: 'pinned', id: null });
    expect(isLeaveGuarded()).toBe(false);
    act(() => useUIStore.getState().setSettingsTab('general'));
    expect(useUIStore.getState().settingsTab).toBe('general');
    expect(dialog()).toBeNull();
    unmount();

    // Unmounted while dirty (e.g. the whole Settings panel went away).
    useUIStore.setState({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope: 'pinned', id: 'a' } });
    const second = renderScreen();
    makeDirty();
    expect(isLeaveGuarded()).toBe(true);
    second.unmount();
    expect(isLeaveGuarded()).toBe(false);
    useUIStore.getState().setActivePanel('tickets');
    expect(useUIStore.getState().activePanel).toBe('tickets');
  });
});
