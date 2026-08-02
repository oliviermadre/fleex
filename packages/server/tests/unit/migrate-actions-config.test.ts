import { describe, it, expect } from 'vitest';
import { migrateActionsConfig } from '@fleex/shared';
import type { ActionDef } from '@fleex/shared';

const pinned = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  icon: '<svg/>',
  iconType: 'svg',
  label: 'Pinned',
  actionType: 'shell',
  actionValue: 'code /tmp',
  ...over,
});

function migrate(data: Record<string, unknown>) {
  const changed = migrateActionsConfig(data);
  return { changed, actions: (data['actions'] ?? []) as ActionDef[] };
}

/**
 * The ticket's second acceptance criterion is "existing pinned actions keep
 * working". These tests encode what "keep working" means concretely: same ids,
 * same order, and an execution that resolves to the same effective command.
 */
describe('migrateActionsConfig', () => {
  it('folds both legacy arrays into one registry, global first', () => {
    const { changed, actions } = migrate({
      pinnedIcons: [pinned({ id: 'g1', label: 'Global' })],
      workspaceActions: [pinned({ id: 'w1', label: 'Workspace' })],
    });

    expect(changed).toBe(true);
    expect(actions.map((a) => [a.id, a.scope])).toEqual([
      ['g1', 'global'],
      ['w1', 'workspace'],
    ]);
  });

  it('preserves ids and order so display position and shortcuts survive', () => {
    const { actions } = migrate({
      pinnedIcons: [pinned({ id: 'a' }), pinned({ id: 'b' }), pinned({ id: 'c' })],
    });
    expect(actions.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops the legacy keys once folded', () => {
    const data: Record<string, unknown> = {
      pinnedIcons: [pinned()],
      workspaceActions: [],
      basePath: '/tmp',
    };
    migrateActionsConfig(data);

    expect(data['pinnedIcons']).toBeUndefined();
    expect(data['workspaceActions']).toBeUndefined();
    expect(data['basePath']).toBe('/tmp'); // untouched
  });

  describe('conversion by action type', () => {
    it('maps a url action to kind=url', () => {
      const { actions } = migrate({
        pinnedIcons: [pinned({ actionType: 'url', actionValue: 'https://linear.app/x' })],
      });
      expect(actions[0]).toMatchObject({ kind: 'url', url: 'https://linear.app/x' });
      expect(actions[0]).not.toHaveProperty('command');
    });

    it('maps a plain command to kind=exec with a split argv', () => {
      const { actions } = migrate({
        workspaceActions: [pinned({ actionValue: 'code {{workspace_path}}' })],
      });
      expect(actions[0]).toMatchObject({
        kind: 'exec',
        command: 'code',
        args: ['{{workspace_path}}'],
      });
    });

    it('keeps a quoted argument whole rather than splitting on its spaces', () => {
      const { actions } = migrate({
        pinnedIcons: [
          pinned({ actionValue: 'open -a "Visual Studio Code" {{workspace_path}}' }),
        ],
      });
      expect(actions[0]).toMatchObject({
        kind: 'exec',
        command: 'open',
        args: ['-a', 'Visual Studio Code', '{{workspace_path}}'],
      });
    });

    it('falls back to kind=shell when the command uses shell features', () => {
      const { actions } = migrate({
        workspaceActions: [
          pinned({ actionValue: 'cd {{workspace_path}} && git status | head -20' }),
        ],
      });
      expect(actions[0]).toMatchObject({
        kind: 'shell',
        script: 'cd "$1" && git status | head -20',
        args: ['{{workspace_path}}'],
      });
      // The dynamic value must never be spliced into the script text itself.
      expect((actions[0] as ActionDef).script).not.toContain('{{');
    });
  });

  it('marks migrated actions enabled and gives them a default timeout', () => {
    const { actions } = migrate({ pinnedIcons: [pinned()] });
    expect(actions[0]).toMatchObject({ enabled: true, timeoutMs: 10_000 });
  });

  it('defaults a missing/unknown iconType to svg', () => {
    const { actions } = migrate({ pinnedIcons: [pinned({ iconType: 'bogus' })] });
    expect(actions[0]!.iconType).toBe('svg');
  });

  it('skips entries with no usable id rather than inventing one', () => {
    const { actions } = migrate({ pinnedIcons: [pinned(), { label: 'no id' }] });
    expect(actions).toHaveLength(1);
  });

  describe('idempotence', () => {
    it('is a no-op on a second pass', () => {
      const data: Record<string, unknown> = { pinnedIcons: [pinned()] };

      expect(migrateActionsConfig(data)).toBe(true);
      const afterFirst = JSON.stringify(data);

      expect(migrateActionsConfig(data)).toBe(false);
      expect(JSON.stringify(data)).toBe(afterFirst);
    });

    it('does not resurrect legacy keys when actions already exist', () => {
      const data: Record<string, unknown> = {
        actions: [{ id: 'kept', kind: 'url' }],
        pinnedIcons: [pinned()],
      };
      expect(migrateActionsConfig(data)).toBe(false);
      expect((data['actions'] as unknown[]).length).toBe(1);
    });
  });

  describe('nothing to migrate', () => {
    it('reports no change for a config without legacy keys', () => {
      const data: Record<string, unknown> = { basePath: '/tmp' };
      expect(migrateActionsConfig(data)).toBe(false);
      expect(data['actions']).toBeUndefined();
    });

    it('still normalises a config with empty legacy arrays', () => {
      const data: Record<string, unknown> = { pinnedIcons: [], workspaceActions: [] };
      expect(migrateActionsConfig(data)).toBe(true);
      expect(data['actions']).toEqual([]);
    });
  });
});
