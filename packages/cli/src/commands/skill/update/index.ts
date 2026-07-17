/**
 * `fleex skill update` — PATCH a skill.
 *
 * The primary consumer is an LLM agent that discovers this command through
 * `fleex documentation`, so every description string below is normative
 * (spec §4.2) and self-contained: the flag description is the only source of
 * truth the agent sees. Do not reword casually — tests lock the wording.
 */
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { ok, die, warn, present, isJsonMode } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import {
  fetchPersonas,
  fetchSkills,
  personaHandleName,
  printJson,
  resolveFromList,
  skillHandleName,
  type Skill,
} from '../../../core/agentic.ts';
import {
  assertInlineFileExclusive,
  dieNoUpdates,
  readTextInput,
  resolveEnabledFlags,
} from '../../../core/update-helpers.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

interface UpdateOptions {
  persona?: string;
  prompt?: string;
  promptFile?: string;
  commandName?: string;
  name?: string;
  displayName?: string;
  enable?: boolean;
  disable?: boolean;
  dryRun?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  description:
    'Update a skill. PATCH semantics: ONLY the fields whose flags you pass are changed; omitted flags leave fields untouched. The skill prompt (--prompt/--prompt-file) is REPLACED in full, never merged.',
  setup(cmd) {
    cmd.argument(
      '<skill>',
      `Skill to update: command name (e.g. "review") or UUID, as shown by 'fleex skill list'`,
    );
    cmd.option(
      '--persona <name|id>',
      'Reassign the skill to another persona, by persona name or UUID (resolved before the API call). A skill always requires a persona: "none" is NOT accepted here.',
    );
    cmd.option(
      '--prompt <text>',
      'REPLACE the ENTIRE skill prompt (markdown body) with this inline text. For long content prefer --prompt-file. Mutually exclusive with --prompt-file.',
    );
    cmd.option(
      '--prompt-file <path|->',
      'REPLACE the ENTIRE skill prompt (markdown body) with the contents of a file. Use "-" to read from stdin. Mutually exclusive with --prompt.',
    );
    cmd.option(
      '--command-name <name>',
      'Rename the slash command (invoked as /<command-name>). Existing references to the old name are NOT rewritten — a warning is printed.',
    );
    cmd.option('--name <text>', 'Set the internal skill name');
    cmd.option('--display-name <text>', 'Set the display name (human-facing label shown in the UI)');
    cmd.option('--enable', 'Enable the skill. Mutually exclusive with --disable.');
    cmd.option(
      '--disable',
      'Disable the skill (it stops being offered to agents). Mutually exclusive with --enable.',
    );
    cmd.option('--dry-run', 'Print the exact PATCH payload as JSON and exit WITHOUT writing anything.');
  },
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex skill update review --prompt-file /tmp/prompt.md
  ${DIM('$')} fleex skill update review --persona builder
  ${DIM('$')} fleex skill update review --disable --dry-run

${SECTION('Notes:')}
  At most ONE flag may read from stdin ("-") per invocation.
  Recommended agent workflow: 'fleex skill show <skill> --json' first (backup), then update.
`,
  action: async (arg: string, opts: UpdateOptions) => {
    assertInlineFileExclusive('prompt', opts.prompt, opts.promptFile);
    const enabled = resolveEnabledFlags(opts.enable, opts.disable);

    const hasAnyFlag =
      opts.persona !== undefined ||
      opts.prompt !== undefined ||
      opts.promptFile !== undefined ||
      opts.commandName !== undefined ||
      opts.name !== undefined ||
      opts.displayName !== undefined ||
      enabled !== undefined;
    if (!hasAnyFlag) dieNoUpdates('skill');

    // Fetch just before write.
    const skills = await fetchSkills();
    const s = resolveFromList(arg, skills, skillHandleName, (x) => x.displayName);
    if (!s) die(`Skill not found: ${arg}`);

    let personaId: string | undefined;
    if (opts.persona !== undefined) {
      const personas = await fetchPersonas();
      const p = resolveFromList(opts.persona, personas, personaHandleName, (x) => x.displayName);
      if (!p) die(`Persona "${opts.persona}" not found. Run 'fleex agent list' to see available personas.`);
      personaId = p.id;
    }

    const markdownContent = await readTextInput(opts.prompt, opts.promptFile);

    const body: Record<string, unknown> = {};
    if (personaId !== undefined) body.personaId = personaId;
    if (markdownContent !== undefined) body.markdownContent = markdownContent;
    if (opts.commandName !== undefined) body.commandName = opts.commandName;
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.displayName !== undefined) body.displayName = opts.displayName;
    if (enabled !== undefined) body.enabled = enabled;

    if (opts.dryRun) {
      present(body, () => printJson(body));
      return;
    }

    const oldCommandName = s.commandName;
    const updated = await apiPatch<Skill>(`${apiBase()}/api/skills/${s.id}`, body);
    if (opts.commandName !== undefined && opts.commandName !== oldCommandName && !isJsonMode()) {
      warn(
        `Warning: renamed "${oldCommandName}" → "${opts.commandName}". Existing @skill:${oldCommandName} references are NOT rewritten and will no longer resolve.`,
      );
    }
    const fields = Object.keys(body).join(', ');
    present(updated, () => ok(`skill "${updated.commandName}" updated (${fields})`));
  },
};

export default def;
