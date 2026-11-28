/**
 * Persistent multi-session store for the side panel companion.
 *
 * Each conversation is a Session persisted to disk under
 * `~/.fleex/.sidepanel/sessions/<id>.json`, so sessions survive a companion
 * restart or dev hot-reload (in-memory-only state would be wiped).
 *
 * The model's context lives in the Claude Agent SDK session (`sdkSessionId`,
 * resumed each turn). `transcript` holds the UI items so a conversation is
 * re-rendered verbatim when the user switches to it. `messages` (Messages API
 * format) is only read: it holds what the SDK session has not seen yet — the
 * history of a conversation from before the SDK, or an exchange recorded from
 * the command palette — and is handed over as a preamble on the next turn.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { Access } from './fleex-access.ts';
import type { ArtifactCard } from './artifacts.ts';
import type { ToolKind, ToolStatus } from './agent-turn.ts';

export type SessionStatus = 'idle' | 'working' | 'awaiting_input';

/** One tool call as the chat shows it. */
export interface ToolLine {
  /** tool_use id (absent on lines persisted before the SDK). */
  id?: string;
  name: string;
  /** Legacy (pre-SDK) lines: the fleex argv that ran. */
  argv?: string[];
  toolKind?: ToolKind;
  /** "outil · cible" — path, command, pattern, `server · tool`… */
  target?: string;
  /** Badge of a Bash line running `fleex` (display only). */
  access?: Access;
  /** A Write/Edit aimed outside the conversation folder. */
  outsideWorkDir?: boolean;
  /** Let through by "always allow outside writes" (⚡). */
  outsideAutoAllowed?: boolean;
  status: ToolStatus;
  text?: string;
  exitCode?: number;
  truncated?: boolean;
  /** Legacy: ran without a confirmation round-trip. */
  autoApproved?: boolean;
}

export type NoticeKind = 'max_turns' | 'continued' | 'legacy_resumed' | 'context_reloaded';

/** A rendered transcript entry — enough to rebuild the chat view on switch. */
export type TranscriptItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { tool: ToolLine }
  | { artifact: ArtifactCard & { turnId: string } }
  | { notice: NoticeKind; limit?: number };

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
  /** Read-only context the SDK session has not seen yet (see the file header). */
  messages: Anthropic.MessageParam[];
  /** How many of `messages` the SDK session already carries. */
  sdkContextUpTo?: number;
  transcript: TranscriptItem[];
  /** Claude Agent SDK session, resumed on every turn. */
  sdkSessionId?: string;
  /** Set on conversations created since the Assistant runs on the SDK. */
  engine?: 'sdk';
  /** The conversation folder, set on the first message (never before). */
  workDir?: string;
  /** "Always allow writes outside the folder" for this conversation only. */
  outsideWritesAllowed?: boolean;
  /** Pre-SDK field, ignored: its standing approvals do not carry over. */
  autoApprove?: unknown;
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
  workDir?: string;
  outsideWritesAllowed: boolean;
  /** A conversation from before the SDK that has not been resumed yet. */
  legacy: boolean;
}

const DEFAULT_TITLE = 'New conversation';

function defaultDir(): string {
  const home = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
  return path.join(home, '.sidepanel', 'sessions');
}

export function messageCount(s: SessionData): number {
  return s.transcript.filter((i) => 'role' in i).length;
}

/** Holds pre-SDK history and no SDK session yet: resumed with its text history (D8). */
export function isLegacy(s: SessionData): boolean {
  return s.engine !== 'sdk' && !s.sdkSessionId && s.messages.length > 0;
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
    ...(s.workDir ? { workDir: s.workDir } : {}),
    outsideWritesAllowed: s.outsideWritesAllowed === true,
    legacy: isLegacy(s),
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
        // Standing approvals from the pre-SDK confirmation gate never carry over.
        delete s.autoApprove;
        // A call running (or awaiting a confirmation) when the companion stopped
        // is lost: never replayed (P8).
        for (const item of s.transcript) {
          if ('tool' in item && item.tool.status === 'running') item.tool.status = 'interrupted';
        }
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

  create(opts: { workspace?: string; title?: string; model?: string; id?: string } = {}): SessionData {
    const s: SessionData = {
      // Caller-supplied only where a conversation has to be addressable before it
      // exists; everything else lets the store mint one.
      id: opts.id ?? randomUUID(),
      title: opts.title?.trim() || DEFAULT_TITLE,
      ...(opts.workspace ? { workspace: opts.workspace } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      status: 'idle',
      createdAt: new Date().toISOString(),
      messages: [],
      transcript: [],
      // Consent is never inherited: a fresh conversation re-earns it.
      outsideWritesAllowed: false,
      engine: 'sdk',
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
   * Turn "always allow writes outside the folder" on or off for one conversation.
   * Mutates the live SessionData a running turn reads, so a mid-turn "always"
   * covers the remaining writes of the same turn.
   */
  setOutsideWritesAllowed(id: string, allowed: boolean): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.outsideWritesAllowed = allowed;
    this.save(id);
    return true;
  }

  /** Stamp the last-message time (called when a user/assistant item lands). */
  touchMessage(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.lastMessageAt = new Date().toISOString();
    this.save(id);
  }

  /**
   * A conversation that starts with an exchange that already happened.
   *
   * Asking memory a question in the command palette is a complete exchange, and
   * continuing it used to mean retyping the question here and paying for the
   * retrieval twice. Seeded into `messages` as well as `transcript`, so the model
   * carries the exchange as real history rather than the reader merely seeing it.
   */
  recordExchange(opts: {
    /**
     * Conversation to append to, created under this id if it does not exist yet.
     *
     * Minted by the caller so a run of questions lands in one thread with no
     * round-trip and no state held here between them — the same reason the
     * command palette can record its second question before hearing back about
     * its first.
     */
    id: string;
    question: string;
    answer: string;
    workspace?: string;
    model?: string;
  }): SessionData {
    const existing = this.sessions.get(opts.id);
    const s = existing ?? this.create({
      id: opts.id,
      ...(opts.workspace ? { workspace: opts.workspace } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    });
    s.messages.push({ role: 'user', content: opts.question });
    s.messages.push({ role: 'assistant', content: opts.answer });
    s.transcript.push({ role: 'user', text: opts.question });
    s.transcript.push({ role: 'assistant', text: opts.answer });
    s.lastMessageAt = new Date().toISOString();
    this.save(s.id);
    // Only the first question names the thread; a follow-up joins it.
    this.maybeTitleFrom(s.id, opts.question);
    return s;
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
