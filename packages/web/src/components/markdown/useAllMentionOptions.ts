import { useMemo } from 'react';
import { GLOBAL_NOTE_KEY } from '@fleex/shared';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import type { MentionOption } from './MentionMenu';

/**
 * Every mention a Fleex editor can offer, in one place.
 *
 * Built once and shared, because three editors need the same list and three
 * copies of it would drift. What each *surface* does with a mention still
 * differs — a comment dispatches, a note points — but that is the renderer's
 * business, not the picker's.
 *
 * Tickets are `deferred`: they can run into the thousands, so they stay
 * hidden until the user types a query and are capped by the autocomplete.
 * Notes are not — they're bounded by the number of configured repositories
 * plus one, so a bare `@` listing them is exactly the answer to "what could
 * this even point at?".
 */
export function useAllMentionOptions(): MentionOption[] {
  const personas = useAgentPersonaStore((s) => s.personas);
  const panels = usePanelStore((s) => s.panels);
  const skills = useSkillStore((s) => s.skills);
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const routines = useRoutineStore((s) => s.routines);
  const scratchpadList = useScratchpadStore((s) => s.scratchpadList);
  const tickets = useTicketStore((s) => s.tickets);
  const humanMentionName = useSettingsStore(
    (s) => (s.settings as unknown as Record<string, unknown>)['humanMentionName'] as string | undefined,
  );

  return useMemo<MentionOption[]>(() => {
    const opts: MentionOption[] = [];

    for (const p of personas) {
      opts.push({ insertText: `@agent:${p.name}`, label: p.displayName || p.name, type: 'agent' });
    }
    for (const panel of panels) {
      if (panel.enabled === false) continue;
      opts.push({ insertText: `@panel:${panel.name}`, label: panel.displayName || panel.name, type: 'panel' });
    }
    for (const skill of skills) {
      if (skill.enabled === false) continue;
      opts.push({ insertText: `@skill:${skill.commandName}`, label: skill.displayName || skill.commandName, type: 'skill' });
    }
    for (const wf of templates) {
      if (wf.enabled === false) continue;
      opts.push({ insertText: `@workflow:${wf.slug}`, label: wf.emoji ? `${wf.emoji} ${wf.name}` : wf.name, type: 'workflow' });
    }
    for (const r of routines) {
      opts.push({ insertText: `@routine:${r.slug}`, label: r.emoji ? `${r.emoji} ${r.name}` : r.name, type: 'routine' });
    }
    for (const note of scratchpadList) {
      // The reference syntax spells the global note `global`; `__global__` is a
      // storage key and must never reach the document.
      opts.push({
        insertText: `@scratchpad:${note.key === GLOBAL_NOTE_KEY ? 'global' : note.key}`,
        label: note.label,
        type: 'scratchpad',
      });
    }
    if (humanMentionName) {
      opts.push({ insertText: `@${humanMentionName}`, label: humanMentionName, type: 'human' });
    }
    for (const t of tickets) {
      opts.push({ insertText: `@ticket:${t.displayId}`, label: `#${t.displayId} ${t.title}`, type: 'ticket', deferred: true });
    }
    return opts;
  }, [personas, panels, skills, templates, routines, scratchpadList, tickets, humanMentionName]);
}
