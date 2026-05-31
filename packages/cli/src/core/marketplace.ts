import type {
  AgentPersona,
  Skill,
  Panel,
  WorkflowTemplate,
  WorkflowExecutorType,
  MarketplacePersona,
  MarketplaceSkill,
  MarketplacePanel,
  MarketplaceWorkflow,
  PrimitiveKind,
  PrimitiveRef,
} from '@fleex/shared';

// Sub-directory holding each kind's primitive files inside a marketplace repo.
export const DIR_BY_KIND: Record<PrimitiveKind, string> = {
  persona: 'personas',
  skill: 'skills',
  panel: 'panels',
  workflow: 'workflows',
};

/** Path to a primitive's JSON file, relative to the manifest. */
export function filePathFor(kind: PrimitiveKind, slug: string): string {
  return `${DIR_BY_KIND[kind]}/${slug}.json`;
}

/** Map executor type used in workflow steps to the primitive kind it points to. */
export function executorKind(type: WorkflowExecutorType): PrimitiveKind | null {
  switch (type) {
    case 'agent':
      return 'persona';
    case 'skill':
      return 'skill';
    case 'panel':
      return 'panel';
    default:
      return null; // human_gate references nothing
  }
}

function personaName(idToName: Map<string, string>, id: string): string {
  const name = idToName.get(id);
  if (!name) throw new Error(`references unknown persona id "${id}"`);
  return name;
}

// ── local DTO -> portable marketplace content (UUID refs become slugs) ──

export function toMarketplacePersona(
  p: AgentPersona,
  opts: { includeMemory: boolean },
): MarketplacePersona {
  const content: MarketplacePersona = {
    name: p.name,
    displayName: p.displayName,
    model: p.model,
    executionMode: p.executionMode,
    soulMd: p.soulMd,
    identityMd: p.identityMd,
  };
  return opts.includeMemory ? { ...content, memoryMd: p.memoryMd } : content;
}

export function toMarketplaceSkill(s: Skill, idToName: Map<string, string>): MarketplaceSkill {
  return {
    commandName: s.commandName,
    name: s.name,
    displayName: s.displayName,
    markdownContent: s.markdownContent,
    enabled: s.enabled,
    persona: personaName(idToName, s.personaId),
  };
}

export function toMarketplacePanel(p: Panel, idToName: Map<string, string>): MarketplacePanel {
  return {
    name: p.name,
    displayName: p.displayName,
    description: p.description,
    executionMode: p.executionMode,
    members: p.members.map((m) => ({
      persona: personaName(idToName, m.personaId),
      order: m.order,
      modelOverride: m.modelOverride,
    })),
    orchestratorPrompt: p.orchestratorPrompt,
    orchestratorModel: p.orchestratorModel,
    orchestratorPersona: p.orchestratorPersonaId
      ? personaName(idToName, p.orchestratorPersonaId)
      : null,
    defaultMemberModel: p.defaultMemberModel,
    enabled: p.enabled,
  };
}

export function toMarketplaceWorkflow(w: WorkflowTemplate): MarketplaceWorkflow {
  return {
    slug: w.slug,
    name: w.name,
    emoji: w.emoji,
    description: w.description,
    steps: w.steps, // executorRef is already slug-based
    edges: w.edges,
    entryStepId: w.entryStepId,
    enabled: w.enabled,
  };
}

// ── dependency derivation (by slug) ──

export function deriveSkillDeps(s: MarketplaceSkill): PrimitiveRef[] {
  return [{ kind: 'persona', slug: s.persona }];
}

export function derivePanelDeps(p: MarketplacePanel): PrimitiveRef[] {
  const slugs = new Set<string>();
  for (const m of p.members) slugs.add(m.persona);
  if (p.orchestratorPersona) slugs.add(p.orchestratorPersona);
  return [...slugs].map((slug) => ({ kind: 'persona' as const, slug }));
}

export function deriveWorkflowDeps(w: MarketplaceWorkflow): PrimitiveRef[] {
  const refs = new Map<string, PrimitiveRef>();
  for (const step of w.steps) {
    const kind = executorKind(step.executorType);
    if (!kind || !step.executorRef) continue;
    refs.set(`${kind}:${step.executorRef}`, { kind, slug: step.executorRef });
  }
  return [...refs.values()];
}
