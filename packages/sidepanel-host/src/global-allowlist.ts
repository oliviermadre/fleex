/**
 * Machine-wide, persistent allowlist of auto-approved mutating tools.
 *
 * Stored at `~/.fleex/.sidepanel/auto-approve.json` (FLEEX_HOME aware, like
 * `SessionStore`), so "Toujours autoriser « ticket create »" survives a new
 * conversation and a companion restart — the whole point of the button.
 *
 * Why machine-wide rather than per-conversation: allowing a *kind of action*
 * ("I trust `ticket create`") is not a contextual decision, so re-asking in
 * every new conversation is pure noise. Allowing *everything*
 * (`always: 'session'`) IS contextual and stays scoped to its conversation.
 *
 * The prompt-injection guard is preserved elsewhere: a conversation that has
 * ingested untrusted web-page content is marked `pageTainted` and never reads
 * this list (see `resolveAutoApproved`).
 *
 * INVARIANT: keys are always the canonical tool name (`fleex_*`) taken from
 * server-side pending-confirm state. Never a display label, never normalised.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE_VERSION = 1;

interface AllowlistFile {
  version: number;
  tools: string[];
}

function defaultDir(): string {
  const home = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
  return path.join(home, '.sidepanel');
}

export class GlobalAllowlist {
  private file: string;
  private tools = new Set<string>();

  constructor(dir?: string) {
    const base = dir ?? defaultDir();
    this.file = path.join(base, 'auto-approve.json');
    try {
      fs.mkdirSync(base, { recursive: true });
    } catch {
      // read-only home: the list stays in-memory for this process
    }
    this.hydrate();
  }

  /** A missing or corrupt file means "nothing allowed" — never a crash, and
   *  never an accidental grant. */
  private hydrate(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as AllowlistFile;
      if (!Array.isArray(raw?.tools)) return;
      for (const t of raw.tools) if (typeof t === 'string' && t) this.tools.add(t);
    } catch {
      // absent or unreadable → empty
    }
  }

  /** Atomic write: a truncated file must never be readable as a partial grant. */
  private persist(): void {
    const payload: AllowlistFile = { version: FILE_VERSION, tools: this.list() };
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.file);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /** Idempotent; persists immediately so a crash can't lose the grant. */
  allow(toolName: string): void {
    if (!toolName || this.tools.has(toolName)) return;
    this.tools.add(toolName);
    this.persist();
  }

  revoke(toolName: string): void {
    if (!this.tools.delete(toolName)) return;
    this.persist();
  }

  clear(): void {
    if (this.tools.size === 0) return;
    this.tools.clear();
    this.persist();
  }

  /** Sorted, so the Settings list is stable across renders. */
  list(): string[] {
    return [...this.tools].sort();
  }
}
