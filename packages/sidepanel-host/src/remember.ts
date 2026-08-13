import type Anthropic from '@anthropic-ai/sdk';
import { findWorkspaceServerPort } from './instance-discovery.ts';
import type { SessionData } from './sessions.ts';

/**
 * How long a conversation must sit idle before it counts as over.
 *
 * Distilling after every turn would spend a model call per exchange for a digest
 * that the next turn immediately supersedes. Five minutes of silence is a
 * conversation someone has walked away from, which is exactly when its lasting
 * content is worth extracting — and the timer resets on each turn, so an active
 * conversation is distilled once, at the end, not repeatedly.
 */
const IDLE_MS = 5 * 60_000;

/** Nothing short enough to be a single question is worth remembering. */
const MIN_TURNS = 4;

/** Per-session idle timers. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule a conversation for distillation once it goes quiet.
 *
 * Fire-and-forget by design: the panel must never wait on this, and a workspace
 * with the feature switched off simply answers that nothing was remembered. The
 * server decides — the host does not read the flag, so there is one place where
 * the feature is on or off.
 */
export function scheduleRemember(session: SessionData, log: (msg: string, meta?: unknown) => void): void {
  const existing = timers.get(session.id);
  if (existing) clearTimeout(existing);

  timers.set(session.id, setTimeout(() => {
    timers.delete(session.id);
    void rememberNow(session, log);
  }, IDLE_MS));
}

/** Cancel a pending distillation — the conversation is gone. */
export function cancelRemember(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(sessionId);
  }
}

/** Stop every timer, so they cannot outlive the process. */
export function stopAllRemember(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

/**
 * Post the conversation to its workspace's server for distillation.
 *
 * Exported so `fleex companion` can force it, and so it is testable without
 * waiting out the idle timer.
 */
export async function rememberNow(
  session: SessionData,
  log: (msg: string, meta?: unknown) => void,
): Promise<boolean> {
  const turns = toTurns(session.messages);
  if (turns.length < MIN_TURNS) return false;

  const port = await findWorkspaceServerPort(session.workspace);
  // No running server for this workspace: the index lives there, so there is
  // nowhere to send this. Not an error — the host outlives any given instance.
  if (!port) return false;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/memory/remember-conversation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId: session.id,
        title: session.title,
        turns,
      }),
    });
    if (!response.ok) return false;

    const result = await response.json() as { ok?: boolean; reason?: string };
    if (result.ok) log('[remember] distilled conversation', { id: session.id });
    return !!result.ok;
  } catch (error) {
    log('[remember] could not reach the workspace server', {
      id: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Flatten Anthropic messages into role/content turns.
 *
 * Tool calls and their results are dropped: they are how the assistant got the
 * information, not what was decided, and a digest built from them would remember
 * plumbing. Only the text the two parties actually exchanged is sent.
 */
export function toTurns(messages: Anthropic.MessageParam[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;

    const text = typeof message.content === 'string'
      ? message.content
      : message.content
        .filter((block): block is Anthropic.TextBlockParam => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

    if (text.trim()) turns.push({ role: message.role, content: text.trim() });
  }
  return turns;
}
