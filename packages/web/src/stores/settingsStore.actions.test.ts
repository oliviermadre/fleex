import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ActionDef, WorkspaceContext } from '@fleex/shared';
import { migrateActionsConfig } from '@fleex/shared';
import { useSettingsStore, globalActions, workspaceActions } from './settingsStore';
import { STORAGE_KEY_SETTINGS } from '../lib/constants';

const context: WorkspaceContext = {
  workspace_path: '/base/workspaces/abc123-fix-login',
  workspace_name: 'abc123-fix-login',
  ticket_id: 'ticket-uuid-1',
  ticket_slug: 'fix-login',
  ticket_display_id: '42',
};

function action(overrides: Partial<ActionDef> & Pick<ActionDef, 'id' | 'kind'>): ActionDef {
  return {
    label: overrides.id,
    scope: 'global',
    icon: '',
    iconType: 'svg',
    ...overrides,
  } as ActionDef;
}

describe('settingsStore — action registry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  describe('executeAction', () => {
    it('posts only the action id and ticket id — never anything executable', () => {
      // The whole point of replacing POST /api/exec: what leaves the browser must
      // not be able to express *what* runs, only *which declared action* runs.
      // If this ever regresses, the server is back to trusting client input.
      const def = action({ id: 'open-editor', kind: 'exec', scope: 'workspace' });

      useSettingsStore.getState().executeAction(def, context);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/actions/open-editor/run');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body);
      expect(body).toEqual({ ticketId: 'ticket-uuid-1' });
      // No command, no script, no resolved path: nothing the server could execute.
      expect(Object.keys(body)).not.toContain('command');
      expect(JSON.stringify(body)).not.toContain(context.workspace_path);
    });

    it('percent-encodes the id so it cannot escape the route path', () => {
      useSettingsStore.getState().executeAction(action({ id: 'a/../b', kind: 'exec' }));

      expect(fetchMock.mock.calls[0]![0]).toBe('/api/actions/a%2F..%2Fb/run');
    });

    it('omits ticketId for a global action run without context', () => {
      useSettingsStore.getState().executeAction(action({ id: 'open-docs', kind: 'shell' }));

      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({});
    });

    it('opens kind=url client-side with the template resolved, without touching the server', () => {
      // A navigation has no reason to transit through the server.
      const def = action({
        id: 'linear',
        kind: 'url',
        scope: 'workspace',
        url: 'https://example.com/{{ ticket_slug }}',
      });

      useSettingsStore.getState().executeAction(def, context);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(window.open).toHaveBeenCalledWith('https://example.com/fix-login', '_blank');
    });
  });

  describe('scope selectors', () => {
    it('splits the single registry by scope and hides disabled entries', () => {
      // The two former arrays (pinnedIcons / workspaceActions) are now one list;
      // the rendering sites rely on these selectors to keep their placement.
      const actions = [
        action({ id: 'g1', kind: 'exec' }),
        action({ id: 'w1', kind: 'exec', scope: 'workspace' }),
        action({ id: 'g2', kind: 'exec', enabled: false }),
      ];

      expect(globalActions(actions).map((a) => a.id)).toEqual(['g1']);
      expect(workspaceActions(actions).map((a) => a.id)).toEqual(['w1']);
    });
  });

  describe('localStorage migration', () => {
    it('folds a pre-registry cached blob so pinned actions survive a reload', () => {
      // loadFromStorage() runs before the server config comes back. Without the
      // migration the user briefly loses every pinned icon on refresh.
      const cached = {
        basePath: '/base',
        pinnedIcons: [
          { id: 'p1', label: 'Docs', icon: '', iconType: 'svg', actionType: 'url', actionValue: 'https://docs.example' },
        ],
        workspaceActions: [
          { id: 'w1', label: 'Editor', icon: '', iconType: 'svg', actionType: 'shell', actionValue: 'code {{workspace_path}}' },
        ],
      };
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(cached));

      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS)!);
      expect(migrateActionsConfig(parsed)).toBe(true);

      const actions = parsed.actions as ActionDef[];
      expect(actions.map((a) => a.id)).toEqual(['p1', 'w1']);
      expect(actions[0]).toMatchObject({ scope: 'global', kind: 'url', url: 'https://docs.example' });
      expect(actions[1]).toMatchObject({
        scope: 'workspace',
        kind: 'exec',
        command: 'code',
        args: ['{{workspace_path}}'],
      });
      expect(parsed.pinnedIcons).toBeUndefined();
      expect(parsed.workspaceActions).toBeUndefined();
      // Unrelated settings are left alone.
      expect(parsed.basePath).toBe('/base');
    });

    it('leaves an already-migrated blob untouched', () => {
      const cached = { actions: [action({ id: 'g1', kind: 'exec' })] };

      expect(migrateActionsConfig(cached)).toBe(false);
      expect(cached.actions).toHaveLength(1);
    });
  });
});
