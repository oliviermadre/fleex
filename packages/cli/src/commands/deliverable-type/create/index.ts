import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, die, present, c } from '../../../core/colors.ts';
import {
  assertValidRenderer,
  resolveColor,
  COLOR_KEYS,
  type DeliverableTypesView,
} from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface CreateOptions {
  id?: string;
  label?: string;
  description?: string;
  renderer?: string;
  color?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  aliases: ['new'],
  description:
    'Create a deliverable type (create --id diagram --label Diagram [--renderer html] [--color violet])',
  setup(cmd) {
    cmd.requiredOption('--id <id>', 'Stable slug stored on deliverables (e.g. diagram)');
    cmd.requiredOption('--label <label>', 'Human-friendly label');
    cmd.option('--description <text>', 'Guidance shown to agents when choosing this type');
    cmd.option('--renderer <renderer>', 'How the web renders it: markdown | html', 'markdown');
    cmd.option('--color <color>', `Badge colour preset: ${COLOR_KEYS.join(', ')}`);
  },
  action: async (opts: CreateOptions) => {
    const id = opts.id?.trim();
    if (!id) die('Deliverable type id cannot be empty.');
    const label = opts.label?.trim();
    if (!label) die('Deliverable type label cannot be empty.');
    const renderer = opts.renderer ?? 'markdown';
    assertValidRenderer(renderer);

    const body: Record<string, unknown> = { id, label, renderer };
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.color !== undefined) body.color = resolveColor(opts.color);

    const view = await apiPost<DeliverableTypesView>(`${apiBase()}/api/deliverable-types`, body);
    present(view, () => ok(`Created deliverable type ${c.bold(id)} (${label}, ${renderer})`));
  },
};

export default def;
