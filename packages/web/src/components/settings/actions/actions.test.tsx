import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act, within } from '@testing-library/react';
import type { PinnedIcon } from '@fleex/shared';
import { useSettingsStore } from '../../../stores/settingsStore';
import { usePinnedActionsStore } from '../../../stores/pinnedActionsStore';
import { useToastStore } from '../../../stores/toastStore';
import { useUIStore } from '../../../stores/uiStore';
import { useActionsSettingsStore } from '../../../stores/actionsSettingsStore';
import { useTicketStore } from '../../../stores/ticketStore';
import { useWorkStore } from '../../../stores/workStore';
import * as api from '../../../services/api';
import { ActionList } from './ActionList';
import { ActionDetail } from './ActionDetail';
import { normaliseDraft, validateDraft, moveItem, blankDraft } from './actionModel';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  updateConfig: vi.fn(async () => ({})),
  fetchActionRuns: vi.fn(async () => []),
  fetchActionsAiStatus: vi.fn(async () => ({ available: false })),
  testPinnedProbe: vi.fn(),
  diagnoseBinary: vi.fn(async () => null),
  startActionRun: vi.fn(async () => ({ runId: 'r1', alreadyRunning: false })),
  ensureTicketWorkspace: vi.fn(async () => true),
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

  it('guards every way out — another Settings tab, another panel — not only its own buttons', async () => {
    useUIStore.setState({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope: 'pinned', id: 'a' } });
    render(<ActionDetail scope="pinned" id="a" />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });

    // Clicking another Settings tab used to drop the draft silently.
    act(() => useUIStore.getState().setSettingsTab('general'));
    expect(screen.getByText('Unsaved changes', { selector: 'h2' })).toBeTruthy();
    expect(useUIStore.getState().settingsTab).toBe('actions');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(useUIStore.getState().settingsTab).toBe('actions');
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Renamed');

    // Same for another panel of the app; Save then follows the navigation.
    act(() => useUIStore.getState().setActivePanel('tickets'));
    expect(useUIStore.getState().activePanel).toBe('settings');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('Renamed');
    expect(useUIStore.getState().activePanel).toBe('tickets');
  });

  it('lets navigation through untouched when nothing is unsaved', () => {
    useUIStore.setState({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope: 'pinned', id: 'a' } });
    render(<ActionDetail scope="pinned" id="a" />);
    act(() => useUIStore.getState().setSettingsTab('general'));
    expect(useUIStore.getState().settingsTab).toBe('general');
    expect(screen.queryByText('Unsaved changes', { selector: 'h2' })).toBeNull();
  });

  it('saving a new action moves to its own route without asking, and a double ⌘S adds it once', async () => {
    useActionsSettingsStore.setState({ pendingNew: { draft: { ...blankDraft(), id: 'n1', label: 'New one', actionValue: 'true' }, aiFields: [], fromAi: false } });
    useUIStore.setState({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope: 'pinned', id: 'new' } });
    render(<ActionDetail scope="pinned" id="new" />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    expect(pinnedIds()).toEqual(['a', 'b', 'c', 'n1']);
    expect(useUIStore.getState().actionsRoute).toEqual({ scope: 'pinned', id: 'n1' });
    expect(screen.queryByText('Unsaved changes', { selector: 'h2' })).toBeNull();
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

describe('ActionDetail keyboard', () => {
  const pressSave = async (target: Window | Element = window, extra: Partial<KeyboardEventInit> = {}) => {
    await act(async () => {
      fireEvent.keyDown(target, { key: 's', metaKey: true, ...extra });
    });
  };

  it('leaves Esc and ⌘S to a floating terminal stacked over the screen', async () => {
    useUIStore.setState({ actionsRoute: { scope: 'pinned', id: 'a' } });
    render(
      <>
        <ActionDetail scope="pinned" id="a" />
        <div data-floating-panel><textarea aria-label="xterm" /></div>
      </>,
    );
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    const xterm = screen.getByLabelText('xterm');
    xterm.focus();
    fireEvent.keyDown(xterm, { key: 'Escape' });
    expect(document.activeElement).toBe(xterm);
    await pressSave(xterm);
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('A');
  });

  it('ignores ⌘S and Esc while a modal is open on top', async () => {
    useUIStore.setState({ actionsRoute: { scope: 'pinned', id: 'a' } });
    const { rerender } = render(<><ActionDetail scope="pinned" id="a" /><div data-overlay-top /></>);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    await pressSave();
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('A');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Unsaved changes', { selector: 'h2' })).toBeNull();

    rerender(<ActionDetail scope="pinned" id="a" />);
    await pressSave();
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('Renamed');
  });

  it('ignores auto-repeat of a held ⌘S', async () => {
    render(<ActionDetail scope="pinned" id="a" />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    await pressSave(window, { repeat: true });
    expect(useSettingsStore.getState().settings.pinnedIcons[0]!.label).toBe('A');
  });
});

describe('ActionDetail Try', () => {
  const ticket = { id: 'abc123', title: 'Some ticket', displayId: 7 } as unknown as ReturnType<typeof useTicketStore.getState>['tickets'][number];

  beforeEach(() => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, basePath: '/base', workspaceActions: [{ id: 'w', icon: '', iconType: 'svg', label: 'Open', actionType: 'shell', actionValue: 'ls {{workspace_path}}' }] } });
    useTicketStore.setState({ tickets: [ticket], selectedTicketId: 'abc123' });
    useWorkStore.setState({ selectedTicketId: null });
  });
  afterEach(() => useTicketStore.setState({ tickets: [], selectedTicketId: null }));

  it('materializes the ticket workspace before running a ticket action, like the real click', async () => {
    render(<ActionDetail scope="ticket" id="w" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '▶ Try' }));
    });
    expect(api.ensureTicketWorkspace).toHaveBeenCalledWith('abc123');
    expect(vi.mocked(api.ensureTicketWorkspace).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.startActionRun).mock.invocationCallOrder[0]!);
    expect(api.startActionRun).toHaveBeenCalledWith(expect.objectContaining({ cwd: expect.stringContaining('/base/workspaces/abc123') }));
  });

  it('omits cwd when the workspace could not be created', async () => {
    vi.mocked(api.ensureTicketWorkspace).mockResolvedValueOnce(false);
    render(<ActionDetail scope="ticket" id="w" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '▶ Try' }));
    });
    expect(vi.mocked(api.startActionRun).mock.calls[0]![0]).not.toHaveProperty('cwd');
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

describe('ActionDetail · Test the probe', () => {
  it('blames the probe, not the tool, when its own program is not found (exit 127)', async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [icon('a', { status: { command: 'gcloudd auth print-access-token', intervalSec: 60 } })] } });
    vi.mocked(api.testPinnedProbe).mockResolvedValue({
      snapshot: { iconId: 'a', status: 'ko', probing: false }, source: 'exit-code', stdout: '', stderr: 'zsh:1: command not found: gcloudd', exitCode: 127,
    });
    render(<ActionDetail scope="pinned" id="a" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Test the probe' })); });
    expect(screen.getByRole('note', { name: 'Command not found: gcloudd' })).toBeTruthy();
  });
});
