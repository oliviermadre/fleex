import { c, ok, info, die } from '../../../../core/colors.ts';
import {
  HUB_CLIENTS_FILE,
  generateHubToken,
  hashHubToken,
  readClientsFile,
  readHubState,
  writeClientsFile,
} from '../../_state.ts';

import type { CommandDef } from '../../../../core/types.ts';

const NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

async function runClientAdd(name: string): Promise<void> {
  if (!NAME_RE.test(name)) {
    die(`Invalid client name '${name}'. Use 1-64 chars in [a-zA-Z0-9_.-].`);
  }

  const file = readClientsFile();
  if (file.clients.some((e) => e.name === name)) {
    die(`Client '${name}' already exists. Revoke it first with: fleex hub client revoke ${name}`);
  }

  const token = generateHubToken();
  file.clients.push({
    name,
    tokenHash: hashHubToken(token),
    createdAt: new Date().toISOString(),
  });
  writeClientsFile(file);

  const hub = readHubState();
  ok(`Authorized client '${c.bold(name)}' (stored at ${HUB_CLIENTS_FILE}).`);
  process.stdout.write('\n');
  process.stdout.write(`  ${c.cyan('export FLEEX_EVENT_HUB_TOKEN=')}${token}\n`);
  if (hub) {
    process.stdout.write(`  ${c.cyan('export FLEEX_EVENT_HUB_URL=')}${hub.url}\n`);
  } else {
    process.stdout.write(`  ${c.dim('# Start the hub first to get the URL: fleex hub start')}\n`);
  }
  process.stdout.write('\n');
  info('Save the token now — it cannot be shown again (only its hash is stored).');
}

const def: CommandDef = {
  name: 'add',
  description: 'Authorize a new client and print its token (shown once)',
  setup(cmd) {
    cmd.argument('<name>', 'Client name (e.g. my-laptop, ci, worktree-feat-xyz)');
  },
  action: async (name: string) => {
    await runClientAdd(name);
  },
};

export default def;
