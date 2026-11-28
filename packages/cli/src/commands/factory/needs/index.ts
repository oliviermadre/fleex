import type { CommandDef } from '../../../core/types.ts';
import { c, info, present } from '../../../core/colors.ts';
import { apiGet } from '../../../core/api.ts';
import { renderTable, trunc } from '../../../core/agentic.ts';
import { ago, fx, refOf, type Need } from '../_shared.ts';

/** What to do about each thing a ticket waits for. */
const HINT: Record<string, string> = {
  decision: 'fleex factory ticket decide <ref> <outcome>',
  question: 'answer in its thread (fleex ticket comment <ref> "…"): its station runs again',
  failed: 'fleex factory ticket retry <ref>, or put-back <ref> --as <outcome>',
  aside: 'fleex factory ticket put-back <ref> [--as <outcome>]',
  floor: 'fleex factory ticket move <ref> --to <machine>',
  zone: 'do the work, then fleex factory ticket move <ref> --to <machine>',
};

const def: CommandDef = {
  workspaceAware: true,
  name: 'needs',
  access: 'read',
  description: 'What waits for someone on the floor — a decision at a gate, a question, a failed run, a ticket set aside or lying on the floor; longest wait first',
  action: async () => {
    const needs = await apiGet<Need[]>(fx('/needs'));
    present(needs, () => {
      if (needs.length === 0) { info('Nothing on the floor waits for anyone.'); return; }
      renderTable(['REF', 'WAITS FOR', 'WHERE', 'FOR', 'TITLE', 'OUTCOMES'], needs.map((n) => [
        refOf(n.token), c.yellow(n.label), trunc(n.token.where, 22), ago(n.waitMs), trunc(n.token.title, 44), n.token.outcomes.join(', ') || '-',
      ]));
      for (const kind of [...new Set(needs.map((n) => n.kind))]) process.stdout.write(`  ${c.dim(`${kind.padEnd(9)} → ${HINT[kind]}`)}\n`);
      info(`${needs.length} waiting`);
    });
  },
};

export default def;
