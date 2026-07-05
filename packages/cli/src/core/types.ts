import type { Command } from 'commander';

/**
 * Each command file under src/commands/<name>/index.ts must export a CommandDef
 * as default export. The bootstrap will auto-register it based on its folder
 * path.
 */
export interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  /** Configure options/arguments on the Commander instance. */
  setup?: (cmd: Command) => void;
  /** Action handler. Receives parsed args from Commander. */
  action: (...args: any[]) => void | Promise<void>;
  /**
   * If true and this command file is in a parent folder that contains
   * subcommand folders (e.g. ticket/index.ts), the command will only be
   * registered as a parent group whose default action prints help.
   * Set to false to register a standalone leaf command that also acts as
   * a parent.
   */
  isParent?: boolean;
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
