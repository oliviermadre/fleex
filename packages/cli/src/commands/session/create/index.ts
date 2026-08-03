import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, present } from '../../../core/colors.ts';
import { assertValidSessionType, type Session } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface CreateOptions {
  type?: string;
  cwd?: string;
  name?: string;
  prompt?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  aliases: ['new'],
  description: 'Create a tmux session (create [--type shell|claude] [--cwd <dir>])',
  setup(cmd) {
    cmd.option('--type <type>', 'Session type: shell | claude', 'shell');
    cmd.option('--cwd <dir>', 'Working directory (defaults to the current directory)');
    cmd.option('--name <name>', 'Display name for the session');
    cmd.option('--prompt <text>', 'Initial Claude prompt (only used for --type claude)');
  },
  action: async (opts: CreateOptions) => {
    const type = opts.type ?? 'shell';
    assertValidSessionType(type);
    const body: Record<string, unknown> = { type, cwd: opts.cwd ?? process.cwd() };
    if (opts.name !== undefined) body.displayName = opts.name;
    if (opts.prompt !== undefined) body.claudePrompt = opts.prompt;
    // The server 422s when cwd does not exist — surfaced verbatim by the api layer.
    const session = await apiPost<Session>(`${apiBase()}/api/sessions`, body);
    present(session, () =>
      ok(
        `Created ${session.type} session ${session.displayName ?? ''} (${session.id.slice(0, 8)})`,
      ),
    );
  },
};

export default def;
