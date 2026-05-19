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
}
