import type { CommandDef } from '../../../../core/types.ts';
import { die } from '../../../../core/colors.ts';
import { apiPatch } from '../../../../core/api.ts';
import { accumulate } from '../../../ticket/_shared.ts';
import { actOn, enc, fx } from '../../_shared.ts';
import { parseFields } from '../_shared.ts';

interface EditOptions { title?: string; author?: string; text?: string; url?: string; tag?: string[]; noTags?: boolean; tags?: boolean; field?: string[] }

const def: CommandDef = {
  workspaceAware: true,
  name: 'edit',
  access: 'write',
  aliases: ['update'],
  description: 'Change what the Factory keeps of an item on the floor — title, who from, link, first lines, tags, source fields; only the flags you pass change',
  setup(cmd) {
    cmd.argument('<item>', 'Item id, or the start of it');
    cmd.option('--title <text>', 'New title');
    cmd.option('--author <text>', 'Who it is from');
    cmd.option('--text <text>', 'Its first lines (what stations and cards show)');
    cmd.option('--url <url>', 'Link back to it (empty string clears it)');
    cmd.option('--tag <tag>', 'Replace its tags with these (repeatable): arms route on them', accumulate, []);
    cmd.option('--no-tags', 'Remove every tag');
    cmd.option('--field <key=value>', 'Replace its source fields with these (repeatable): channel=#ops, bot=true', accumulate, []);
  },
  action: async (ref: string, opts: EditOptions) => {
    const fields = parseFields(opts.field);
    const patch = {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.author !== undefined ? { author: opts.author } : {}),
      ...(opts.text !== undefined ? { excerpt: opts.text } : {}),
      ...(opts.url !== undefined ? { url: opts.url || null } : {}),
      ...(opts.tags === false ? { tags: [] } : opts.tag?.length ? { tags: opts.tag } : {}),
      ...(fields ? { fields } : {}),
    };
    if (Object.keys(patch).length === 0) die('Nothing to change — pass at least one flag. See `fleex factory item edit --help`.');
    await actOn(ref, (t) => apiPatch(fx(`/items/${enc(t.id)}`), patch), 'Item updated', 'item');
  },
};

export default def;
