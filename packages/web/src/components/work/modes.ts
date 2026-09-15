/**
 * The Work view's center modes in switcher order, and the cycling behind ⌃< / ⌃⇧<.
 * Workflow only takes part when the ticket has workflow runs.
 */
import type { WorkMode } from '../../stores/workStore';

export const MODE_ORDER: readonly WorkMode[] = ['chat', 'shell', 'code', 'workflow'];

/** The mode the center actually shows: a remembered workflow mode reads as chat while the ticket has no runs. */
export function activeMode(
  flags: { shellMode: boolean; codeMode: boolean; workflowMode: boolean },
  hasWorkflowRuns: boolean,
): WorkMode {
  if (flags.codeMode) return 'code';
  if (flags.shellMode) return 'shell';
  if (flags.workflowMode && hasWorkflowRuns) return 'workflow';
  return 'chat';
}

/** The next (1) or previous (-1) mode in switcher order, wrapping around; workflow is skipped without runs. */
export function cycleMode(current: WorkMode, dir: 1 | -1, hasWorkflowRuns: boolean): WorkMode {
  const modes = hasWorkflowRuns ? MODE_ORDER : MODE_ORDER.filter((mode) => mode !== 'workflow');
  const idx = Math.max(0, modes.indexOf(current));
  return modes[(idx + dir + modes.length) % modes.length]!;
}
