// ── Panel Types ──

import type { ExecutionMode } from './agent-persona.js';

export type PanelMemberModelConfig = 'inherited' | string; // 'inherited' uses persona's model, or explicit model name

export interface PanelMember {
  readonly personaId: string;
  readonly order: number;
  readonly modelOverride: PanelMemberModelConfig; // 'inherited' or explicit model like 'claude-sonnet-4-5-20250929'
}

export interface Panel {
  readonly id: string;
  readonly name: string; // unique slug: 'archi-committee'
  readonly displayName: string;
  readonly description: string;
  readonly executionMode: ExecutionMode;
  readonly members: PanelMember[];
  readonly orchestratorPrompt: string; // system prompt for the synthesizer
  readonly orchestratorModel: string; // model for the orchestrator (e.g., 'claude-opus-4-5-20250929')
  readonly orchestratorPersonaId: string | null; // optional persona for synthesis (uses soul/identity/memory)
  readonly defaultMemberModel: string; // fallback model for members when 'inherited' and persona has none
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePanelRequest {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly executionMode?: ExecutionMode;
  readonly members: PanelMember[];
  readonly orchestratorPrompt?: string;
  readonly orchestratorModel?: string;
  readonly orchestratorPersonaId?: string | null;
  readonly defaultMemberModel?: string;
  readonly enabled?: boolean;
}

export interface UpdatePanelRequest {
  readonly name?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly executionMode?: ExecutionMode;
  readonly members?: PanelMember[];
  readonly orchestratorPrompt?: string;
  readonly orchestratorModel?: string;
  readonly orchestratorPersonaId?: string | null;
  readonly defaultMemberModel?: string;
  readonly enabled?: boolean;
}

export type PanelWsMessageType = 'panel:created' | 'panel:updated' | 'panel:deleted';

export interface PanelWsMessage {
  readonly type: PanelWsMessageType;
  readonly data: unknown;
}
