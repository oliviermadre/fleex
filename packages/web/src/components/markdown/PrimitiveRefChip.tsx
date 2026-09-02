import { MentionTypeIcon } from '../../lib/primitives';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useSkillStore } from '../../stores/skillStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';

/**
 * Inline chip for a primitive reference on a surface where nothing dispatches.
 *
 * The comment composer renders these same mentions as *actionable* — tied to a
 * run record, with a cross to cancel it. Everywhere else the mention is a
 * pointer, so this chip is outlined rather than filled and carries no cross: the
 * reader can tell the two apart without reading them side by side.
 *
 * Clicking opens the primitive's configuration view. Four of the five kinds live
 * in the `agents` panel; the routine has its own, and its `select` is async.
 */
export type PrimitiveRefKind = 'agent' | 'panel' | 'skill' | 'workflow' | 'routine';

interface Resolved {
  id: string;
  label: string;
}

export function PrimitiveRefChip({ kind, name }: { kind: PrimitiveRefKind; name: string }) {
  // Every store is read unconditionally: a hook cannot sit behind a branch, and
  // a zustand selector returning the store's own array reference is cheap.
  const personas = useAgentPersonaStore((s) => s.personas);
  const panels = usePanelStore((s) => s.panels);
  const skills = useSkillStore((s) => s.skills);
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const routines = useRoutineStore((s) => s.routines);

  const resolved = resolve(kind, name, { personas, panels, skills, templates, routines });

  // A name no store knows degrades to the text the author typed. Primitives are
  // deletable, and a chip that leads nowhere is worse than the raw syntax.
  if (!resolved) return <span>@{kind}:{name}</span>;

  // A `switch` with no `default`, matching `resolve()` below, and one case per
  // kind: a sixth `PrimitiveRefKind` with no case added here falls through and
  // opens nothing, instead of silently routing to whichever branch happened to
  // be last (previously the bare `else`, which always meant "workflow").
  const open = () => {
    switch (kind) {
      case 'routine':
        useUIStore.getState().setActivePanel('routines');
        // Async because it loads the run history — the only one of the five.
        void useRoutineStore.getState().select(resolved.id);
        return;
      case 'agent':
        useUIStore.getState().setActivePanel('agents');
        useAgentPersonaStore.getState().selectPersona(resolved.id);
        return;
      case 'panel':
        useUIStore.getState().setActivePanel('agents');
        usePanelStore.getState().selectPanel(resolved.id);
        return;
      case 'skill':
        useUIStore.getState().setActivePanel('agents');
        useSkillStore.getState().selectSkill(resolved.id);
        return;
      case 'workflow':
        useUIStore.getState().setActivePanel('agents');
        useWorkflowTemplateStore.getState().selectWorkflow(resolved.id);
        return;
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      title={`${kind}: ${resolved.label}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded-sm border border-[var(--theme-border)] px-1 py-px align-baseline text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
    >
      <MentionTypeIcon type={kind} size="sm" className="self-center" />
      <span className="truncate">{resolved.label}</span>
    </button>
  );
}

/**
 * Match the mentioned name against the field each kind is mentioned by.
 *
 * The fields differ per kind — a skill is mentioned by its command name, a
 * workflow and a routine by their slug — so this cannot be one generic lookup.
 * The displayed label prefers a human name where the entity has one.
 */
function resolve(
  kind: PrimitiveRefKind,
  name: string,
  stores: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    personas: any[]; panels: any[]; skills: any[]; templates: any[]; routines: any[];
  },
): Resolved | null {
  switch (kind) {
    case 'agent': {
      const hit = stores.personas.find((p) => p.name === name);
      return hit ? { id: hit.id, label: hit.name } : null;
    }
    case 'panel': {
      const hit = stores.panels.find((p) => p.name === name);
      return hit ? { id: hit.id, label: hit.name } : null;
    }
    case 'skill': {
      const hit = stores.skills.find((s) => s.commandName === name);
      return hit ? { id: hit.id, label: hit.commandName } : null;
    }
    case 'workflow': {
      const hit = stores.templates.find((t) => t.slug === name);
      return hit ? { id: hit.id, label: hit.name || hit.slug } : null;
    }
    case 'routine': {
      const hit = stores.routines.find((r) => r.slug === name);
      return hit ? { id: hit.id, label: hit.name || hit.slug } : null;
    }
  }
}
