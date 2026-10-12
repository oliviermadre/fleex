import type { CommandDef } from '../../../core/types.ts';
import { info } from '../../../core/colors.ts';
import {
  fetchClaudeCodeSkills,
  fetchSkills,
  handle,
  printJson,
  renderTable,
  skillHandleName,
  trunc,
  type ClaudeCodeSkillRow,
} from '../../../core/agentic.ts';

interface ListOptions { json?: boolean; enabled?: boolean; all?: boolean; origin?: string }

const ORIGINS = ['fleex', 'cc', 'cc:user', 'cc:project', 'cc:plugin', 'cc:synced'];

interface Row {
  commandName: string;
  name: string;
  origin: string;
  enabled: boolean;
  status: string;
  repo: string | null;
  nativeName: string | null;
}

/** A Claude Code skill is runnable only when enabled and its SKILL.md is present. */
const runnable = (s: ClaudeCodeSkillRow) => s.enabled && s.status === 'present';

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List skills with their @skill: handle, name and origin (fleex or cc:<origin>)',
  setup(cmd) {
    cmd.option('--enabled', 'Only show enabled skills');
    cmd.option('--all', 'Include Claude Code skills that are disabled, missing, invalid or in conflict');
    cmd.option('--origin <origin>', `Only one origin: ${ORIGINS.join(' | ')}`);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: ListOptions) => {
    if (opts.origin && !ORIGINS.includes(opts.origin)) {
      throw new Error(`Unknown origin "${opts.origin}". Expected one of: ${ORIGINS.join(', ')}`);
    }
    const [native, cc] = await Promise.all([
      fetchSkills(Boolean(opts.enabled)),
      // Older servers have no Claude Code endpoint: list native skills only.
      fetchClaudeCodeSkills().catch(() => ({ hostId: '', skills: [] as ClaudeCodeSkillRow[] })),
    ]);

    let rows: Row[] = [
      ...native.map((s) => ({
        commandName: skillHandleName(s), name: s.displayName ?? s.name ?? '', origin: 'fleex',
        enabled: s.enabled, status: '', repo: null, nativeName: null,
      })),
      ...cc.skills.filter((s) => opts.all || runnable(s)).map((s) => ({
        commandName: s.commandName, name: s.name || s.nativeName, origin: `cc:${s.origin}`,
        enabled: s.enabled, status: s.status + (s.modifiedSinceActivation ? '*' : ''), repo: s.repo, nativeName: s.nativeName,
      })),
    ];
    if (opts.origin) rows = rows.filter((r) => r.origin === opts.origin || (opts.origin === 'cc' && r.origin.startsWith('cc:')));

    if (opts.json) {
      printJson(rows);
      return;
    }
    if (rows.length === 0) {
      info('No skills found.');
      return;
    }
    rows.sort((a, b) => a.commandName.localeCompare(b.commandName) || a.origin.localeCompare(b.origin));
    const showStatus = Boolean(opts.all);
    renderTable(
      ['HANDLE', 'NAME', 'ORIGIN', 'ENABLED', ...(showStatus ? ['STATUS'] : [])],
      rows.map((r) => [
        handle('skill', r.commandName),
        trunc(r.name, 40),
        r.repo ? `${r.origin} (${r.repo})` : r.origin,
        r.enabled ? 'yes' : 'no',
        ...(showStatus ? [r.status || '—'] : []),
      ]),
    );
    const notes = [`${rows.length} skill(s)`];
    if (cc.hostId) notes.push(`Claude Code skills of host ${cc.hostId}`);
    if (!opts.all) notes.push('--all to include disabled / missing Claude Code skills');
    if (rows.some((r) => r.status.endsWith('*'))) notes.push('* modified since activation');
    info(notes.join(' · '));
  },
};

export default def;
