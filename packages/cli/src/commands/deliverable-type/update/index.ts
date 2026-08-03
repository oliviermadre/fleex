import { apiBase, apiPatch } from '../../../core/api.ts';
import { ok, die, present, c } from '../../../core/colors.ts';
import {
  assertValidRenderer,
  resolveColor,
  resolveDeliverableType,
  COLOR_KEYS,
  type DeliverableTypesView,
} from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface UpdateOptions {
  label?: string;
  description?: string;
  renderer?: string;
  /** string preset key, or `false` when `--no-color` clears the badge. */
  color?: string | false;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  aliases: ['edit'],
  description: 'Update a deliverable type (label, description, renderer, colour)',
  setup(cmd) {
    cmd.argument('<id>', 'Deliverable type id');
    cmd.option('--label <label>', 'New label');
    cmd.option('--description <text>', 'New description');
    cmd.option('--renderer <renderer>', 'New renderer: markdown | html');
    cmd.option('--color <color>', `New badge colour preset: ${COLOR_KEYS.join(', ')}`);
    cmd.option('--no-color', 'Clear the badge colour');
  },
  action: async (idArg: string, opts: UpdateOptions) => {
    const type = await resolveDeliverableType(idArg);

    const body: Record<string, unknown> = {};
    if (opts.label !== undefined) body.label = opts.label;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.renderer !== undefined) {
      assertValidRenderer(opts.renderer);
      body.renderer = opts.renderer;
    }
    if (opts.color === false) body.color = null;
    else if (opts.color !== undefined) body.color = resolveColor(opts.color);

    if (Object.keys(body).length === 0) {
      die(
        'Nothing to update. Provide at least one of --label, --description, --renderer, --color, --no-color.',
      );
    }

    const view = await apiPatch<DeliverableTypesView>(
      `${apiBase()}/api/deliverable-types/${type.id}`,
      body,
    );
    present(view, () => ok(`Updated deliverable type ${c.bold(type.id)}`));
  },
};

export default def;
