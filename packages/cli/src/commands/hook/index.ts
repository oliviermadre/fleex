/**
 * `fleex hook <event>` — invoked by Claude Code via `~/.claude/settings.json`.
 *
 * Reads the JSON payload Claude Code pipes to stdin, captures the CWD,
 * and POSTs `{event, cwd, timestamp, payload}` to every running Fleex
 * instance's server (each instance independently matches the CWD against
 * its known sessions).
 *
 * Hard requirements:
 *   - MUST exit 0 in all cases, even on error, so Claude is never blocked.
 *   - MUST NOT write to stdout/stderr in the success path (Claude may capture it).
 *   - MUST be fast — bounded by a short timeout per instance.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CommandDef } from '../../core/types.ts';

const KNOWN_EVENTS = new Set([
  'sessionStart',
  'sessionEnd',
  'userPromptSubmit',
  'notification',
  'stop',
  'stopFailure',
  'preToolUse',
]);

/** Per-instance POST timeout — keep small to not delay Claude. */
const POST_TIMEOUT_MS = 1500;

/** Hard cap on stdin payload to avoid pathological inputs. */
const MAX_STDIN_BYTES = 64 * 1024;

interface InstanceTarget {
  slug: string;
  serverPort: number;
}

function fleexRunDir(): string {
  const home = process.env.FLEEX_HOME ?? path.join(os.homedir(), '.fleex');
  return path.join(home, '.run');
}

async function readStdinBounded(): Promise<string> {
  // No stdin attached → return empty quickly.
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk as Buffer;
    chunks.push(buf);
    total += buf.length;
    if (total >= MAX_STDIN_BYTES) break;
  }
  return Buffer.concat(chunks).toString('utf-8').slice(0, MAX_STDIN_BYTES);
}

function discoverInstances(): InstanceTarget[] {
  const runDir = fleexRunDir();
  if (!fs.existsSync(runDir)) return [];

  const results: InstanceTarget[] = [];
  let slugs: string[] = [];
  try {
    slugs = fs.readdirSync(runDir);
  } catch {
    return [];
  }

  for (const slug of slugs) {
    const portsFile = path.join(runDir, slug, 'ports.json');
    const pidFile = path.join(runDir, slug, 'server.pid');
    if (!fs.existsSync(portsFile) || !fs.existsSync(pidFile)) continue;

    let ports: Record<string, unknown>;
    let pid: number;
    try {
      ports = JSON.parse(fs.readFileSync(portsFile, 'utf-8'));
      pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    } catch {
      continue;
    }
    if (typeof ports.server !== 'number' || !Number.isFinite(pid) || pid <= 0) continue;

    // Check process is alive — kill(pid, 0) throws if not.
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }

    results.push({ slug, serverPort: ports.server });
  }
  return results;
}

async function postToInstance(target: InstanceTarget, body: unknown): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
  try {
    await fetch(`http://127.0.0.1:${target.serverPort}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    // Swallow — never propagate to Claude.
  } finally {
    clearTimeout(timer);
  }
}

const def: CommandDef = {
  name: 'hook',
  description: 'Internal — forward a Claude Code hook event to running Fleex instances',
  setup(cmd) {
    cmd.argument(
      '<event>',
      `Hook event type (sessionStart | sessionEnd | userPromptSubmit | notification | stop | stopFailure | preToolUse)`,
    );
  },
  action: async (event: string) => {
    // Unknown event — be silent and exit 0 so Claude is never blocked.
    if (!KNOWN_EVENTS.has(event)) {
      process.exit(0);
    }

    let raw = '';
    try {
      raw = await readStdinBounded();
    } catch {
      // stdin read failed — proceed with empty payload.
    }

    let payload: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        // Not JSON — keep first ~1KB as opaque payload for diagnostics.
        payload = { _raw: raw.slice(0, 1024) };
      }
    }

    const body = {
      event,
      cwd: process.cwd(),
      timestamp: Date.now(),
      payload,
    };

    const targets = discoverInstances();
    if (targets.length === 0) {
      process.exit(0);
    }

    await Promise.allSettled(targets.map((t) => postToInstance(t, body)));
    process.exit(0);
  },
};

export default def;
