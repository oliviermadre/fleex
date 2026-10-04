import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setConfigKey, type WorktreeConfig, type WorktreeSettingsResponse } from '@fleex/shared';
import * as api from '../../../services/api';
import { RepoActionsSettings } from './RepoActionsSettings';

const PATH = '/base/workspaces/775c62/fleex';
const REPO = 'oliviermadre/fleex';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  fetchWorktrees: vi.fn(),
  fetchWorktreeSettings: vi.fn(),
  setWorktreeConfigKey: vi.fn(),
  shareWorktreeKeys: vi.fn(),
  unshareWorktreeKeys: vi.fn(),
  testPinnedProbe: vi.fn(),
  runWorktreeHook: vi.fn(async () => ({ runId: 'r1', server: { path: PATH, state: 'stopped', updatedAt: '' } })),
}));

/** A tiny in-memory server: both layers, recomputed settings on every write. */
function fakeServer(personal: WorktreeConfig, shared: WorktreeConfig | null) {
  const state = { personal, shared };
  const settings = (): WorktreeSettingsResponse => ({
    repo: REPO,
    path: PATH,
    personal: state.personal,
    shared: state.shared,
    view: {
      path: PATH,
      repo: REPO,
      branch: 'ticket/775c62',
      items: [
        { id: 'launch:web', source: 'launch', layer: 'launch', label: 'web', command: 'pnpm dev', mode: 'terminal', port: 5173, pinned: false },
        { id: 'npm:test', source: 'npm', layer: 'detected', label: 'test', command: 'pnpm run test', mode: 'terminal', pinned: (state.personal.pins ?? []).includes('npm:test') },
        ...(state.personal.actions ?? []).map((a) => ({ id: a.id, source: 'action' as const, layer: 'personal' as const, label: a.label ?? a.id, command: a.cmd, mode: a.mode ?? 'background' as const, pinned: false })),
        ...(state.shared?.actions ?? []).map((a) => ({ id: a.id, source: 'action' as const, layer: 'shared' as const, label: a.label ?? a.id, command: a.cmd, mode: a.mode ?? 'background' as const, pinned: false })),
      ],
      start: null,
      clickByState: { stopped: 'start', starting: 'logs', running: 'open', error: 'logs' },
      server: { path: PATH, state: 'stopped', updatedAt: '' },
    },
    overlayFiles: ['.env'],
    fileHooks: { global: [], repo: ['/base/overlays/oliviermadre/fleex/hooks/10-deps.sh'] },
    hooksDir: '/base/overlays/oliviermadre/fleex/hooks',
    hookTimeoutSeconds: 60,
  });
  vi.mocked(api.fetchWorktreeSettings).mockImplementation(async () => settings());
  vi.mocked(api.setWorktreeConfigKey).mockImplementation(async (_repo, _path, layer, key, value) => {
    if (layer === 'personal') state.personal = setConfigKey(state.personal, key, value);
    else state.shared = setConfigKey(state.shared, key, value);
    return settings();
  });
  vi.mocked(api.shareWorktreeKeys).mockImplementation(async (_path, keys) => {
    for (const k of keys) {
      const v = k.startsWith('action:') ? state.personal.actions?.find((a) => `action:${a.id}` === k) : (state.personal.hooks as Record<string, unknown> | undefined)?.[k.split('.')[1]!];
      state.shared = setConfigKey(state.shared, k, v);
      state.personal = setConfigKey(state.personal, k, undefined);
    }
    return { moved: keys, file: `${PATH}/.fleex/worktree.json`, settings: settings() };
  });
  vi.mocked(api.unshareWorktreeKeys).mockImplementation(async (_path, keys, removeFromFile) => {
    for (const k of keys) {
      const v = (state.shared?.hooks as Record<string, unknown> | undefined)?.[k.split('.')[1]!];
      state.personal = setConfigKey(state.personal, k, v);
      if (removeFromFile) state.shared = setConfigKey(state.shared, k, undefined);
    }
    return { moved: keys, settings: settings() };
  });
  return state;
}

async function renderSettings() {
  render(<MemoryRouter><RepoActionsSettings org="oliviermadre" name="fleex" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('repo-actions-settings')).toBeTruthy());
}

const openStep = (k: 'checkout' | 'server' | 'teardown') => fireEvent.click(screen.getByTestId(`step-${k}`));
const openTab = (k: 'lifecycle' | 'commands' | 'options') => fireEvent.click(screen.getByTestId(`tab-${k}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchWorktrees).mockResolvedValue([{ path: PATH, branch: 'ticket/775c62', isMain: false, isBare: false }]);
});
afterEach(cleanup);

describe('Actions et Hooks — lifecycle', () => {
  it('reads the strip at a glance: configured steps say where they live, empty ones offer to add', async () => {
    // WHY: the hooks used to hide behind a text field; the strip makes each step discoverable.
    fakeServer({ hooks: { setup: 'pnpm i' } }, { hooks: { teardown: 'docker compose down' } });
    await renderSettings();
    // Three moments, in the order they happen: checkout (overlay → file hooks → setup), server, teardown.
    expect(within(screen.getByTestId('step-checkout')).getByText('✓ 1 fichier · hooks fichiers · setup perso')).toBeTruthy();
    expect(within(screen.getByTestId('step-server')).getByText('+ ajouter')).toBeTruthy();
    expect(within(screen.getByTestId('step-teardown')).getByText('✓ teardown partagé')).toBeTruthy();
  });

  it('saves the Setup where it lives (personal) and tests the draft in the current worktree', async () => {
    const state = fakeServer({ hooks: { setup: 'pnpm i' } }, null);
    await renderSettings();
    openStep('checkout');
    const box = screen.getByLabelText('Script Setup');
    fireEvent.change(box, { target: { value: 'pnpm i && make migrate' } });
    expect(screen.getByTestId('step-checkout').querySelector('[title="Modifications non enregistrées"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tester dans le worktree courant/ }));
    await waitFor(() => expect(api.runWorktreeHook).toHaveBeenCalledWith(PATH, 'setup', 'pnpm i && make migrate'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'hooks.setup', 'pnpm i && make migrate');
    expect(state.personal.hooks?.setup).toBe('pnpm i && make migrate');
  });

  it('keeps a draft when switching steps', async () => {
    fakeServer({}, null);
    await renderSettings();
    openStep('checkout');
    fireEvent.change(screen.getByLabelText('Script Setup'), { target: { value: 'make deps' } });
    openStep('teardown');
    openStep('checkout');
    expect((screen.getByLabelText('Script Setup') as HTMLTextAreaElement).value).toBe('make deps');
  });

  it('a shared value is edited in the file; Garder pour moi asks whether to remove it from the file', async () => {
    // WHY (acceptance 9): moving to personal must be explicit about the team's copy.
    const state = fakeServer({}, { hooks: { setup: 'make deps' } });
    await renderSettings();
    openStep('checkout');
    fireEvent.change(screen.getByLabelText('Script Setup'), { target: { value: 'make deps all' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'shared', 'hooks.setup', 'make deps all');
    fireEvent.click(screen.getByRole('button', { name: 'Partagé ⇣' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retirer aussi du fichier' }));
    });
    expect(api.unshareWorktreeKeys).toHaveBeenCalledWith(PATH, ['hooks.setup'], true);
    expect(state.shared).toEqual({});
    expect(state.personal.hooks?.setup).toBe('make deps all');
  });

  it('Partager moves a personal step into .fleex/worktree.json', async () => {
    const state = fakeServer({ hooks: { setup: 'pnpm i' } }, null);
    await renderSettings();
    openStep('checkout');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Perso ⇡' }));
    });
    expect(api.shareWorktreeKeys).toHaveBeenCalledWith(PATH, ['hooks.setup']);
    expect(state.shared?.hooks?.setup).toBe('pnpm i');
  });

  it('sets the start from a detected command, without writing the default left clicks', async () => {
    fakeServer({}, null);
    await renderSettings();
    openStep('server');
    fireEvent.change(screen.getByLabelText('Commande de démarrage'), { target: { value: 'launch:web' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.start', 'launch:web');
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.clickByState', undefined);
    // The mode is written explicitly, foreground by default.
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.mode', 'foreground');
  });

  it('detached: Stop, Status and Logs are asked for, and saved with the mode', async () => {
    // WHY: a start that hands back can't be stopped, watched or tailed by Fleex on its own.
    fakeServer({ server: { start: './cli/fleex start' } }, null);
    await renderSettings();
    openStep('server');
    expect(within(screen.getByTestId('server-row-stop')).queryByText(/Fleex ne sait pas arrêter/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Détaché' }));
    expect(within(screen.getByTestId('server-row-stop')).getByText(/Fleex ne sait pas arrêter/)).toBeTruthy();
    expect(within(screen.getByTestId('server-row-status')).getByText(/sans probe/)).toBeTruthy();
    expect(within(screen.getByTestId('server-row-logs')).getByText(/sans commande de logs/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Commande de logs'), { target: { value: '__custom' } });
    fireEvent.change(screen.getByLabelText('Commande de logs (personnalisée)'), { target: { value: './cli/fleex logs' } });
    fireEvent.change(screen.getByLabelText("Commande d'arrêt"), { target: { value: '__custom' } });
    fireEvent.change(screen.getByLabelText("Commande d'arrêt (personnalisée)"), { target: { value: './cli/fleex stop' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.mode', 'detached');
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.logs', './cli/fleex logs');
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.stop', './cli/fleex stop');
  });

  it('keeps the two axes apart: the mode says where the server lives, each row how its command runs', async () => {
    // WHY: « détaché » is not « sans tty ». A detached Stop must not talk about closing the Start's
    // terminal (it ended long ago), and each command shows whether it gets a terminal.
    fakeServer({ server: { start: './cli/fleex start', stop: './cli/fleex stop', mode: 'detached' } }, null);
    await renderSettings();
    openStep('server');
    expect(screen.getByTestId('server-exec-start').textContent).toBe('terminal');
    expect(screen.getByTestId('server-exec-logs').textContent).toBe('terminal');
    expect(screen.getByTestId('server-exec-stop').textContent).toBe('sans tty');
    expect(screen.getByTestId('server-exec-status').textContent).toBe('sans tty');
    const stopRow = screen.getByTestId('server-row-stop');
    expect(within(stopRow).queryByText(/terminal du Start/)).toBeNull();
    expect(within(stopRow).getByText(/C'est elle qui arrête le serveur/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Premier plan' }));
    expect(within(screen.getByTestId('server-row-stop')).getByText(/arrête la commande Start/)).toBeTruthy();
  });

  it('Logs, Stop and Status pick a command of the repo like Start, saved as its id', async () => {
    // WHY: an action already written ("stop instance") or a detected command must be reusable
    // for every server command, not only Start — no copy of the command to keep in sync.
    fakeServer({ server: { stop: 'docker compose stop' } }, null);
    await renderSettings();
    openStep('server');
    // A saved command that is no id shows as custom, with its text.
    expect((screen.getByLabelText("Commande d'arrêt") as HTMLSelectElement).value).toBe('__custom');
    expect((screen.getByLabelText("Commande d'arrêt (personnalisée)") as HTMLInputElement).value).toBe('docker compose stop');
    fireEvent.change(screen.getByLabelText("Commande d'arrêt"), { target: { value: 'launch:web' } });
    expect(screen.queryByLabelText("Commande d'arrêt (personnalisée)")).toBeNull();
    fireEvent.change(screen.getByLabelText('Commande de logs'), { target: { value: 'launch:web' } });
    fireEvent.change(screen.getByLabelText("Probe d'état"), { target: { value: 'launch:web' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.stop', 'launch:web');
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.logs', 'launch:web');
    expect(api.setWorktreeConfigKey).toHaveBeenCalledWith(REPO, PATH, 'personal', 'server.probe', { command: 'launch:web', intervalSec: 30 });
  });

  it('the teardown moment shows the automatic stop before its script', async () => {
    fakeServer({}, null);
    await renderSettings();
    openStep('teardown');
    expect(screen.getByTestId('teardown-stop').textContent).toMatch(/Stop du serveur/);
    expect(screen.getByLabelText('Script Teardown')).toBeTruthy();
  });
});

describe('Actions et Hooks — probe tester', () => {
  // WHY: the probe has two jobs (exit code = state, stdout = endpoints); the tester
  // must show how Fleex reads it, so a probe can be written against the contract.
  it('reads the stdout like Fleex: the endpoints when it follows the contract', async () => {
    fakeServer({ server: { probe: { command: 'check-up' } } }, null);
    vi.mocked(api.testPinnedProbe).mockResolvedValue({ exitCode: 0, stdout: '{"endpoints":[{"name":"gateway","port":58619},{"name":"web","url":"http://localhost:58621","primary":true}]}', stderr: '' } as Awaited<ReturnType<typeof api.testPinnedProbe>>);
    await renderSettings();
    openStep('server');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '▶ Tester le probe' }));
    });
    expect(screen.getByText(/en marche · 2 endpoints/).textContent).toMatch(/★ web {2}http:\/\/localhost:58621[\s\S]*gateway {2}http:\/\/localhost:58619/);
  });

  it('says when the stdout is ignored', async () => {
    fakeServer({ server: { probe: { command: 'check-up' } } }, null);
    vi.mocked(api.testPinnedProbe).mockResolvedValue({ exitCode: 0, stdout: 'true', stderr: '' } as Awaited<ReturnType<typeof api.testPinnedProbe>>);
    await renderSettings();
    openStep('server');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '▶ Tester le probe' }));
    });
    expect(screen.getByText(/pas d'endpoints dans la sortie/)).toBeTruthy();
  });
});

describe('Actions et Hooks — actions, detected commands, options', () => {
  it('adds an action as personal, with an id from its name', async () => {
    const state = fakeServer({}, null);
    await renderSettings();
    openTab('commands');
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter une action' }));
    const editor = screen.getByTestId('action-editor');
    fireEvent.change(within(editor).getByLabelText('Nom'), { target: { value: 'DB migrate' } });
    fireEvent.change(within(editor).getByLabelText('Commande'), { target: { value: 'make db-migrate' } });
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: 'Ajouter (perso)' }));
    });
    expect(state.personal.actions).toEqual([{ id: 'db-migrate', cmd: 'make db-migrate', mode: 'background', label: 'DB migrate' }]);
    expect(screen.getByTestId('action-row-db-migrate')).toBeTruthy();
  });

  // Same affordance as the pinned/ticket actions list: no edit glyph, the row
  // itself opens the editor; the scope badge and ⋯ must not hijack that click.
  it('opens the editor by clicking the action row, like the pinned actions list', async () => {
    fakeServer({ actions: [{ id: 'migrate', cmd: 'make db-migrate', mode: 'background' }] }, null);
    await renderSettings();
    openTab('commands');
    const row = screen.getByTestId('action-row-migrate');
    expect(row.textContent).not.toContain('✎');
    fireEvent.click(within(row).getByRole('button', { name: "Plus d'actions pour migrate" }));
    expect(screen.queryByTestId('action-editor')).toBeNull();
    fireEvent.click(row);
    expect(within(screen.getByTestId('action-editor')).getByLabelText('Commande')).toHaveProperty('value', 'make db-migrate');
  });

  it('refuses an action without a command', async () => {
    fakeServer({}, null);
    await renderSettings();
    openTab('commands');
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter une action' }));
    fireEvent.click(within(screen.getByTestId('action-editor')).getByRole('button', { name: 'Ajouter (perso)' }));
    expect(screen.getByText(/Il faut une commande/)).toBeTruthy();
    expect(api.setWorktreeConfigKey).not.toHaveBeenCalled();
  });

  it('pins, hides, or makes a detected command the start', async () => {
    const state = fakeServer({}, null);
    await renderSettings();
    openTab('commands');
    const row = screen.getByTestId('detected-npm:test');
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Épingler test' }));
    });
    expect(state.personal.pins).toEqual(['npm:test']);
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('detected-launch:web')).getByText('▶ start'));
    });
    expect(state.personal.server?.start).toBe('launch:web');
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('detected-npm:test')).getByText('masquer'));
    });
    expect(state.personal.discovery?.hide).toEqual(['npm:test']);
  });

  it('one list: the search and source filters apply to actions and detected commands alike', async () => {
    // WHY: the screen shows what the worktree menu offers, and must stay usable with dozens of scripts.
    fakeServer({ actions: [{ id: 'migrate', cmd: 'make db-migrate', mode: 'background' }] }, null);
    await renderSettings();
    openTab('commands');
    fireEvent.change(screen.getByLabelText('Filtrer les commandes'), { target: { value: 'run test' } });
    expect(screen.queryByTestId('action-row-migrate')).toBeNull();
    expect(screen.getByTestId('detected-npm:test')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filtrer les commandes'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Actions/ }));
    expect(screen.getByTestId('action-row-migrate')).toBeTruthy();
    expect(screen.queryByTestId('detected-npm:test')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^npm/ }));
    expect(screen.queryByTestId('action-row-migrate')).toBeNull();
    expect(screen.getByTestId('detected-npm:test')).toBeTruthy();
  });

  it('turns port reservation on with 10 ports by default', async () => {
    const state = fakeServer({}, null);
    await renderSettings();
    openTab('options');
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Réserver des ports' }));
    });
    expect(state.personal.ports).toEqual({ reserve: true, count: 10 });
  });

  it('without a worktree, only the personal layer is editable', async () => {
    vi.mocked(api.fetchWorktrees).mockResolvedValue([]);
    vi.mocked(api.fetchWorktreeSettings).mockResolvedValue({
      repo: REPO, path: null, personal: { hooks: { setup: 'pnpm i' } }, shared: null, overlayFiles: [], fileHooks: { global: [], repo: [] }, hooksDir: '/h', hookTimeoutSeconds: 60,
    });
    await renderSettings();
    expect(screen.getByText(/Aucun worktree/)).toBeTruthy();
    openStep('checkout');
    expect((screen.getByRole('button', { name: 'Perso ⇡' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Tester dans le worktree courant/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
