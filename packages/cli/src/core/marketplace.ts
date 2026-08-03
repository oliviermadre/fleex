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
  MarketplacePrimitiveEntry,
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

// ── removal closure (reverse-dependency walk) ──

/** Stable key for a primitive within a manifest. */
export function refKey(ref: PrimitiveRef): string {
  return `${ref.kind}:${ref.slug}`;
}

/**
 * Given manifest entries and a set of targets to remove, return the full set of
 * entries that must go so no dangling dependency is left behind: the targets
 * plus every entry that (transitively) depends on a target.
 *
 * Pure — no I/O. `toRemove` is the complete set; `dependents` is `toRemove`
 * minus the originally-requested targets (i.e. the cascade fallout to surface
 * to the user).
 */
export function computeRemovalClosure(
  primitives: readonly MarketplacePrimitiveEntry[],
  targets: readonly PrimitiveRef[],
): { toRemove: MarketplacePrimitiveEntry[]; dependents: MarketplacePrimitiveEntry[] } {
  const byKey = new Map<string, MarketplacePrimitiveEntry>();
  for (const e of primitives) byKey.set(refKey(e), e);

  // Reverse graph: depKey -> entries that depend on it.
  const dependsOn = new Map<string, MarketplacePrimitiveEntry[]>();
  for (const e of primitives) {
    for (const dep of e.dependencies) {
      const k = refKey(dep);
      (dependsOn.get(k) ?? dependsOn.set(k, []).get(k)!).push(e);
    }
  }

  const targetKeys = new Set(targets.map(refKey).filter((k) => byKey.has(k)));

  // BFS over the reverse graph starting from the targets.
  const removeKeys = new Set<string>(targetKeys);
  const queue = [...targetKeys];
  while (queue.length > 0) {
    const k = queue.shift()!;
    for (const dependent of dependsOn.get(k) ?? []) {
      const dk = refKey(dependent);
      if (!removeKeys.has(dk)) {
        removeKeys.add(dk);
        queue.push(dk);
      }
    }
  }

  const toRemove = [...removeKeys].map((k) => byKey.get(k)!);
  const dependents = toRemove.filter((e) => !targetKeys.has(refKey(e)));
  return { toRemove, dependents };
}
