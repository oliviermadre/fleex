import { reconstructTranscript } from '../utils/cli-session-ingest.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { MemoryKernel } from '../memory/memory-kernel.js';
import { MemorySynthesiser, NOTHING_SENTINEL } from '../memory/memory-synthesiser.js';
import { chunkCliSession } from '../memory/chunk-curated.js';
import type { RetrieveContextUseCase } from './retrieve-context.js';
import type { ExecFn } from '../../infrastructure/host/types.js';

/** Cap on the transcript handed to the distiller. */
const MAX_TRANSCRIPT_CHARS = 24_000;

/** Below this, the session is a one-off question with nothing to keep. */
const MIN_TURNS = 4;

const SYSTEM_PROMPT = `
You distil a terminal session with Claude into a note for long-term memory.

Keep only what would help someone — or some agent — working in this repository later:
- facts about the codebase that were discovered
- what was changed, and why
- approaches that worked, and approaches that were tried and failed
- pitfalls, constraints and commands that turned out to matter

Discard the back-and-forth, restatements of the request, and anything true only of
this one sitting.

Write terse markdown bullets, under 200 words. No preamble, no code fence.

If the session established nothing worth keeping, output the single token
${NOTHING_SENTINEL}.
`.trim();

/**
 * Remembers terminal sessions that belonged to no ticket.
 *
 * The cost hook already sees every finished `claude` session, but discards the
 * ones outside a Fleex worktree — no ticket to attach them to. That is a large
 * hole in a memory that claims to cover everything: exploratory work happens in
 * plain checkouts, and its findings are exactly what the next run needs.
 *
 * The transcript itself is never stored. It is noisy, and it is the one body of
 * content in the workspace most likely to contain something the user would not
 * choose to keep — a pasted secret, an unrelated aside. A distilled note is both
 * more useful and less of a liability.
 */
export class RememberCliSessionUseCase {
  constructor(
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly synthesiser: MemorySynthesiser,
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
    private readonly kernel?: MemoryKernel,
  ) {}

  async execute(params: {
    sessionId: string;
    transcriptPath: string;
    cwd: string;
  }): Promise<{ remembered: boolean; reason?: string }> {
    if (!this.kernel || !this.retrieveContext.isFeatureEnabled('cliSessions')) {
      return { remembered: false, reason: 'disabled' };
    }
    if (!params.sessionId || !params.transcriptPath) {
      return { remembered: false, reason: 'missing-params' };
    }

    const turns = await reconstructTranscript(params.transcriptPath).catch(() => []);
    if (turns.length < MIN_TURNS || !turns.some((t) => t.role === 'assistant')) {
      return { remembered: false, reason: 'too-short' };
    }

    const repo = await this.resolveRepo(params.cwd);
    const distilled = await this.synthesiser.run({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: this.renderTranscript(turns, repo),
    }, { sessionId: params.sessionId, repo });

    if (!distilled || distilled.trim() === NOTHING_SENTINEL) {
      return { remembered: false, reason: 'nothing-to-remember' };
    }

    await this.kernel.ingest('cli_session_summary', `cli:${params.sessionId}`, chunkCliSession({
      sessionId: params.sessionId,
      repo,
      content: distilled,
      endedAt: new Date(),
    }));

    this.logger.info('Remembered a terminal session', { sessionId: params.sessionId, repo });
    return { remembered: true };
  }

  /**
   * `owner/name` from the checkout's origin remote.
   *
   * Read from git rather than matched against the configured repository list: a
   * session can run in a clone the instance does not manage, and the repo is worth
   * recording either way — it is the only scope such a note has.
   */
  private async resolveRepo(cwd: string): Promise<string | null> {
    if (!cwd) return null;
    try {
      // Throws rather than returning a code when git fails, which the catch below
      // handles — a directory that is not a checkout is an ordinary outcome here.
      const { stdout } = await this.execFn('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5_000 });
      return parseRemote(stdout.trim());
    } catch {
      return null;
    }
  }

  /**
   * The conversation as text, newest turns last and the whole thing capped.
   *
   * Truncated from the front: a session's conclusions are at its end, and that is
   * what a distillation is for.
   */
  private renderTranscript(
    turns: Array<{ role: string; text: string }>,
    repo: string | null,
  ): string {
    const rendered = turns
      .map((turn) => `**${turn.role}**: ${turn.text}`)
      .join('\n\n');
    const body = rendered.length > MAX_TRANSCRIPT_CHARS
      ? `…\n${rendered.slice(-MAX_TRANSCRIPT_CHARS)}`
      : rendered;

    return [
      repo ? `Repository: ${repo}` : 'Repository: unknown',
      '',
      'Session transcript:',
      body,
    ].join('\n');
  }
}

/**
 * `owner/name` out of an SSH or HTTPS git remote.
 *
 * Exported for tests: remote formats are the kind of thing that looks obvious and
 * has four shapes.
 */
export function parseRemote(url: string): string | null {
  if (!url) return null;
  const cleaned = url.replace(/\.git$/, '');
  // git@host:owner/name — the colon form has no slash after the host.
  const ssh = /^[^@]+@[^:]+:(?<path>.+)$/.exec(cleaned);
  const path = ssh?.groups?.['path'] ?? cleaned.replace(/^[a-z+]+:\/\/[^/]+\//i, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase();
}
