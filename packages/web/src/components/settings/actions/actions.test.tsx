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
  suggestActionCommand: vi.fn(),
}));

const icon = (id: string, extra: Partial<PinnedIcon> = {}): PinnedIcon => ({
  id, icon: '', iconType: 'svg', label: id.toUpperCase(), actionType: 'shell', actionValue: `echo ${id}`, ...extra,
});

const pinnedIds = () => useSettingsStore.getState().settings.pinnedIcons.map((i) => i.id);

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [icon('a'), icon('b'), icon('c')], workspaceActions: [] } });
  usePinnedActionsStore.setState({ statuses: {}, runs: {}, running: {}, logs: null, terminals: [], activeTerminal: null });
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

describe('ActionDetail · menu commands vs left click', () => {
  const k9s = (extra: Partial<PinnedIcon> = {}) => icon('k9s', {
    actionValue: 'k9s',
    status: { command: 'true', intervalSec: 60 },
    conditionalActions: [
      { id: 'stg', label: 'k9s staging', when: ['ok'], actionType: 'shell', actionValue: 'k9s --context staging' },
      { id: 'prd', label: 'k9s production', when: ['ok'], actionType: 'shell', actionValue: 'k9s --context production' },
    ],
    ...extra,
  });
  const save = async () => act(async () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });
  const stored = () => useSettingsStore.getState().settings.pinnedIcons[0]!;

  it('a legacy action shows its current left click per status, and picking one saves it apart from the menu filters', async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [k9s()] } });
    render(<ActionDetail scope="pinned" id="k9s" />);
    // Today: OK → the first rule offered in OK.
    expect((screen.getByLabelText('Left click when OK') as HTMLSelectElement).value).toBe('stg');
    expect((screen.getByLabelText('Left click when KO') as HTMLSelectElement).value).toBe('main');

    fireEvent.change(screen.getByLabelText('Left click when OK'), { target: { value: 'main' } });
    fireEvent.change(screen.getByLabelText('Left click when Unknown'), { target: { value: 'menu' } });
    await save();
    expect(stored().clickByStatus).toEqual({ ok: 'main', warn: 'main', ko: 'main', unknown: 'menu' });
    // The menu filters are untouched.
    expect(stored().conditionalActions!.map((r) => r.when)).toEqual([['ok'], ['ok']]);
  });

  it('changing a legacy menu filter does not move the left click', async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [k9s()] } });
    render(<ActionDetail scope="pinned" id="k9s" />);
    // Offer "k9s staging" in KO too: before, that would also have made it the KO left click.
    fireEvent.click(screen.getAllByRole('button', { name: /KO/, pressed: false })[0]!);
    await save();
    expect(stored().conditionalActions![0]!.when).toEqual(['ok', 'ko']);
    expect(stored().clickByStatus).toMatchObject({ ok: 'stg', ko: 'main' });
  });

  it('other commands are available without a probe (menu only, no per-status click)', () => {
    render(<ActionDetail scope="pinned" id="a" />);
    expect(screen.getByRole('button', { name: '+ Command' })).toBeTruthy();
    expect(screen.queryByLabelText('Left click when OK')).toBeNull();
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
  it('drops probe and commands from a ticket action; without a probe keeps the menu commands but no per-status click', () => {
    const d = { ...blankDraft(), label: 'x', actionValue: 'y', status: { command: 'true', intervalSec: 60 }, conditionalActions: [] };
    expect(normaliseDraft(d, 'ticket')).not.toHaveProperty('status');
    const noProbe = normaliseDraft({ ...d, status: undefined, clickByStatus: { ok: 'r' }, conditionalActions: [{ id: 'r', label: '', when: ['ok'], actionType: 'shell', actionValue: 'z' }] }, 'pinned') as PinnedIcon;
    expect(noProbe.conditionalActions).toHaveLength(1);
    expect(noProbe).not.toHaveProperty('clickByStatus');
  });

  it('forgets a per-status click that points at a deleted command', () => {
    const d = { ...blankDraft(), label: 'x', actionValue: 'y', status: { command: 'true', intervalSec: 60 }, clickByStatus: { ok: 'gone', ko: 'menu', warn: 'main' } };
    expect((normaliseDraft(d, 'pinned') as PinnedIcon).clickByStatus).toEqual({ ko: 'menu', warn: 'main' });
  });

  it('requires a command on each other command (a menu filter is optional), and an http(s) URL', () => {
    const d = { ...blankDraft(), label: 'x', actionValue: 'y', status: { command: 'true', intervalSec: 60 }, conditionalActions: [{ id: 'r', label: '', when: [], actionType: 'shell' as const, actionValue: '' }] };
    expect(validateDraft(d, 'pinned')).toHaveProperty('rule:0');
    expect(validateDraft({ ...d, conditionalActions: [{ id: 'r', label: '', when: [], actionType: 'shell' as const, actionValue: 'k9s' }] }, 'pinned')).not.toHaveProperty('rule:0');
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

describe('Settings › Actions — run mode', () => {
  it('without tmux on the machine, Terminal cannot be picked and says why (it would only fail at run time)', () => {
    usePinnedActionsStore.setState({ capabilities: { liveOutput: true, terminal: false } });
    render(<ActionDetail scope="pinned" id="a" />);
    const terminal = within(screen.getByRole('radiogroup', { name: 'Run mode' })).getByRole('radio', { name: 'Terminal' }) as HTMLButtonElement;
    expect(terminal.disabled).toBe(true);
    expect(terminal.title).toMatch(/needs tmux/);
    usePinnedActionsStore.setState({ capabilities: null });
  });

  it('the Background | Terminal segmented sets runMode, swaps the environment line and hides the timeout', async () => {
    render(<ActionDetail scope="pinned" id="a" />);
    expect(screen.getByTestId('run-environment').textContent).toBe('zsh -l · no TTY · .zshrc not loaded · timeout 300 s');
    expect(screen.getByLabelText('Action timeout (s)')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Run mode' })).getByRole('radio', { name: 'Terminal' }));
    expect(screen.getByTestId('run-environment').textContent).toBe('zsh -l -i · TTY · .zshrc loaded · no timeout');
    expect(screen.queryByLabelText('Action timeout (s)')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Close automatically on success/ }));

    await act(async () => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    expect(useSettingsStore.getState().settings.pinnedIcons[0]).toMatchObject({ id: 'a', runMode: 'terminal', closeTerminalOnSuccess: true });
  });

  it('only offers the run mode for a command, not a URL', () => {
    render(<ActionDetail scope="pinned" id="a" />);
    fireEvent.click(screen.getByRole('radio', { name: 'URL' }));
    expect(screen.queryByRole('radiogroup', { name: 'Run mode' })).toBeNull();
  });

  it('"Try" in terminal mode runs the draft in a terminal and opens the panel', async () => {
    vi.mocked(api.startActionRun).mockResolvedValueOnce({ runId: 'd1', alreadyRunning: false });
    render(<ActionDetail scope="pinned" id="a" />);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Run mode' })).getByRole('radio', { name: 'Terminal' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '▶ Try' }));
    });
    expect(api.startActionRun).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'draft:a', mode: 'terminal', command: 'echo a' }));
    expect(usePinnedActionsStore.getState().terminals).toMatchObject([{ sourceId: 'draft:a', runId: 'd1' }]);
  });

  it('a rule gets its own segmented, inheriting the action mode until set', async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        pinnedIcons: [icon('kp', {
          status: { command: 'true', intervalSec: 60 },
          conditionalActions: [{ id: 'r', label: 'Log out', when: ['ok'], actionType: 'shell', actionValue: 'platool logout' }],
        })],
      },
    });
    render(<ActionDetail scope="pinned" id="kp" />);
    const ruleMode = within(screen.getByRole('radiogroup', { name: 'Rule 1 run mode' }));
    expect(ruleMode.getByRole('radio', { name: 'Background' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(ruleMode.getByRole('radio', { name: 'Terminal' }));
    await act(async () => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    const saved = useSettingsStore.getState().settings.pinnedIcons[0]!;
    expect(saved.conditionalActions![0]!.runMode).toBe('terminal');
    expect(saved.runMode).toBeUndefined();
  });

  it('applying an AI suggestion for an interactive command also switches the action to Terminal', async () => {
    useActionsSettingsStore.setState({ aiAvailable: true });
    vi.mocked(api.suggestActionCommand).mockResolvedValueOnce({ command: 'docker run -it alpine sh', explanation: 'A shell.', risk: 'safe', binaries: [], runMode: 'terminal' });
    render(<ActionDetail scope="pinned" id="a" />);
    const input = screen.getByLabelText(/Describe what the command should do/);
    fireEvent.change(input, { target: { value: 'open a shell in alpine' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText(/Run it in a terminal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(within(screen.getByRole('radiogroup', { name: 'Run mode' })).getByRole('radio', { name: 'Terminal' }).getAttribute('aria-checked')).toBe('true');
  });

  it('the preview tooltip and the list row say the action runs in a terminal', () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [icon('a', { runMode: 'terminal' }), icon('b')] } });
    const { unmount } = render(<ActionDetail scope="pinned" id="a" />);
    expect(screen.getByRole('complementary', { name: 'Preview' }).textContent).toContain('Click: echo a · ⧉ terminal');
    unmount();
    render(<ActionList scope="pinned" />);
    expect(within(screen.getByRole('listitem', { name: 'A' })).getByText('⧉ terminal')).toBeTruthy();
    expect(within(screen.getByRole('listitem', { name: 'B' })).queryByText('⧉ terminal')).toBeNull();
  });

  it('the alias warning under the command offers to switch the action to Terminal', async () => {
    vi.mocked(api.diagnoseBinary).mockResolvedValue({ binary: 'platool', login: 'missing', interactive: 'alias', aliasDefinition: 'docker run -it platool' });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [icon('a', { actionValue: 'platool login' })] } });
    render(<ActionDetail scope="pinned" id="a" />);
    const button = await screen.findByRole('button', { name: 'Run in terminal mode' }, { timeout: 2000 });
    fireEvent.click(button);
    expect(within(screen.getByRole('radiogroup', { name: 'Run mode' })).getByRole('radio', { name: 'Terminal' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Run in terminal mode' })).toBeNull();
  });

  it('normalise keeps runMode / closeTerminalOnSuccess for a terminal command and drops them otherwise', () => {
    const terminal = { ...icon('t'), runMode: 'terminal' as const, closeTerminalOnSuccess: true };
    expect(normaliseDraft(terminal, 'pinned')).toMatchObject({ runMode: 'terminal', closeTerminalOnSuccess: true });
    expect(normaliseDraft(terminal, 'ticket')).toMatchObject({ runMode: 'terminal', closeTerminalOnSuccess: true });
    const url = normaliseDraft({ ...terminal, actionType: 'url', actionValue: 'https://x.dev' }, 'pinned');
    expect(url).not.toHaveProperty('runMode');
    expect(url).not.toHaveProperty('closeTerminalOnSuccess');
    expect(normaliseDraft({ ...icon('b'), runMode: 'background', closeTerminalOnSuccess: true }, 'pinned')).not.toHaveProperty('closeTerminalOnSuccess');
  });
});
