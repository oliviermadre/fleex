import type { Command } from 'commander';

/**
 * What a command does to the world, at its most strict mode (a command whose
 * `--documentation` flag only reads but whose normal mode writes is `write`).
 *
 * - `read`        — no side effect: lists, shows, searches, status.
 * - `write`       — changes local state, remote data or files.
 * - `destructive` — deletes data.
 *
 * The single source every surface reads (MCP `readOnlyHint`/`destructiveHint`,
 * `fleex documentation --format json`, the assistant's badges). Required on
 * every leaf so a new command cannot ship without saying whether it writes.
 */
export type CommandAccess = 'read' | 'write' | 'destructive';

interface CommandDefBase {
  name: string;
  aliases?: string[];
  description: string;
  /** Configure options/arguments on the Commander instance. */
  setup?: (cmd: Command) => void;
  /** Action handler. Receives parsed args from Commander. */
  action: (...args: any[]) => void | Promise<void>;
  /**
   * Extra help content rendered after the auto-generated sections. Use it
   * for Examples, valid value enums, free-form notes — anything Commander
   * can't infer from options/arguments. Returned string is appended verbatim
   * (it should include its own newlines and section title formatting).
   */
  extraHelp?: string | (() => string);
  /**
   * If true, the bootstrap adds a `--workspace <name>` option to this command
   * plus a preAction hook that activates the named workspace before the action
   * runs (so the resolved instance is `workspace@branch`). Use for any command
   * that resolves the current instance — ticket/epic/import/export/logs/doctor/
   * stop/remove. Without the flag, `resolveInstance()` falls back to an ambient
   * `FLEEX_WORKSPACE` env var and then to the default workspace, so this only
   * adds the explicit override.
   */
  workspaceAware?: boolean;
}

/** A group whose default action prints help: it never runs anything itself. */
export interface ParentCommandDef extends CommandDefBase {
  isParent: true;
  access?: never;
}

/** A runnable command. `access` is mandatory: see `CommandAccess`. */
export interface LeafCommandDef extends CommandDefBase {
  /**
   * Set to false to register a standalone leaf command that also acts as a
   * parent (it keeps its own action while hosting subcommand folders).
   */
  isParent?: false;
  access: CommandAccess;
}

/**
 * Each command file under src/commands/<name>/index.ts must export a CommandDef
 * as default export. The bootstrap will auto-register it based on its folder
 * path.
 *
 * `isParent: true` — if this command file is in a parent folder that contains
 * subcommand folders (e.g. ticket/index.ts), the command is only registered as
 * a parent group whose default action prints help.
 */
export type CommandDef = ParentCommandDef | LeafCommandDef;
