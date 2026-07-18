import { describe, it, expect } from 'vitest';
import type {
  AgentLeaderboardEntry,
  SkillLeaderboardEntry,
  WorkflowLeaderboardEntry,
  PanelLeaderboardEntry,
} from '@fleex/shared';
import {
  buildFrequentItems,
  buildMostUsedItems,
  type FrequentSource,
} from './frequentLaunchStore';

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
function agentEntry(personaId: string, spawnCount: number): AgentLeaderboardEntry {
  return {
    personaId,
    personaName: personaId,
    personaDisplayName: personaId,
    spawnCount,
    avgDurationMs: null,
    completedCount: spawnCount,
    failedCount: 0,
    totalCostUsd: 0,
    avgCostUsd: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    avgInputTokens: null,
    avgOutputTokens: null,
  };
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
  personas: [
    { id: 'ag1', displayName: 'The Builder' },
    { id: 'ag2', displayName: 'The Catalyst' },
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

/**
 * "Most Used" is the sidebar cousin of Fréquents. Its intent differs on two
 * axes the tests must pin: it INCLUDES Personas (counted by spawn), and its
 * tie-break is deterministic (Personas > Skills > Panels > Workflows, then
 * alphabetical) so the top list never flickers between renders. Everything else
 * (usage sort, zero/unresolved filtering, cap) mirrors Fréquents.
 */
describe('buildMostUsedItems', () => {
  it('merges all four leaderboards (personas included) and sorts by usage descending', () => {
    const items = buildMostUsedItems(
      {
        agentLeaderboard: [agentEntry('ag1', 7)],
        skillLeaderboard: [skillEntry('sk2', 9)],
        workflowLeaderboard: [workflowEntry('wf1', 12)],
        panelLeaderboard: [panelEntry('pn1', 6)],
      },
      source,
    );
    expect(items.map((i) => i.id)).toEqual(['wf1', 'sk2', 'ag1', 'pn1']);
    expect(items.map((i) => i.kind)).toEqual(['workflow', 'skill', 'persona', 'panel']);
    expect(items.map((i) => i.usageCount)).toEqual([12, 9, 7, 6]);
  });

  it('counts personas by spawnCount and resolves display names from the source', () => {
    const items = buildMostUsedItems(
      {
        agentLeaderboard: [agentEntry('ag1', 4)],
        skillLeaderboard: [],
        workflowLeaderboard: [],
        panelLeaderboard: [],
      },
      source,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'persona', id: 'ag1', displayName: 'The Builder', usageCount: 4 });
  });

  it('breaks ties by kind order then alphabetically', () => {
    // All four share usageCount=5 → kind order must decide: persona, skill, panel, workflow.
    const items = buildMostUsedItems(
      {
        agentLeaderboard: [agentEntry('ag1', 5)],
        skillLeaderboard: [skillEntry('sk1', 5)],
        workflowLeaderboard: [workflowEntry('wf1', 5)],
        panelLeaderboard: [panelEntry('pn1', 5)],
      },
      source,
    );
    expect(items.map((i) => i.kind)).toEqual(['persona', 'skill', 'panel', 'workflow']);
  });

  it('breaks same-kind, same-usage ties alphabetically by display name', () => {
    // ag2 "The Catalyst" vs ag1 "The Builder": equal spawns → alphabetical (Builder first).
    const items = buildMostUsedItems(
      {
        agentLeaderboard: [agentEntry('ag2', 3), agentEntry('ag1', 3)],
        skillLeaderboard: [],
        workflowLeaderboard: [],
        panelLeaderboard: [],
      },
      source,
    );
    expect(items.map((i) => i.displayName)).toEqual(['The Builder', 'The Catalyst']);
  });

  it('excludes personas that no longer resolve in the source', () => {
    const items = buildMostUsedItems(
      {
        agentLeaderboard: [agentEntry('ghost', 99), agentEntry('ag1', 2)],
        skillLeaderboard: [],
        workflowLeaderboard: [],
        panelLeaderboard: [],
      },
      source,
    );
    expect(items.map((i) => i.id)).toEqual(['ag1']);
  });

  it('excludes primitives with zero runs (never launched is not "most used")', () => {
    const items = buildMostUsedItems(
      {
        agentLeaderboard: [agentEntry('ag1', 0)],
        skillLeaderboard: [skillEntry('sk1', 4)],
        workflowLeaderboard: [],
        panelLeaderboard: [],
      },
      source,
    );
    expect(items.map((i) => i.id)).toEqual(['sk1']);
  });

  it('tolerates a missing agentLeaderboard (falls back to the three run leaderboards)', () => {
    const items = buildMostUsedItems(
      {
        skillLeaderboard: [skillEntry('sk1', 3)],
        workflowLeaderboard: [],
        panelLeaderboard: [],
      },
      source,
    );
    expect(items.map((i) => i.id)).toEqual(['sk1']);
  });

  it('caps the list to the requested limit', () => {
    const items = buildMostUsedItems(
      {
        agentLeaderboard: [agentEntry('ag1', 1)],
        skillLeaderboard: [skillEntry('sk1', 2)],
        workflowLeaderboard: [workflowEntry('wf1', 3)],
        panelLeaderboard: [panelEntry('pn1', 4)],
      },
      source,
      2,
    );
    expect(items.map((i) => i.id)).toEqual(['pn1', 'wf1']);
  });

  it('returns an empty list when there are no stats', () => {
    expect(buildMostUsedItems(null, source)).toEqual([]);
  });
});
