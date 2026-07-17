import { describe, it, expect } from 'vitest';
import type {
  SkillLeaderboardEntry,
  WorkflowLeaderboardEntry,
  PanelLeaderboardEntry,
} from '@fleex/shared';
import { buildFrequentItems, type FrequentSource } from './frequentLaunchStore';

/**
 * These tests pin the *intent* of the "Fréquents" zone: it must reflect real
 * usage stats (runs), merge the three launchable types, exclude anything the
 * user can no longer launch (disabled/deleted), never surface Personas, and be
 * bounded to a short top list. A test that passed on a naive concat would defeat
 * the purpose, so each asserts the ordering / filtering the user actually sees.
 */

function skillEntry(skillId: string, executionCount: number): SkillLeaderboardEntry {
  return { skillId, skillName: skillId, skillDisplayName: skillId, executionCount, completedCount: executionCount, failedCount: 0 };
}
function workflowEntry(workflowId: string, executionCount: number): WorkflowLeaderboardEntry {
  return { workflowId, workflowName: workflowId, workflowDisplayName: workflowId, executionCount, completedCount: executionCount, failedCount: 0, avgDurationMs: null };
}
function panelEntry(panelId: string, executionCount: number): PanelLeaderboardEntry {
  return { panelId, panelName: panelId, panelDisplayName: panelId, executionCount, completedCount: executionCount, failedCount: 0, avgDurationMs: null, avgRespondedMembers: null };
}

const source: FrequentSource = {
  skills: [
    { id: 'sk1', displayName: 'Prepare', commandName: 'prepare' },
    { id: 'sk2', displayName: 'Playground', commandName: 'playground' },
  ],
  templates: [
    { id: 'wf1', name: 'PR Review', slug: 'pr-review', emoji: '🚦' },
  ],
  panels: [
    { id: 'pn1', displayName: 'Archi Committee', name: 'archi-committee' },
  ],
};

describe('buildFrequentItems', () => {
  it('merges the three leaderboards and sorts by execution count descending', () => {
    const items = buildFrequentItems(
      {
        skillLeaderboard: [skillEntry('sk1', 3), skillEntry('sk2', 9)],
        workflowLeaderboard: [workflowEntry('wf1', 12)],
        panelLeaderboard: [panelEntry('pn1', 6)],
      },
      source,
    );

    expect(items.map((i) => i.id)).toEqual(['wf1', 'sk2', 'pn1', 'sk1']);
    expect(items.map((i) => i.type)).toEqual(['workflow', 'skill', 'panel', 'skill']);
  });

  it('builds the real @mention invocation token per type (what a comment would contain)', () => {
    const items = buildFrequentItems(
      {
        skillLeaderboard: [skillEntry('sk1', 3)],
        workflowLeaderboard: [workflowEntry('wf1', 2)],
        panelLeaderboard: [panelEntry('pn1', 1)],
      },
      source,
    );
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    // Tokens mirror the server-side mention syntax (ticket-comment.entity.ts):
    // @skill:commandName / @workflow:slug / @panel:name — NOT slash commands.
    expect(byId['sk1']!.token).toBe('@skill:prepare');
    expect(byId['sk1']!.displayName).toBe('Prepare');
    expect(byId['wf1']!.token).toBe('@workflow:pr-review');
    expect(byId['pn1']!.token).toBe('@panel:archi-committee');
  });

  it('excludes items that are no longer present/enabled in the source', () => {
    const items = buildFrequentItems(
      {
        skillLeaderboard: [skillEntry('sk1', 5), skillEntry('ghost', 99)],
        workflowLeaderboard: [],
        panelLeaderboard: [],
      },
      source,
    );
    expect(items.map((i) => i.id)).toEqual(['sk1']);
  });

  it('excludes items with zero runs (never launched is not "frequent")', () => {
    const items = buildFrequentItems(
      {
        skillLeaderboard: [skillEntry('sk1', 0)],
        workflowLeaderboard: [workflowEntry('wf1', 4)],
        panelLeaderboard: [],
      },
      source,
    );
    expect(items.map((i) => i.id)).toEqual(['wf1']);
  });

  it('caps the list to the requested limit', () => {
    const items = buildFrequentItems(
      {
        skillLeaderboard: [skillEntry('sk1', 1), skillEntry('sk2', 2)],
        workflowLeaderboard: [workflowEntry('wf1', 3)],
        panelLeaderboard: [panelEntry('pn1', 4)],
      },
      source,
      2,
    );
    expect(items.map((i) => i.id)).toEqual(['pn1', 'wf1']);
  });

  it('returns an empty list when there are no stats', () => {
    expect(buildFrequentItems(null, source)).toEqual([]);
  });
});
