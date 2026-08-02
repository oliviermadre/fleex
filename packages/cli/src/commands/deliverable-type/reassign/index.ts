import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, warn, info, die, present, c } from '../../../core/colors.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../core/prompt.ts';
import { fetchDeliverableTypes, resolveDeliverableType } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface ReassignOptions {
  force?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'reassign',
  description: 'Move every deliverable of one type to another type (bulk migration)',
  setup(cmd) {
    cmd.argument('<from>', 'Source type id (may be a legacy/unconfigured id)');
    cmd.argument('<to>', 'Destination type id (must be configured)');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (fromArg: string, toArg: string, opts: ReassignOptions) => {
    const from = fromArg.trim();
    if (!from) die('Source type cannot be empty.');
    // `to` must be a configured type — surface a friendly error before mutating.
    const to = await resolveDeliverableType(toArg);
    if (from === to.id) die('Source and destination types are the same — nothing to do.');

    const { usage } = await fetchDeliverableTypes();
    const count = usage[from] ?? 0;

    if (count === 0) {
      info(`No deliverables use type "${from}" — nothing to reassign.`);
      return;
    }

    if (!opts.force) {
      // Bulk-mutating many deliverables must not happen silently in agents/CI.
      if (!canPrompt()) {
        die(
          `Refusing to reassign ${count} deliverable(s) from "${from}" to "${to.id}" without confirmation. Re-run with -f to force.`,
        );
      }
      warn(`This moves ${count} deliverable(s) from "${from}" to "${to.id}".`);
      const confirmed = await promptYesNo(`Reassign ${count} deliverable(s)?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }

    const result = await apiPost<{ migrated: number }>(
      `${apiBase()}/api/deliverable-types/reassign`,
      {
        from,
        to: to.id,
      },
    );
    present(result, () =>
      ok(`Reassigned ${result.migrated} deliverable(s) from ${c.bold(from)} to ${c.bold(to.id)}`),
    );
  },
};

export default def;
