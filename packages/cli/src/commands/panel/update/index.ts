/**
 * `fleex panel update` — PATCH a panel.
 *
 * The primary consumer is an LLM agent that discovers this command through
 * `fleex documentation`, so every description string below is normative
 * (spec §4.3) and self-contained: the flag description is the only source of
 * truth the agent sees. Do not reword casually — tests lock the wording.
 *
 * Member edits are incremental: the current members are fetched, the
 * add/rm/set-model/reorder edits are merged client-side (see
 * `applyMemberEdits`), and the full `members[]` array is sent in the PATCH.
 */
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { ok, die, warn, present, isJsonMode } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import {
  fetchPanels,
  fetchPersonas,
  panelHandleName,
  personaHandleName,
  printJson,
  resolveFromList,
  type Panel,
  type Persona,
} from '../../../core/agentic.ts';
import {
  accumulate,
  applyMemberEdits,
  assertInlineFileExclusive,
  assertValidExecutionMode,
  dieNoUpdates,
  noneToNull,
  parsePersonaModelSpec,
  readTextInput,
  resolveEnabledFlags,
  type MemberAdd,
  type MemberRef,
  type MemberSetModel,
  type PanelMemberLike,
} from '../../../core/update-helpers.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

interface UpdateOptions {
  displayName?: string;
  name?: string;
  description?: string;
  executionMode?: string;
  addMember?: string[];
  rmMember?: string[];
  setMemberModel?: string[];
  memberOrder?: string;
  orchestratorPrompt?: string;
  orchestratorPromptFile?: string;
  orchestratorModel?: string;
  orchestratorPersona?: string;
  defaultMemberModel?: string;
  enable?: boolean;
  disable?: boolean;
  dryRun?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  description:
    'Update a panel. PATCH semantics: ONLY the fields whose flags you pass are changed. Member edits are incremental (--add-member/--rm-member/--set-member-model) — you never resend the full member list except with --member-order.',
  setup(cmd) {
    cmd.argument('<panel>', `Panel to update: exact name or UUID, as shown by 'fleex panel list'`);
    cmd.option('--display-name <text>', 'Set the display name (human-facing label shown in the UI)');
    cmd.option(
      '--name <name>',
      `Rename the panel's machine name. Existing references to the old name are NOT rewritten — a warning is printed.`,
    );
    cmd.option('--description <text>', 'Set the panel description. Pass "" (empty string) to clear it.');
    cmd.option(
      '--execution-mode <mode>',
      'Set the execution mode. Allowed values: claude_code | message. Any other value fails before any API call.',
    );
    cmd.option(
      '--add-member <persona[:model]>',
      'Add a member to the panel: persona name or UUID, optionally followed by ":<model>" to set a model override (e.g. "catalyst:claude-opus-4-6"). Repeatable; new members are appended in the order given. Fails if the persona is already a member — use --set-member-model to change an existing member\'s model.',
      accumulate,
      [] as string[],
    );
    cmd.option(
      '--rm-member <persona>',
      'Remove a member (persona name or UUID). Repeatable. Refuses to remove the LAST remaining member — add a replacement first.',
      accumulate,
      [] as string[],
    );
    cmd.option(
      '--set-member-model <persona:model|persona:inherited>',
      'Change the model override of an EXISTING member. Format "<persona>:<model>". Use "<persona>:inherited" to remove the override so the member inherits the panel\'s default member model. Repeatable. Fails if the persona is not a member.',
      accumulate,
      [] as string[],
    );
    cmd.option(
      '--member-order <p1,p2,...>',
      'Reorder members: comma-separated persona names/UUIDs that MUST contain every current member exactly once (no additions or omissions).',
    );
    cmd.option(
      '--orchestrator-prompt <text>',
      'REPLACE the ENTIRE orchestrator prompt with this inline text. Mutually exclusive with --orchestrator-prompt-file.',
    );
    cmd.option(
      '--orchestrator-prompt-file <path|->',
      'REPLACE the ENTIRE orchestrator prompt with the contents of a file ("-" for stdin). Mutually exclusive with --orchestrator-prompt.',
    );
    cmd.option(
      '--orchestrator-model <model>',
      `Set the orchestrator's model id. Passed through as-is (not validated by the CLI).`,
    );
    cmd.option(
      '--orchestrator-persona <name|id|none>',
      'Set which persona embodies the orchestrator (name or UUID). Pass the literal word "none" to detach it (prompt-only orchestrator, stores null).',
    );
    cmd.option(
      '--default-member-model <model>',
      'Set the default model inherited by members that have no per-member override.',
    );
    cmd.option('--enable', 'Enable the panel. Mutually exclusive with --disable.');
    cmd.option('--disable', 'Disable the panel. Mutually exclusive with --enable.');
    cmd.option('--dry-run', 'Print the exact PATCH payload as JSON and exit WITHOUT writing anything.');
  },
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex panel update design-crew --add-member catalyst:claude-opus-4-6
  ${DIM('$')} fleex panel update design-crew --rm-member reviewer --add-member builder
  ${DIM('$')} fleex panel update design-crew --set-member-model catalyst:inherited
  ${DIM('$')} fleex panel update design-crew --member-order builder,catalyst,reviewer
  ${DIM('$')} fleex panel update design-crew --orchestrator-persona none

${SECTION('Notes:')}
  At most ONE flag may read from stdin ("-") per invocation.
  Recommended agent workflow: 'fleex panel show <panel> --json' first (backup), then update.
`,
  action: async (arg: string, opts: UpdateOptions) => {
    if (opts.executionMode !== undefined) assertValidExecutionMode(opts.executionMode);
    assertInlineFileExclusive('orchestrator-prompt', opts.orchestratorPrompt, opts.orchestratorPromptFile);
    const enabled = resolveEnabledFlags(opts.enable, opts.disable);

    const addMembers = opts.addMember ?? [];
    const rmMembers = opts.rmMember ?? [];
    const setMemberModels = opts.setMemberModel ?? [];
    const hasMemberOps =
      addMembers.length > 0 ||
      rmMembers.length > 0 ||
      setMemberModels.length > 0 ||
      opts.memberOrder !== undefined;

    const hasAnyFlag =
      opts.displayName !== undefined ||
      opts.name !== undefined ||
      opts.description !== undefined ||
      opts.executionMode !== undefined ||
      opts.orchestratorPrompt !== undefined ||
      opts.orchestratorPromptFile !== undefined ||
      opts.orchestratorModel !== undefined ||
      opts.orchestratorPersona !== undefined ||
      opts.defaultMemberModel !== undefined ||
      enabled !== undefined ||
      hasMemberOps;
    if (!hasAnyFlag) dieNoUpdates('panel');

    // Fetch just before write.
    const panels = await fetchPanels();
    const p = resolveFromList(arg, panels, panelHandleName, (x) => x.displayName);
    if (!p) die(`Panel not found: ${arg}`);

    // Resolve persona refs (members + orchestrator) client-side.
    const needPersonas =
      hasMemberOps || (opts.orchestratorPersona !== undefined && opts.orchestratorPersona !== 'none');
    let personas: Persona[] = [];
    if (needPersonas) personas = await fetchPersonas();
    const resolvePersona = (ref: string): Persona => {
      const persona = resolveFromList(ref, personas, personaHandleName, (x) => x.displayName);
      if (!persona) die(`Persona "${ref}" not found. Run 'fleex agent list' to see available personas.`);
      return persona;
    };

    const orchestratorPersonaId =
      opts.orchestratorPersona === undefined
        ? undefined
        : noneToNull(opts.orchestratorPersona) === null
          ? null
          : resolvePersona(opts.orchestratorPersona).id;

    const orchestratorPrompt = await readTextInput(opts.orchestratorPrompt, opts.orchestratorPromptFile);

    const body: Record<string, unknown> = {};
    if (opts.displayName !== undefined) body.displayName = opts.displayName;
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.executionMode !== undefined) body.executionMode = opts.executionMode;
    if (orchestratorPrompt !== undefined) body.orchestratorPrompt = orchestratorPrompt;
    if (opts.orchestratorModel !== undefined) body.orchestratorModel = opts.orchestratorModel;
    if (orchestratorPersonaId !== undefined) body.orchestratorPersonaId = orchestratorPersonaId;
    if (opts.defaultMemberModel !== undefined) body.defaultMemberModel = opts.defaultMemberModel;
    if (enabled !== undefined) body.enabled = enabled;

    if (hasMemberOps) {
      const nameById = new Map(personas.map((x) => [x.id, personaHandleName(x)]));
      const current: PanelMemberLike[] = (p.members ?? []).map((m, i) => ({
        personaId: m.personaId ?? '',
        order: m.order ?? i,
        modelOverride: m.modelOverride ?? 'inherited',
      }));
      const add: MemberAdd[] = addMembers.map((spec) => {
        const { personaRef, model } = parsePersonaModelSpec(spec);
        return { ref: personaRef, personaId: resolvePersona(personaRef).id, model };
      });
      const rm: MemberRef[] = rmMembers.map((ref) => ({ ref, personaId: resolvePersona(ref).id }));
      const setModel: MemberSetModel[] = setMemberModels.map((spec) => {
        const { personaRef, model } = parsePersonaModelSpec(spec);
        if (model === undefined) {
          die(
            `Invalid --set-member-model value "${spec}". Expected format "<persona>:<model>" (or "<persona>:inherited" to drop the override).`,
          );
        }
        return { ref: personaRef, personaId: resolvePersona(personaRef).id, model };
      });
      const order: MemberRef[] | undefined = opts.memberOrder
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((ref) => ({ ref, personaId: resolvePersona(ref).id }));

      body.members = applyMemberEdits(
        current,
        { add, rm, setModel, order },
        (personaId) => nameById.get(personaId) ?? personaId,
      );
    }

    if (opts.dryRun) {
      present(body, () => printJson(body));
      return;
    }

    const oldName = p.name;
    const updated = await apiPatch<Panel>(`${apiBase()}/api/panels/${p.id}`, body);
    if (opts.name !== undefined && opts.name !== oldName && !isJsonMode()) {
      warn(
        `Warning: renamed "${oldName}" → "${opts.name}". Existing @panel:${oldName} references are NOT rewritten and will no longer resolve.`,
      );
    }
    const fields = Object.keys(body).join(', ');
    present(updated, () => ok(`panel "${updated.name}" updated (${fields})`));
  },
};

export default def;
