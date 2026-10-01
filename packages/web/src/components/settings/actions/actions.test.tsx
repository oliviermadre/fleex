import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act, within } from '@testing-library/react';
import type { PinnedIcon } from '@fleex/shared';
import { useSettingsStore } from '../../../stores/settingsStore';
import { usePinnedActionsStore } from '../../../stores/pinnedActionsStore';
import { useToastStore } from '../../../stores/toastStore';
import { useUIStore } from '../../../stores/uiStore';
import { useActionsSettingsStore } from '../../../stores/actionsSettingsStore';
import * as api from '../../../services/api';
import { ActionList } from './ActionList';
import { ActionDetail } from './ActionDetail';
import { normaliseDraft, validateDraft, moveItem, blankDraft } from './actionModel';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  updateConfig: vi.fn(async () => ({})),
  fetchActionRuns: vi.fn(async () => []),
  fetchActionsAiStatus: vi.fn(async () => ({ available: false })),
}));

const icon = (id: string, extra: Partial<PinnedIcon> = {}): PinnedIcon => ({
  id, icon: '', iconType: 'svg', label: id.toUpperCase(), actionType: 'shell', actionValue: `echo ${id}`, ...extra,
});

const pinnedIds = () => useSettingsStore.getState().settings.pinnedIcons.map((i) => i.id);

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [icon('a'), icon('b'), icon('c')], workspaceActions: [] } });
  usePinnedActionsStore.setState({ statuses: {}, runs: {}, running: {}, logs: null });
  useToastStore.setState({ toasts: [] });
  useActionsSettingsStore.setState({ aiAvailable: false, pendingNew: null, composeOpen: false });
  useUIStore.setState({ actionsRoute: { scope: 'pinned', id: null } });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('ActionList', () => {
  it('reorders with ⌥↓ and persists at once (the header follows without a Save)', () => {
    render(<ActionList scope="pinned" />);
    fireEvent.keyDown(screen.getByRole('listitem', { name: 'A' }), { key: 'ArrowDown', altKey: true });
    expect(pinnedIds()).toEqual(['b', 'a', 'c']);
    expect(api.updateConfig).toHaveBeenCalledWith({ pinnedIcons: expect.any(Array) });
  });

  it('deletes without a confirmation and Undo puts the action back at the same position', () => {
    render(<ActionList scope="pinned" />);
    fireEvent.keyDown(screen.getByRole('listitem', { name: 'B' }), { key: 'Backspace' });
    expect(pinnedIds()).toEqual(['a', 'c']);

    const toast = useToastStore.getState().toasts.at(-1)!;
    expect(toast.action?.label).toBe('Undo');
    act(() => toast.action!.onClick());
    expect(pinnedIds()).toEqual(['a', 'b', 'c']);
  });

  it('hides an action with the Visible switch instead of deleting it', () => {
    render(<ActionList scope="pinned" />);
    fireEvent.click(screen.getByRole('switch', { name: 'C visible' }));
    expect(useSettingsStore.getState().settings.pinnedIcons.find((i) => i.id === 'c')!.enabled).toBe(false);
    expect(pinnedIds()).toEqual(['a', 'b', 'c']);
  });

  it('opens the detail on Enter', () => {
    render(<ActionList scope="pinned" />);
    fireEvent.keyDown(screen.getByRole('listitem', { name: 'A' }), { key: 'Enter' });
    expect(useUIStore.getState().actionsRoute).toEqual({ scope: 'pinned', id: 'a' });
  });

  it('hides every AI button when Claude is not connected', () => {
    render(<ActionList scope="pinned" />);
    expect(screen.queryByText(/Describe an action/)).toBeNull();
  });
});

describe('ActionDetail', () => {
  it('shows the save bar on the first edit and ⌘S persists the draft', async () => {
    render(<ActionDetail scope="pinned" id="a" />);
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeTruthy();
    // The settings themselves are untouched until Save.
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('A');

    await act(async () => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('Renamed');
  });

  it('asks Save / Discard / Stay before leaving with unsaved changes', () => {
    useUIStore.setState({ actionsRoute: { scope: 'pinned', id: 'a' } });
    render(<ActionDetail scope="pinned" id="a" />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list (Esc)' }));
    expect(screen.getByText('Unsaved changes', { selector: 'h2' })).toBeTruthy();
    expect(useUIStore.getState().actionsRoute.id).toBe('a');

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useUIStore.getState().actionsRoute).toEqual({ scope: 'pinned', id: null });
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('A');
  });

  it('the simulator changes what the preview says the click will do, without persisting', () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        pinnedIcons: [icon('kp', {
          label: 'K8s prod',
          actionValue: 'platool login prod',
          status: { command: 'kubectl cluster-info', intervalSec: 60 },
          conditionalActions: [{ id: 'r', label: 'Disconnect from prod', when: ['ok'], actionType: 'shell', actionValue: 'platool logout prod' }],
        })],
      },
    });
    render(<ActionDetail scope="pinned" id="kp" />);
    const preview = screen.getByRole('complementary', { name: 'Preview' });

    const simulator = within(screen.getByRole('group', { name: 'Simulate a status' }));
    fireEvent.click(simulator.getByRole('button', { name: /OK/ }));
    expect(preview.textContent).toContain('Click: Disconnect from prod');
    fireEvent.click(simulator.getByRole('button', { name: /KO/ }));
    expect(preview.textContent).toContain('Click: platool login prod');
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
  });

  it('blocks Save on an invalid draft and says why', async () => {
    render(<ActionDetail scope="pinned" id="a" />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    });
    expect(screen.getByText('A name is required.')).toBeTruthy();
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('A');
  });
});

describe('actionModel', () => {
  it('drops probe and rules from a ticket action, and rules when the probe is off', () => {
    const d = { ...blankDraft(), label: 'x', actionValue: 'y', status: { command: 'true', intervalSec: 60 }, conditionalActions: [] };
    expect(normaliseDraft(d, 'ticket')).not.toHaveProperty('status');
    expect(normaliseDraft({ ...d, status: undefined, conditionalActions: [{ id: 'r', label: '', when: ['ok'], actionType: 'shell', actionValue: 'z' }] }, 'pinned'))
      .not.toHaveProperty('conditionalActions');
  });

  it('requires a status and a command on each rule, and an http(s) URL', () => {
    const d = { ...blankDraft(), label: 'x', actionValue: 'y', status: { command: 'true', intervalSec: 60 }, conditionalActions: [{ id: 'r', label: '', when: [], actionType: 'shell' as const, actionValue: '' }] };
    expect(validateDraft(d, 'pinned')).toHaveProperty('rule:0');
    expect(validateDraft({ ...blankDraft(), label: 'x', actionType: 'url', actionValue: 'ftp://x' }, 'pinned')).toHaveProperty('actionValue');
  });

  it('moveItem ignores moves past either end', () => {
    expect(moveItem([icon('a'), icon('b')], 'a', -1).map((i) => i.id)).toEqual(['a', 'b']);
  });
});
