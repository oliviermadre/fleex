// ── Marketplace / preset exchange format ──
//
// A marketplace is a plain git repository describing agentic primitives
// (personas, skills, panels, workflows) so they can be exported from one Fleex
// instance and installed into another. Everything is addressed by **slug**
// (persona.name, skill.commandName, panel.name, workflow.slug) — no UUIDs
// cross the boundary. Fleex translates slug <-> local id at export/import time.

import type { ExecutionMode } from './agent-persona.js';
import type { PanelMemberModelConfig } from './panel.js';
import type { WorkflowStep, WorkflowEdge } from './workflow.js';

export const MARKETPLACE_SCHEMA_VERSION = 1;

export type PrimitiveKind = 'persona' | 'skill' | 'panel' | 'workflow';

/** A dependency edge between primitives, expressed by slug. */
export interface PrimitiveRef {
  readonly kind: PrimitiveKind;
  readonly slug: string;
}

// ── Portable primitive contents (no id, no timestamps, refs by slug) ──

export interface MarketplacePersona {
  readonly name: string; // slug + unique key
  readonly displayName: string;
  readonly model: string;
  readonly executionMode: ExecutionMode;
  readonly soulMd: string;
  readonly identityMd: string;
  /** Personal state — omitted by default on export, included only on request. */
  readonly memoryMd?: string;
}

export interface MarketplaceSkill {
  readonly commandName: string; // slug + unique key
  readonly name: string;
  readonly displayName: string;
  readonly markdownContent: string;
  readonly enabled: boolean;
  readonly persona: string; // persona slug (was personaId)
}

export interface MarketplacePanelMember {
  readonly persona: string; // persona slug (was personaId)
  readonly order: number;
  readonly modelOverride: PanelMemberModelConfig;
}

export interface MarketplacePanel {
  readonly name: string; // slug + unique key
  readonly displayName: string;
  readonly description: string;
  readonly executionMode: ExecutionMode;
  readonly members: MarketplacePanelMember[];
  readonly orchestratorPrompt: string;
  readonly orchestratorModel: string;
  readonly orchestratorPersona: string | null; // persona slug (was orchestratorPersonaId)
  readonly defaultMemberModel: string;
  readonly enabled: boolean;
}

export interface MarketplaceWorkflow {
  readonly slug: string; // unique key
  readonly name: string;
  readonly emoji: string;
  readonly description: string;
  readonly steps: WorkflowStep[]; // step.executorRef is already slug-based
  readonly edges: WorkflowEdge[];
  readonly entryStepId: string;
  readonly enabled: boolean;
}

export type MarketplacePrimitiveContent =
  | MarketplacePersona
  | MarketplaceSkill
  | MarketplacePanel
  | MarketplaceWorkflow;

// ── Manifest (marketplace.json at the repo root) ──

export interface MarketplacePrimitiveEntry {
  readonly kind: PrimitiveKind;
  readonly slug: string;
  readonly displayName: string;
  /** Path to the primitive's JSON file, relative to the manifest. */
  readonly path: string;
  /** Other primitives this one needs to function, by slug. */
  readonly dependencies: PrimitiveRef[];
}

export interface MarketplaceManifest {
  readonly schemaVersion: number;
  readonly name: string;
  readonly description?: string;
  readonly primitives: MarketplacePrimitiveEntry[];
}
