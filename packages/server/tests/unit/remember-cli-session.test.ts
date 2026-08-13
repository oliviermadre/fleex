import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseRemote, RememberCliSessionUseCase } from '../../src/application/use-cases/remember-cli-session.js';
import { NOTHING_SENTINEL } from '../../src/application/memory/memory-synthesiser.js';
import type { MemorySynthesiser } from '../../src/application/memory/memory-synthesiser.js';
import type { MemoryKernel } from '../../src/application/memory/memory-kernel.js';
import type { RetrieveContextUseCase } from '../../src/application/use-cases/retrieve-context.js';
import type { ExecFn } from '../../src/infrastructure/host/types.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** A transcript with enough exchange to be worth distilling. */
function transcriptFile(turns = 3): string {
  const dir = mkdtempSync(join(tmpdir(), 'fleex-cli-'));
  const path = join(dir, 'transcript.jsonl');
  const lines: string[] = [];
  for (let i = 0; i < turns; i++) {
    lines.push(JSON.stringify({
      type: 'user', message: { role: 'user', content: [{ type: 'text', text: `question ${i}` }] },
    }));
    lines.push(JSON.stringify({
      type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] },
    }));
  }
  writeFileSync(path, lines.join('\n'));
  return path;
}

let ingest: ReturnType<typeof vi.fn>;
let run: ReturnType<typeof vi.fn>;
let enabled: boolean;

function useCase(execFn?: ExecFn) {
  ingest = vi.fn(async () => ({ embedded: 1, unchanged: 0, removed: 0, deferred: 0 }));
  return new RememberCliSessionUseCase(
    { isFeatureEnabled: () => enabled } as unknown as RetrieveContextUseCase,
    { run } as unknown as MemorySynthesiser,
    execFn ?? (async () => ({ stdout: 'git@github.com:acme/app.git', stderr: '' })),
    silent as never,
    { ingest } as unknown as MemoryKernel,
  );
}

beforeEach(() => {
  enabled = true;
  run = vi.fn(async () => '- the arm runner has no docker\n- build with --platform');
});

describe('RememberCliSessionUseCase', () => {
  it('distils a session and files it under its repository', async () => {
    const result = await useCase().execute({
      sessionId: 's1', transcriptPath: transcriptFile(), cwd: '/tmp/checkout',
    });

    expect(result.remembered).toBe(true);
    const [kind, sourceId, drafts] = ingest.mock.calls[0]!;
    expect(kind).toBe('cli_session_summary');
    // Stable id, so the same session ingested twice replaces rather than duplicates.
    expect(sourceId).toBe('cli:s1');
    expect(drafts[0].metadata.repo).toBe('acme/app');
    expect(drafts[0].title).toContain('acme/app');
  });

  it('spends nothing when the feature is off', async () => {
    enabled = false;
    const result = await useCase().execute({
      sessionId: 's1', transcriptPath: transcriptFile(), cwd: '/tmp/checkout',
    });

    expect(result).toEqual({ remembered: false, reason: 'disabled' });
    // The point of the switch: no model call, not merely no write.
    expect(run).not.toHaveBeenCalled();
  });

  it('skips a session too short to have established anything', async () => {
    const result = await useCase().execute({
      sessionId: 's1', transcriptPath: transcriptFile(1), cwd: '/tmp/checkout',
    });

    expect(result.reason).toBe('too-short');
    expect(run).not.toHaveBeenCalled();
  });

  it('writes nothing when the model declines', async () => {
    run = vi.fn(async () => NOTHING_SENTINEL);
    const result = await useCase().execute({
      sessionId: 's1', transcriptPath: transcriptFile(), cwd: '/tmp/checkout',
    });

    // Declining is a normal outcome: most sessions establish nothing durable, and
    // manufacturing a note from them would fill memory with noise.
    expect(result.reason).toBe('nothing-to-remember');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('still remembers a session in a checkout with no remote', async () => {
    const failing: ExecFn = async () => { throw new Error('not a git repository'); };
    const result = await useCase(failing).execute({
      sessionId: 's1', transcriptPath: transcriptFile(), cwd: '/tmp/elsewhere',
    });

    expect(result.remembered).toBe(true);
    const [, , drafts] = ingest.mock.calls[0]!;
    expect(drafts[0].metadata.repo).toBeNull();
    expect(drafts[0].title).toContain('terminal');
  });

  it('reports missing parameters rather than reading a nonexistent transcript', async () => {
    const result = await useCase().execute({ sessionId: '', transcriptPath: '', cwd: '/tmp' });
    expect(result.reason).toBe('missing-params');
  });

  it('survives an unreadable transcript', async () => {
    const result = await useCase().execute({
      sessionId: 's1', transcriptPath: '/nonexistent/transcript.jsonl', cwd: '/tmp',
    });
    expect(result.reason).toBe('too-short');
  });

  it('sends the repository and the exchange to the distiller', async () => {
    await useCase().execute({
      sessionId: 's1', transcriptPath: transcriptFile(), cwd: '/tmp/checkout',
    });
    const [request] = run.mock.calls[0]!;
    expect(request.userPrompt).toContain('Repository: acme/app');
    expect(request.userPrompt).toContain('answer 0');
  });
});

describe('parseRemote', () => {
  it('reads the ssh form', () => {
    expect(parseRemote('git@github.com:acme/app.git')).toBe('acme/app');
  });

  it('reads the https form', () => {
    expect(parseRemote('https://github.com/acme/app.git')).toBe('acme/app');
  });

  it('reads a form with no .git suffix', () => {
    expect(parseRemote('https://github.com/acme/app')).toBe('acme/app');
  });

  it('reads a self-hosted path with extra segments', () => {
    // GitLab subgroups: the last two segments are the ones that identify it.
    expect(parseRemote('git@gitlab.internal:team/sub/app.git')).toBe('sub/app');
  });

  it('lowercases, so one repo is one scope', () => {
    expect(parseRemote('git@github.com:Acme/App.git')).toBe('acme/app');
  });

  it('returns null for something that is not a repository url', () => {
    expect(parseRemote('')).toBeNull();
    expect(parseRemote('nonsense')).toBeNull();
  });
});
