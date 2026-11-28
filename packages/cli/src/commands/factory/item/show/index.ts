import type { CommandDef } from '../../../../core/types.ts';
import { c, present } from '../../../../core/colors.ts';
import { apiGet } from '../../../../core/api.ts';
import { enc, fetchTokens, fx, since, type FloorToken } from '../../_shared.ts';
import { fetchItem } from '../_resolve.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  access: 'read',
  description: 'An item as the Factory keeps it, on the floor or archived — source, who from, its first lines, tags, fields, where it stands or how it left',
  setup(cmd) {
    cmd.argument('<item>', 'Item id, or the start of it');
    cmd.option('--body', 'Also print its whole latest message (a mail is read as text), not only its first lines');
  },
  action: async (ref: string, opts: { body?: boolean }) => {
    const item = await fetchItem(ref);
    const standing: FloorToken | null = item.archivedAt ? null : (await fetchTokens()).find((t) => t.id === item.id) ?? null;
    const body = opts.body ? await apiGet<{ text: string; kept: boolean }>(fx(`/items/${enc(item.id)}/body`)).then((b) => b.text) : undefined;
    present({ ...item, standing, ...(body !== undefined ? { body } : {}) }, () => {
      const w = (label: string, value: string) => process.stdout.write(`  ${c.dim(label.padEnd(9))} ${value}\n`);
      process.stdout.write(`${c.bold(item.id.slice(0, 8))} ${item.title}\n`);
      w('id', item.id);
      w('from', `${item.source}${item.author ? ` · ${item.author}` : ''} · ${item.messages} message(s), last ${since(item.lastActivityAt)} ago`);
      if (item.url) w('link', item.url);
      if (item.tags.length) w('tags', item.tags.join(', '));
      for (const [k, v] of Object.entries(item.fields)) w(k, Array.isArray(v) ? v.join(', ') : String(v));
      if (standing) { w('where', standing.where); w('state', `${standing.state}${c.dim(`  for ${since(standing.since)}`)}`); w('can', standing.actions.join(', ')); }
      else w('archived', `${since(item.archivedAt)} ago, ${item.archivedReason === 'exit' ? 'by an exit' : item.archivedReason === 'dropped' ? 'dropped by a rule' : 'by hand'}  ${c.dim('→ fleex factory item bring-back')}`);
      const text = body ?? item.excerpt;
      if (text) process.stdout.write(`\n${text}\n`);
    });
  },
};

export default def;
