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
  | { tool: { name: string; argv: string[]; status: 'running' | 'ok' | 'fail' | 'denied'; text?: string } };

export interface SessionData {
  id: string;
  title: string;
  workspace?: string;
  status: SessionStatus;
  createdAt: string;
  messages: Anthropic.MessageParam[];
  transcript: TranscriptItem[];
}

/** Lightweight projection sent to the side panel for the session list. */
export interface SessionSummary {
  id: string;
  title: string;
  workspace?: string;
  status: SessionStatus;
  messageCount: number;
  createdAt: string;
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
    status: s.status,
    messageCount: messageCount(s),
    createdAt: s.createdAt,
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

  /** Newest first. */
  list(): SessionSummary[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toSummary);
  }

  create(opts: { workspace?: string; title?: string } = {}): SessionData {
    const s: SessionData = {
      id: randomUUID(),
      title: opts.title?.trim() || DEFAULT_TITLE,
      ...(opts.workspace ? { workspace: opts.workspace } : {}),
      status: 'idle',
      createdAt: new Date().toISOString(),
      messages: [],
      transcript: [],
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
