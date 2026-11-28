import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present, warn } from '../../../../core/colors.ts';
import { apiPost } from '../../../../core/api.ts';
import { accumulate } from '../../../ticket/_shared.ts';
import { fetchToken, fx, printToken } from '../../_shared.ts';
import { ITEM_SOURCES, parseFields } from '../_shared.ts';

interface CreateOptions { title: string; source?: string; key?: string; author?: string; text?: string; url?: string; tag?: string[]; field?: string[] }

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  access: 'write',
  aliases: ['ingest'],
  description: 'Bring an item in — a new conversation, or a new message on a known one (same --source and --key); it goes to the first intake of its source that lets it in',
  setup(cmd) {
    cmd.requiredOption('--title <text>', 'What it is about (a mail\'s subject, a thread\'s first line)');
    cmd.option('--source <source>', `Where it comes from: ${ITEM_SOURCES.join(', ')} (default: manual)`);
    cmd.option('--key <key>', 'Its key in its source (a thread id): the same key again is a new message on the same item. Made up when omitted for a manual item');
    cmd.option('--author <text>', 'Who it is from');
    cmd.option('--text <text>', 'Its message');
    cmd.option('--url <url>', 'A link back to it in its source');
    cmd.option('--tag <tag>', 'A tag arms can route on (repeatable; key:value sets a value)', accumulate, []);
    cmd.option('--field <key=value>', 'A field of its source, which intake rules filter on (repeatable): channel=#ops, labels=INBOX,IMPORTANT, bot=true', accumulate, []);
  },
  action: async (opts: CreateOptions) => {
    const source = opts.source ?? 'manual';
    if (!ITEM_SOURCES.includes(source as typeof ITEM_SOURCES[number])) die(`Invalid source: ${source} (valid: ${ITEM_SOURCES.join(', ')})`);
    if (!opts.key && source !== 'manual') die(`A ${source} item needs --key: what ${source} knows the conversation by.`);
    const text = opts.text ?? '', fields = parseFields(opts.field);
    const result = await apiPost<{ itemId: string | null; status: string }>(fx('/items'), {
      source, key: opts.key ?? `manual-${Date.now().toString(36)}`, title: opts.title,
      ...(opts.author !== undefined ? { author: opts.author } : {}),
      ...(text ? { excerpt: text.slice(0, 2000), body: { text } } : {}),
      ...(opts.url !== undefined ? { url: opts.url } : {}),
      ...(opts.tag?.length ? { tags: opts.tag } : {}),
      ...(fields ? { fields } : {}),
    });
    // The route answers with the whole floor for the page; a command says what became of the item.
    const standing = result.itemId && result.status !== 'dropped' ? await fetchToken(result.itemId) : null;
    present({ itemId: result.itemId, status: result.status, standing }, () => {
      if (result.status === 'dropped') { warn('Dropped by the rules of its intake: it never reached the floor (`fleex factory item archived` lists it).'); return; }
      ok(`Item ${result.status === 'new' ? 'created' : result.status}`);
      if (standing) printToken(standing);
    });
  },
};

export default def;
