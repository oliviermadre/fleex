import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiPost, LLM_TIMEOUT_MS } from '../../../../core/api.ts';
import { enc, fx, resolveMachine } from '../../_shared.ts';

interface PullResult { pulled: number; new: number; updated: number; moved: number; error: string | null }

const def: CommandDef = {
  workspaceAware: true,
  name: 'pull',
  access: 'write',
  description: 'Pull a Gmail intake now, without waiting for its interval — how many messages it saw and what became of them (its first pull only sets where to start from)',
  setup(cmd) {
    cmd.argument('<intake>', 'Intake name, id or id prefix');
  },
  action: async (ref: string) => {
    const m = await resolveMachine(ref, ['intake']);
    // A pull reads every page of the search, then each message twice: well past the ten seconds of a CRUD call.
    const { snapshot: _floor, ...result } = await apiPost<PullResult & { snapshot?: unknown }>(fx(`/intakes/${enc(m.id)}/pull`), {}, LLM_TIMEOUT_MS);
    if (result.error) die(`${m.name}: ${result.error}`);
    present({ intakeId: m.id, name: m.name, ...result }, () =>
      ok(`${m.name}: ${result.pulled} message(s) seen — ${result.new} new item(s), ${result.updated} updated, ${result.moved} taken over`));
  },
};

export default def;
