import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { actionName, incompleteLine, scriptOf, scriptOutcomes, scriptPlate, scriptSummary, targetName } from './script';
import { NamedActionsSettings, RepoNamedActions } from './NamedActions';
import { specFor } from './layoutOps';
import { useFactoryStore } from './factoryStore';
import { useSettingsStore } from '../stores/settingsStore';

describe('a script station, in words', () => {
  it('says what it runs in a line, and line by line on its plate', () => {
    expect(scriptSummary(undefined)).toBe('nothing to run yet');
    expect(scriptSummary({ action: 'test', lines: [], missing: 'ignore', onFail: 'all' })).toBe('default "test"');
    const s = { action: 'test', missing: 'own' as const, onFail: 'all' as const, lines: [{ target: '*', kind: 'command' as const, value: 'git status' }, { target: 'acme/front', kind: 'action' as const, value: 'lint' }, { target: 'workspace', kind: 'command' as const, value: 'open http://localhost:3000/a/very/long/address/indeed' }] };
    expect(scriptSummary(s)).toBe('default "test" + 3 lines');
    const plate = scriptPlate(s);
    expect([plate[0], plate[1], plate[3], plate[4]]).toEqual(['any repository $ git status', 'front $ action lint', 'others $ action test', 'no command: unconfigured']);
    expect(plate[2]).toMatch(/^workspace \$ open http:\/\/localhost:3000.*…$/);                // a long command is cut, and says so
    expect(plate[2]!.length).toBeLessThan(60);
    expect(scriptPlate(undefined)).toEqual(['nothing to run yet', 'no command: skipped']);
  });
  it('has "unconfigured" as a way out only when asked, and names its targets', () => {
    expect(scriptOutcomes(scriptOf(undefined))).toEqual(['ok', 'ko']);
    expect(scriptOutcomes({ lines: [], missing: 'own', onFail: 'all' })).toEqual(['ok', 'ko', 'unconfigured']);
    expect([targetName('*'), targetName('workspace'), targetName('acme/api')]).toEqual(['any repository', 'workspace', 'acme/api']);
    expect(incompleteLine({ target: '*', kind: 'command', value: ' ' })).toBe(true);
    expect(specFor('script', 5, 5, 0)).toMatchObject({ kind: 'station', exec: 'script', outcomes: ['ok', 'ko'], script: { lines: [], missing: 'ignore' } });
  });
  it('an action has a plain name', () => {
    expect(actionName('  Run Tests! ')).toBe('run-tests');
    expect(actionName('e2e_fast')).toBe('e2e_fast');
    expect(actionName('***')).toBe('');
  });
});

describe('named actions', () => {
  const saveSettings = vi.fn(async () => {}), setRepoConfig = vi.fn();
  const seed = (namedActions: { name: string; description?: string }[], enabled = true) => {
    useFactoryStore.setState({ enabled });
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, namedActions, repoConfigs: { 'acme/api': { hookTimeoutSeconds: 90, actions: { test: 'make test' } } } }, saveSettings, setRepoConfig }) as never);
  };
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { cleanup(); });

  it('are listed in Settings, where one is added by name and removed', () => {
    seed([{ name: 'test', description: 'Run the tests' }]);
    render(<NamedActionsSettings />);
    const group = screen.getByRole('group', { name: 'Named actions' });
    expect(group.textContent).toContain('test');
    const name = screen.getByLabelText('Name of a new action');
    fireEvent.change(name, { target: { value: 'Test' } });
    expect((screen.getByRole('button', { name: 'Add an action' }) as HTMLButtonElement).disabled).toBe(true);     // there is one by that name
    fireEvent.change(name, { target: { value: 'Lint all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an action' }));
    expect(saveSettings).toHaveBeenLastCalledWith({ namedActions: [{ name: 'test', description: 'Run the tests' }, { name: 'lint-all' }] });
    fireEvent.click(within(group).getByRole('button', { name: 'Remove the action test' }));
    expect(saveSettings).toHaveBeenLastCalledWith({ namedActions: [] });
  });

  it('are filled in repository by repository, and what the repository already had is kept', () => {
    seed([{ name: 'test' }, { name: 'lint', description: 'Static checks' }]);
    render(<RepoNamedActions org="acme" name="api" />);
    const group = screen.getByRole('group', { name: 'Named actions of this repository' }), fields = within(group).getAllByRole('textbox') as HTMLInputElement[];
    expect(fields.map((f) => f.value)).toEqual(['make test', '']);
    fireEvent.change(fields[1]!, { target: { value: ' make lint ' } }); fireEvent.blur(fields[1]!);
    expect(setRepoConfig).toHaveBeenLastCalledWith('acme', 'api', { hookTimeoutSeconds: 90, actions: { test: 'make test', lint: 'make lint' } });
    fireEvent.change(fields[0]!, { target: { value: '' } }); fireEvent.blur(fields[0]!);
    expect(setRepoConfig).toHaveBeenLastCalledWith('acme', 'api', { hookTimeoutSeconds: 90, actions: {} });       // emptied: this repository does not have it
  });

  it('show nothing while the Factory is off', () => {
    seed([{ name: 'test' }], false);
    const { container } = render(<><NamedActionsSettings /><RepoNamedActions org="acme" name="api" /></>);
    expect(container.textContent).toBe('');
  });
});

describe('what a script station runs, in words', () => {
  it('says what runs on a ticket and on an item: an item has no repository, only the workspace lines run for it', async () => {
    const { whatRuns } = await import('./script');
    expect(whatRuns({ lines: [], missing: 'ignore', onFail: 'all' })).toEqual({ ticket: [], item: [] });
    expect(whatRuns({ action: 'test', lines: [{ target: '*', kind: 'command', value: 'make lint' }, { target: 'workspace', kind: 'command', value: 'gog gmail archive "$FLEEX_ITEM_KEY"' }, { target: 'acme/api', kind: 'action', value: 'build' }, { target: 'acme/front', kind: 'command', value: '' }], missing: 'ignore', onFail: 'all' })).toEqual({
      ticket: ['in each repository: make lint', 'in its workspace: gog gmail archive "$FLEEX_ITEM_KEY"', 'in acme/api: the action "build"', 'in every other repository: the action "test"'],
      item: ['in its folder: gog gmail archive "$FLEEX_ITEM_KEY"'],
    });
  });
});
