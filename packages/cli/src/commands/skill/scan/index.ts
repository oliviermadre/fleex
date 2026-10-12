import type { CommandDef } from '../../../core/types.ts';
import { info, ok } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { printJson } from '../../../core/agentic.ts';

interface ScanReport { hostId: string; added: number; changed: number; missing: number; back: number; invalid: number; total: number }

const def: CommandDef = {
  workspaceAware: true,
  name: 'scan',
  description: "Re-scan the Claude Code skills (SKILL.md) of the server's machine",
  setup(cmd) {
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: { json?: boolean }) => {
    const r = await apiPost<ScanReport>(`${apiBase()}/api/claude-code-skills/scan`, {}, 120_000);
    if (opts.json) {
      printJson(r);
      return;
    }
    ok(`Scanned Claude Code skills on ${r.hostId}: ${r.total} known`);
    info(`+${r.added} added  ~${r.changed} changed  -${r.missing} missing  ↺${r.back} back  !${r.invalid} invalid`);
    if (r.added > 0) info('New skills arrive disabled — enable them in Agents › Skills Claude Code détectés.');
  },
};

export default def;
