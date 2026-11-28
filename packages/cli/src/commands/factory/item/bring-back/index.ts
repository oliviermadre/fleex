import type { CommandDef } from '../../../../core/types.ts';
import { ok, present } from '../../../../core/colors.ts';
import { apiPost } from '../../../../core/api.ts';
import { enc, fetchToken, fx, printToken } from '../../_shared.ts';
import { resolveItemId } from '../_resolve.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'bring-back',
  access: 'write',
  description: 'Bring an archived item back to the floor — to the intake it came in by, past its rules, with everything it had',
  setup(cmd) {
    cmd.argument('<item>', 'Id of an archived item, or the start of it (`fleex factory item archived` lists them)');
  },
  action: async (ref: string) => {
    const id = await resolveItemId(ref);
    await apiPost(fx(`/items/${enc(id)}/bring-back`), {});
    const after = await fetchToken(id);
    present(after, () => { ok('Back on the floor'); printToken(after); });
  },
};

export default def;
