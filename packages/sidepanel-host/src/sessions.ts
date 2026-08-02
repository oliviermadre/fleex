/**
 * Persistent multi-session store for the side panel companion.
 *
 * Each conversation is a Session persisted to disk under
 * `~/.fleex/.sidepanel/sessions/<id>.json`, so sessions survive a companion
 * restart or dev hot-reload (in-memory-only state would be wiped). The store
 * keeps both the Anthropic `messages` (for the LLM) and a `transcript` (UI
 * items) so a session can be re-rendered verbatim when the user switches to it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';

export type SessionStatus = 'idle' | 'working' | 'awaiting_input';

/** A rendered transcript entry — enough to rebuild the chat view on switch. */
export type TranscriptItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | {
      tool: {
        name: string;
        argv: string[];
        status: 'running' | 'ok' | 'fail' | 'denied';
        text?: string;
        /** Ran without a confirmation round-trip (conversation allowlist). */
        autoApproved?: boolean;
      };
    };

/**
 * Auto-approval of mutating tools, scoped to a single conversation.
 *
 * Consent never leaves the conversation that granted it: a new session always
 * starts empty (see `create`), and it is wiped as soon as untrusted web-page
 * content is attached (the prompt-injection vector the confirmation gate exists
 * for — see `server.ts`, `page` handler).
 */
export interface AutoApprove {
  /** true = every mutating tool runs without confirmation in this conversation. */
  all: boolean;
  /** Explicitly allowed tool names (e.g. 'fleex_ticket_create'). */
  tools: string[];
}

/** A fresh, disarmed state. A factory, not a shared const: `tools` is mutated
 *  in place by `allowTool`, so every session needs its own array. */
export function noAutoApprove(): AutoApprove {
  return { all: false, tools: [] };
}

/** True when this tool may run without a confirmation round-trip. */
export function isToolAutoApproved(aa: AutoApprove | undefined, toolName: string): boolean {
  if (!aa) return false;
  return aa.all || aa.tools.includes(toolName);
}

/** True when the conversation has any auto-approval armed. */
export function isAutoApproveActive(aa: AutoApprove | undefined): boolean {
  return Boolean(aa && (aa.all || aa.tools.length > 0));
}

export interface SessionData {
  id: string;
  title: string;
  workspace?: string;
  /** Anthropic model id for this conversation; falls back to the host default. */
  model?: string;
  status: SessionStatus;
  createdAt: string;
  /** Timestamp of the last user/assistant message (absent on legacy sessions). */
  lastMessageAt?: string;
  messages: Anthropic.MessageParam[];
  transcript: TranscriptItem[];
  /** Absent on sessions persisted by an older companion. */
  autoApprove?: AutoApprove;
}

/** Lightweight projection sent to the side panel for the session list. */
export interface SessionSummary {
  id: string;
  title: string;
  workspace?: string;
  model?: string;
  status: SessionStatus;
  messageCount: number;
  createdAt: string;
  /** Last user/assistant message time; falls back to createdAt for legacy sessions. */
  lastMessageAt: string;
  /** Always defined client-side, even for sessions persisted before the field existed. */
  autoApprove: AutoApprove;
}

const DEFAULT_TITLE = 'New conversation';

function defaultDir(): string {
  const home = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
  return path.join(home, '.sidepanel', 'sessions');
}

export function messageCount(s: SessionData): number {
  return s.transcript.filter((i) => 'role' in i).length;
}

export function toSummary(s: SessionData): SessionSummary {
  return {
    id: s.id,
    title: s.title,
    ...(s.workspace ? { workspace: s.workspace } : {}),
    ...(s.model ? { model: s.model } : {}),
    status: s.status,
    messageCount: messageCount(s),
    createdAt: s.createdAt,
    lastMessageAt: s.lastMessageAt ?? s.createdAt,
    autoApprove: s.autoApprove ?? noAutoApprove(),
  };
}

export class SessionStore {
  private dir: string;
  private sessions = new Map<string, SessionData>();

  constructor(dir?: string) {
    this.dir = dir ?? defaultDir();
    fs.mkdirSync(this.dir, { recursive: true });
    this.hydrate();
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private hydrate(): void {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir).filter((n) => n.endsWith('.json'));
    } catch {
      return;
    }
    for (const name of names) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')) as SessionData;
        if (!s || typeof s.id !== 'string') continue;
        // Any run was interrupted by the restart — nothing is in flight now.
        s.status = 'idle';
        s.messages ??= [];
        s.transcript ??= [];
        s.autoApprove ??= noAutoApprove();
        this.sessions.set(s.id, s);
      } catch {
        // skip corrupt file
      }
    }
  }

  /** Persist one session to disk (best-effort). */
  save(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    try {
      fs.writeFileSync(this.file(id), JSON.stringify(s));
    } catch {
      // disk failure is non-fatal for the live session
    }
  }

  get(id: string): SessionData | undefined {
    return this.sessions.get(id);
  }

  /** Newest first. Reversing insertion order first makes the stable sort
   *  break createdAt ties (same-millisecond creates) by newest-inserted-first. */
  list(): SessionSummary[] {
    return [...this.sessions.values()]
      .reverse()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toSummary);
  }

  create(opts: { workspace?: string; title?: string; model?: string } = {}): SessionData {
    const s: SessionData = {
      id: randomUUID(),
      title: opts.title?.trim() || DEFAULT_TITLE,
      ...(opts.workspace ? { workspace: opts.workspace } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      status: 'idle',
      createdAt: new Date().toISOString(),
      messages: [],
      transcript: [],
      // Consent is never inherited: a fresh conversation re-earns it.
      autoApprove: noAutoApprove(),
    };
    this.sessions.set(s.id, s);
    this.save(s.id);
    return s;
  }

  delete(id: string): boolean {
    if (!this.sessions.delete(id)) return false;
    try {
      fs.rmSync(this.file(id), { force: true });
    } catch {
      // ignore
    }
    return true;
  }

  rename(id: string, title: string): SessionData | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.title = title.trim() || DEFAULT_TITLE;
    this.save(id);
    return s;
  }

  setStatus(id: string, status: SessionStatus): void {
    const s = this.sessions.get(id);
    if (!s || s.status === status) return;
    s.status = status;
    this.save(id);
  }

  /**
   * Replace the conversation's auto-approval state (full replacement, so the
   * caller never has to reason about a partial patch).
   *
   * Mutates the live SessionData the running turn holds a reference to — that
   * is what makes a mid-turn "always allow" cover the remaining tool calls of
   * the *same* turn without another round-trip.
   */
  setAutoApprove(id: string, next: AutoApprove): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.autoApprove = { all: next.all, tools: [...new Set(next.tools)] };
    this.save(id);
  }

  /** Add one tool name to the conversation's allowlist (no-op if redundant). */
  allowTool(id: string, toolName: string): void {
    const s = this.sessions.get(id);
    if (!s || !toolName) return;
    s.autoApprove ??= noAutoApprove();
    if (s.autoApprove.all || s.autoApprove.tools.includes(toolName)) return;
    s.autoApprove.tools.push(toolName);
    this.save(id);
  }

  /** Disarm every auto-approval for this conversation. */
  clearAutoApprove(id: string): void {
    this.setAutoApprove(id, noAutoApprove());
  }

  /** Stamp the last-message time (called when a user/assistant item lands). */
  touchMessage(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.lastMessageAt = new Date().toISOString();
    this.save(id);
  }

  /** Set the title from the first user message if it's still the default. */
  maybeTitleFrom(id: string, text: string): void {
    const s = this.sessions.get(id);
    if (!s || s.title !== DEFAULT_TITLE) return;
    const t = text.trim().replace(/\s+/g, ' ');
    if (t) {
      s.title = t.length > 60 ? t.slice(0, 60) + '…' : t;
      this.save(id);
    }
  }
}
