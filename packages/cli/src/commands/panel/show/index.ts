import type { CommandDef } from '../../../core/types.ts';
import { c, die, info } from '../../../core/colors.ts';
import {
  fetchPanels,
  fetchPersonas,
  handle,
  panelHandleName,
  printJson,
  resolveFromList,
} from '../../../core/agentic.ts';

interface ShowOptions { json?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  description: 'Show one panel (by name or UUID), including its members',
  setup(cmd) {
    cmd.argument('<id|name>', 'Panel name (@panel: handle) or UUID');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (arg: string, opts: ShowOptions) => {
    const panels = await fetchPanels();
    const p = resolveFromList(arg, panels, panelHandleName, (x) => x.displayName);
    if (!p) die(`Panel not found: ${arg}`);

    if (opts.json) {
      printJson(p);
      return;
    }
    // Resolve persona ids → display names (members + orchestrator, best-effort).
    const personas = await fetchPersonas().catch(() => []);
    const nameById = new Map(personas.map((x) => [x.id, x.displayName ?? x.name]));

    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold(p.displayName ?? p.name)}\n`);
    process.stdout.write(`  ${c.dim('handle')}   ${handle('panel', panelHandleName(p))}\n`);
    process.stdout.write(`  ${c.dim('id')}       ${p.id}\n`);
    process.stdout.write(`  ${c.dim('mode')}     ${p.executionMode ?? '-'}\n`);
    process.stdout.write(`  ${c.dim('enabled')}  ${p.enabled ? 'yes' : 'no'}\n`);
    if (p.description) process.stdout.write(`  ${c.dim('about')}    ${p.description}\n`);
    process.stdout.write(`  ${c.dim('default member model')}  ${p.defaultMemberModel ?? '-'}\n`);

    process.stdout.write(`\n  ${c.bold('Orchestrator')}\n`);
    const orchPersona = p.orchestratorPersonaId
      ? (nameById.get(p.orchestratorPersonaId) ?? p.orchestratorPersonaId)
      : '(prompt-only)';
    process.stdout.write(`  ${c.dim('persona')}  ${orchPersona}\n`);
    process.stdout.write(`  ${c.dim('model')}    ${p.orchestratorModel ?? '-'}\n`);
    if (p.orchestratorPrompt) {
      const firstLine = p.orchestratorPrompt.split('\n')[0] ?? '';
      const excerpt = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
      process.stdout.write(`  ${c.dim('prompt')}   ${excerpt} ${c.dim('(use --json for the full prompt)')}\n`);
    }

    if (p.members?.length) {
      process.stdout.write(`\n  ${c.bold('Members')}\n`);
      const ordered = [...p.members].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const m of ordered) {
        const name = (m.personaId && nameById.get(m.personaId)) ?? m.personaId ?? '(unknown)';
        const hasOverride = m.modelOverride && m.modelOverride !== 'inherited';
        const model = hasOverride
          ? c.dim(` (${m.modelOverride})`)
          : c.dim(` (inherited → ${p.defaultMemberModel ?? '-'})`);
        process.stdout.write(`  - ${name}${model}\n`);
      }
    }
    process.stdout.write('\n');
    info(`Trigger with: fleex trigger <ticket> --panel ${panelHandleName(p)}`);
  },
};

export default def;
