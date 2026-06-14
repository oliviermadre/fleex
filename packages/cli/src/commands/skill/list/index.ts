import type { CommandDef } from '../../../core/types.ts';
import { info } from '../../../core/colors.ts';
import {
  fetchSkills,
  handle,
  printJson,
  renderTable,
  skillHandleName,
  trunc,
} from '../../../core/agentic.ts';

interface ListOptions { json?: boolean; enabled?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List skills with their @skill: handle and description',
  setup(cmd) {
    cmd.option('--enabled', 'Only show enabled skills');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: ListOptions) => {
    const skills = await fetchSkills(Boolean(opts.enabled));
    if (opts.json) {
      printJson(skills);
      return;
    }
    if (skills.length === 0) {
      info('No skills found.');
      return;
    }
    skills.sort((a, b) => skillHandleName(a).localeCompare(skillHandleName(b)));
    const rows = skills.map((s) => [
      handle('skill', skillHandleName(s)),
      trunc(s.displayName ?? s.name ?? '', 50),
      s.enabled ? 'yes' : 'no',
    ]);
    renderTable(['HANDLE', 'NAME', 'ENABLED'], rows);
    info(`${skills.length} skill(s)`);
  },
};

export default def;
