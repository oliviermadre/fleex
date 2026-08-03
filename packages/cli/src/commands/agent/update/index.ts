/**
 * `fleex agent update` — PATCH an agent persona.
 *
 * The primary consumer is an LLM agent that discovers this command through
 * `fleex documentation`, so every description string below is normative
 * (spec §4.1) and self-contained: the flag description is the only source of
 * truth the agent sees. Do not reword casually — tests lock the wording.
 */
import chalk from 'chalk';

import {
  fetchPersonas,
  personaHandleName,
  printJson,
  resolveFromList,
  type Persona,
} from '../../../core/agentic.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import { ok, die, warn, present, isJsonMode } from '../../../core/colors.ts';
import {
  appendMemory,
  assertInlineFileExclusive,
  assertMemoryFlagsExclusive,
  assertSingleStdin,
  assertValidExecutionMode,
  dieNoUpdates,
  noneToNull,
  readTextInput,
} from '../../../core/update-helpers.ts';

import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

interface UpdateOptions {
  displayName?: string;
  name?: string;
  model?: string;
  executionMode?: string;
  humanMention?: string;
  soul?: string;
  soulFile?: string;
  identity?: string;
  identityFile?: string;
  memory?: string;
  memoryFile?: string;
  memoryAppend?: string;
  memoryAppendFile?: string;
  dryRun?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  description:
    'Update an agent persona. PATCH semantics: ONLY the fields whose flags you pass are changed — every omitted flag leaves its field untouched. Text fields (soul/identity/memory) are REPLACED in full unless you use --memory-append.',
  setup(cmd) {
    cmd.argument(
      '<agent>',
      `Persona to update: exact name (e.g. "catalyst") or UUID, as shown by 'fleex agent list'`,
    );
    cmd.option(
      '--display-name <text>',
      'Set the display name (human-facing label shown in the UI)',
    );
    cmd.option(
      '--name <name>',
      `Rename the persona's machine name, used in @agent:<name> mentions. Existing mentions are NOT rewritten and will stop resolving — a warning is printed.`,
    );
    cmd.option(
      '--model <model>',
      'Set the model id (e.g. claude-sonnet-4-5). Passed through as-is; the CLI does not validate model ids.',
    );
    cmd.option(
      '--execution-mode <mode>',
      'Set the execution mode. Allowed values: claude_code | message. Any other value fails before any API call.',
    );
    cmd.option(
      '--human-mention <name|none>',
      'Set the human mention name. Pass the literal word "none" to clear it (stores null).',
    );
    cmd.option(
      '--soul <text>',
      'REPLACE the ENTIRE soul (SOUL.md) with this inline text. For long content prefer --soul-file. Mutually exclusive with --soul-file.',
    );
    cmd.option(
      '--soul-file <path|->',
      'REPLACE the ENTIRE soul (SOUL.md) with the contents of a file. Use "-" to read from stdin. Mutually exclusive with --soul.',
    );
    cmd.option(
      '--identity <text>',
      'REPLACE the ENTIRE identity (IDENTITY.md) with this inline text. Mutually exclusive with --identity-file.',
    );
    cmd.option(
      '--identity-file <path|->',
      'REPLACE the ENTIRE identity (IDENTITY.md) with the contents of a file. Use "-" for stdin. Mutually exclusive with --identity.',
    );
    cmd.option(
      '--memory <text>',
      'REPLACE the ENTIRE memory (MEMORY.md), erasing existing content. To add WITHOUT erasing, use --memory-append instead. Mutually exclusive with --memory-file, --memory-append and --memory-append-file.',
    );
    cmd.option(
      '--memory-file <path|->',
      'REPLACE the ENTIRE memory with the contents of a file ("-" for stdin). Erases existing content — to add without erasing use --memory-append-file. Mutually exclusive with --memory and both --memory-append flags.',
    );
    cmd.option(
      '--memory-append <text>',
      'APPEND this text to the existing memory (adds a blank line then the text at the end; never erases anything). Mutually exclusive with --memory, --memory-file and --memory-append-file.',
    );
    cmd.option(
      '--memory-append-file <path|->',
      'APPEND the contents of a file to the existing memory ("-" for stdin). Never erases. Mutually exclusive with --memory, --memory-file and --memory-append.',
    );
    cmd.option(
      '--dry-run',
      'Print the exact PATCH payload as JSON and exit WITHOUT writing anything. Use it to verify a change before applying it.',
    );
  },
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex agent update catalyst --model claude-opus-4-6
  ${DIM('$')} fleex agent update catalyst --soul-file /tmp/soul.md --dry-run
  ${DIM('$')} cat notes.md | fleex agent update catalyst --memory-append-file -
  ${DIM('$')} fleex agent update catalyst --human-mention none

${SECTION('Notes:')}
  At most ONE flag may read from stdin ("-") per invocation.
  Recommended agent workflow: 'fleex agent show <agent> --json' first (backup), then update.
`,
  action: async (arg: string, opts: UpdateOptions) => {
    if (opts.executionMode !== undefined) assertValidExecutionMode(opts.executionMode);
    assertInlineFileExclusive('soul', opts.soul, opts.soulFile);
    assertInlineFileExclusive('identity', opts.identity, opts.identityFile);
    assertMemoryFlagsExclusive(opts);
    assertSingleStdin([
      { flag: '--soul-file', value: opts.soulFile },
      { flag: '--identity-file', value: opts.identityFile },
      { flag: '--memory-file', value: opts.memoryFile },
      { flag: '--memory-append-file', value: opts.memoryAppendFile },
    ]);

    const hasAnyFlag =
      opts.displayName !== undefined ||
      opts.name !== undefined ||
      opts.model !== undefined ||
      opts.executionMode !== undefined ||
      opts.humanMention !== undefined ||
      opts.soul !== undefined ||
      opts.soulFile !== undefined ||
      opts.identity !== undefined ||
      opts.identityFile !== undefined ||
      opts.memory !== undefined ||
      opts.memoryFile !== undefined ||
      opts.memoryAppend !== undefined ||
      opts.memoryAppendFile !== undefined;
    if (!hasAnyFlag) dieNoUpdates('agent');

    // Fetch just before write (fresh state for resolution and memory-append).
    const personas = await fetchPersonas();
    const p = resolveFromList(arg, personas, personaHandleName, (x) => x.displayName);
    if (!p) die(`Agent not found: ${arg}`);

    const soulMd = await readTextInput(opts.soul, opts.soulFile);
    const identityMd = await readTextInput(opts.identity, opts.identityFile);
    const memoryMd = await readTextInput(opts.memory, opts.memoryFile);
    const memoryAddition = await readTextInput(opts.memoryAppend, opts.memoryAppendFile);

    const body: Record<string, unknown> = {};
    if (opts.displayName !== undefined) body.displayName = opts.displayName;
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.model !== undefined) body.model = opts.model;
    if (opts.executionMode !== undefined) body.executionMode = opts.executionMode;
    if (opts.humanMention !== undefined) body.humanMentionName = noneToNull(opts.humanMention);
    if (soulMd !== undefined) body.soulMd = soulMd;
    if (identityMd !== undefined) body.identityMd = identityMd;
    if (memoryMd !== undefined) body.memoryMd = memoryMd;
    if (memoryAddition !== undefined) body.memoryMd = appendMemory(p.memoryMd, memoryAddition);

    if (opts.dryRun) {
      present(body, () => printJson(body));
      return;
    }

    const oldName = p.name;
    const updated = await apiPatch<Persona>(`${apiBase()}/api/personas/${p.id}`, body);
    if (opts.name !== undefined && opts.name !== oldName && !isJsonMode()) {
      warn(
        `Warning: renamed "${oldName}" → "${opts.name}". Existing @agent:${oldName} mentions are NOT rewritten and will no longer resolve.`,
      );
    }
    const fields = Object.keys(body).join(', ');
    present(updated, () => ok(`agent "${updated.name}" updated (${fields})`));
  },
};

export default def;
