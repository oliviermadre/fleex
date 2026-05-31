import type {
  MarketplacePersona,
  MarketplaceSkill,
  MarketplacePanel,
  MarketplaceWorkflow,
} from '@fleex/shared';

// Build the request bodies for the create/update endpoints from portable
// marketplace content. Persona slugs are resolved to local persona ids by the
// caller (personas are always installed/resolved first).

export function personaBody(c: MarketplacePersona) {
  return {
    name: c.name,
    displayName: c.displayName,
    model: c.model,
    executionMode: c.executionMode,
    soulMd: c.soulMd,
    identityMd: c.identityMd,
    // memoryMd intentionally not sent — it's personal state.
  };
}

export function skillBody(c: MarketplaceSkill, personaId: string) {
  return {
    commandName: c.commandName,
    name: c.name,
    displayName: c.displayName,
    markdownContent: c.markdownContent,
    enabled: c.enabled,
    personaId,
  };
}

export function panelBody(c: MarketplacePanel, resolvePersona: (slug: string) => string) {
  // NOTE: the panel API has no orchestratorPersona field, so it is dropped on
  // install. Callers warn the user when c.orchestratorPersona is set.
  return {
    name: c.name,
    displayName: c.displayName,
    description: c.description,
    executionMode: c.executionMode,
    members: c.members.map((m) => ({
      personaId: resolvePersona(m.persona),
      order: m.order,
      modelOverride: m.modelOverride,
    })),
    orchestratorPrompt: c.orchestratorPrompt,
    orchestratorModel: c.orchestratorModel,
    defaultMemberModel: c.defaultMemberModel,
    enabled: c.enabled,
  };
}

export function workflowBody(c: MarketplaceWorkflow) {
  return {
    name: c.name,
    slug: c.slug,
    emoji: c.emoji,
    description: c.description,
    steps: c.steps,
    edges: c.edges,
    entryStepId: c.entryStepId,
    enabled: c.enabled,
  };
}
