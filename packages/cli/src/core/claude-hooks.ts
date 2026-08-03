/**
 * Install / check Claude Code hooks so they call `fleex hook <event>`.
 *
 * The hook config lives in `~/.claude/settings.json` (global to all Claude Code
 * sessions). We merge our entries non-destructively: any existing user/3rd-party
 * hook entries are preserved, and the operation is idempotent — re-running it
 * does not duplicate Fleex entries.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/**
 * Claude Code hook event names (PascalCase, as accepted by Claude Code) and
 * the corresponding `fleex hook <arg>` value (camelCase, as accepted by our
 * route — matches `HookEventType` in `@fleex/shared`).
 */
export const HOOKS_TO_INSTALL: ReadonlyArray<{ claudeEvent: string; fleexArg: string }> = [
  { claudeEvent: 'SessionStart', fleexArg: 'sessionStart' },
  { claudeEvent: 'SessionEnd', fleexArg: 'sessionEnd' },
  { claudeEvent: 'UserPromptSubmit', fleexArg: 'userPromptSubmit' },
  { claudeEvent: 'Notification', fleexArg: 'notification' },
  { claudeEvent: 'Stop', fleexArg: 'stop' },
  { claudeEvent: 'StopFailure', fleexArg: 'stopFailure' },
  { claudeEvent: 'PreToolUse', fleexArg: 'preToolUse' },
];

interface HookCommand {
  type: string;
  command: string;
}

interface HookEntry {
  hooks?: HookCommand[];
  matcher?: string;
}

interface SettingsShape {
  hooks?: Record<string, HookEntry[]>;
  [k: string]: unknown;
}

/** Returns the absolute path to the installed `fleex` binary, with a graceful fallback. */
function fleexBinPath(): string {
  const homeFleex = path.join(os.homedir(), '.fleex', 'bin', 'fleex');
  if (fs.existsSync(homeFleex)) return homeFleex;
  // Fallback — relies on $PATH. The doctor command warns separately if `fleex`
  // is not on $PATH for the shell that spawns Claude Code.
  return 'fleex';
}

function isFleexHookCommand(cmd: string | undefined): boolean {
  if (!cmd) return false;
  return /(^|\s|\/)fleex\s+hook\s/.test(cmd);
}

function readSettings(): { settings: SettingsShape; corrupted: boolean } {
  if (!fs.existsSync(SETTINGS_PATH)) return { settings: {}, corrupted: false };
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return { settings: parsed && typeof parsed === 'object' ? parsed : {}, corrupted: false };
  } catch {
    return { settings: {}, corrupted: true };
  }
}

export interface HookCheckResult {
  ok: boolean;
  /** PascalCase Claude Code event names that are not wired to `fleex hook`. */
  missing: string[];
  /** True when settings.json exists but cannot be parsed (JSON broken). */
  settingsCorrupted: boolean;
}

export function checkClaudeHooks(): HookCheckResult {
  const { settings, corrupted } = readSettings();
  if (corrupted) {
    return {
      ok: false,
      missing: HOOKS_TO_INSTALL.map((h) => h.claudeEvent),
      settingsCorrupted: true,
    };
  }
  const hooks = settings.hooks ?? {};
  const missing: string[] = [];
  for (const { claudeEvent } of HOOKS_TO_INSTALL) {
    const list = hooks[claudeEvent] ?? [];
    const found = list.some((entry) =>
      (entry.hooks ?? []).some((h) => isFleexHookCommand(h.command)),
    );
    if (!found) missing.push(claudeEvent);
  }
  return { ok: missing.length === 0, missing, settingsCorrupted: false };
}

export interface HookInstallResult {
  installed: string[];
  /** Path to backup if the original settings.json was JSON-corrupted. */
  backupPath?: string;
  /** Path of the touched file (for friendlier console output). */
  settingsPath: string;
}

export function installClaudeHooks(): HookInstallResult {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let settings: SettingsShape = {};
  let backupPath: string | undefined;

  if (fs.existsSync(SETTINGS_PATH)) {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      settings = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      // Preserve the corrupted file before overwriting.
      backupPath = `${SETTINGS_PATH}.fleex-backup-${Date.now()}`;
      fs.writeFileSync(backupPath, raw);
      settings = {};
    }
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};

  const bin = fleexBinPath();
  const installed: string[] = [];

  for (const { claudeEvent, fleexArg } of HOOKS_TO_INSTALL) {
    const list = (settings.hooks[claudeEvent] ?? []) as HookEntry[];
    // Idempotency: drop any existing Fleex entries before reinserting the canonical one.
    const cleaned = list.filter(
      (entry) => !(entry.hooks ?? []).some((h) => isFleexHookCommand(h.command)),
    );
    cleaned.push({
      hooks: [{ type: 'command', command: `${bin} hook ${fleexArg} || true` }],
    });
    settings.hooks[claudeEvent] = cleaned;
    installed.push(claudeEvent);
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return { installed, backupPath, settingsPath: SETTINGS_PATH };
}
