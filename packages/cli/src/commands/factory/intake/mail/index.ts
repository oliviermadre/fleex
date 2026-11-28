import type { CommandDef } from '../../../../core/types.ts';
import { c, present } from '../../../../core/colors.ts';
import { apiGet, LLM_TIMEOUT_MS } from '../../../../core/api.ts';
import { fx } from '../../_shared.ts';

interface MailStatus { provider: string | null; installed: boolean; version: string | null; connected: boolean; account: string | null; error: string | null; setupUrl: string | null }

const def: CommandDef = {
  workspaceAware: true,
  name: 'mail',
  access: 'read',
  description: 'Whether the mailbox the Gmail intakes read can be read — gogcli installed on the server host, Gmail authorized, on which account',
  setup(cmd) {
    cmd.option('--refresh', 'Ask again instead of answering from what was last seen');
  },
  action: async (opts: { refresh?: boolean }) => {
    const s = await apiGet<MailStatus>(fx(`/mail/status${opts.refresh ? '?refresh=1' : ''}`), LLM_TIMEOUT_MS);
    present(s, () => {
      const w = (label: string, value: string) => process.stdout.write(`  ${c.dim(label.padEnd(10))} ${value}\n`);
      process.stdout.write(`${c.bold('Mail')} ${s.connected ? c.green('readable') : c.red('not readable')}\n`);
      w('reader', s.provider ? `${s.provider}${s.version ? ` ${s.version}` : ''}${s.installed ? '' : c.red(' (not installed)')}` : 'none');
      if (s.account) w('account', s.account);
      if (s.error) w('problem', c.red(s.error));
      if (s.setupUrl) w('setup', s.setupUrl);
    });
  },
};

export default def;
