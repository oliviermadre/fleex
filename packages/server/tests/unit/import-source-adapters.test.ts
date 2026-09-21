import { describe, it, expect, vi } from 'vitest';
import { githubIssueSource, githubPrSource, slackMessageSource } from '@fleex/shared';
import { GitHubIssueImportAdapter } from '../../src/application/services/import-sources/github-issue.adapter.js';
import { GitHubPrImportAdapter } from '../../src/application/services/import-sources/github-pr.adapter.js';
import { SlackMessageImportAdapter } from '../../src/application/services/import-sources/slack-message.adapter.js';
import { ImportError } from '../../src/domain/errors.js';
import type { SlackImportResult } from '../../src/application/ports/slack-import.port.js';

const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

const ISSUE_MATCH = githubIssueSource.fromParts('Evaneos', 'Fleex', 12);
const PR_MATCH = githubPrSource.fromParts('Evaneos', 'Fleex', 7);
const SLACK_MATCH = slackMessageSource.detect('https://acme.slack.com/archives/C0123ABCD/p1700000000123456')!;

describe('GitHubIssueImportAdapter', () => {
  it('builds the title/description/tags/metadata from the issue detail', async () => {
    const githubGraphql = {
      fetchIssueDetail: vi.fn(async () => ({
        number: 12, title: 'Login is broken', body: 'It fails.', url: 'https://github.com/Evaneos/Fleex/issues/12',
        state: 'OPEN', author: 'alice', assignees: ['bob'], labels: ['bug', 'p1'], milestone: 'v1',
        comments: [],
      })),
    };
    const adapter = new GitHubIssueImportAdapter(githubGraphql as never, logger as never);

    const resolved = await adapter.resolve(ISSUE_MATCH);

    expect(resolved.title).toBe('Login is broken');
    expect(resolved.tags).toEqual(['bug', 'p1']);
    expect(resolved.description).toContain('It fails.');
    expect(resolved.description).toContain('#### GitHub Metadata');
    expect(resolved.description).toContain('- **Author**: @alice');
    expect(resolved.links[0]).toMatchObject({ type: 'github_issue', ref: 'Evaneos/Fleex#12' });
    expect(resolved.repo).toEqual({ org: 'Evaneos', name: 'Fleex' });
    expect(resolved.githubMetadata?.milestone).toBe('v1');
  });

  it('maps a not-found upstream error to IMPORT_NOT_FOUND', async () => {
    const githubGraphql = { fetchIssueDetail: vi.fn(async () => { throw new Error('Could not resolve issue Evaneos/Fleex#12'); }) };
    const adapter = new GitHubIssueImportAdapter(githubGraphql as never, logger as never);
    await expect(adapter.resolve(ISSUE_MATCH)).rejects.toMatchObject({ code: 'IMPORT_NOT_FOUND' });
  });

  it('maps an auth error to IMPORT_SOURCE_UNAVAILABLE', async () => {
    const githubGraphql = { fetchIssueDetail: vi.fn(async () => { throw new Error('gh auth login required'); }) };
    const adapter = new GitHubIssueImportAdapter(githubGraphql as never, logger as never);
    await expect(adapter.resolve(ISSUE_MATCH)).rejects.toMatchObject({ code: 'IMPORT_SOURCE_UNAVAILABLE' });
  });
});

describe('GitHubPrImportAdapter', () => {
  it('builds the PR body/footer and reports branch + fork flag + suggested type', async () => {
    const githubGraphql = {
      fetchPullRequestDetail: vi.fn(async () => ({
        number: 7, title: 'Add import sources', body: 'The PR body.', url: 'https://github.com/Evaneos/Fleex/pull/7',
        state: 'OPEN', isDraft: false, author: 'alice', headRefName: 'feat/import', baseRefName: 'main',
        isCrossRepository: true, nameWithOwner: 'Evaneos/Fleex',
      })),
    };
    const adapter = new GitHubPrImportAdapter(githubGraphql as never, logger as never);

    const resolved = await adapter.resolve(PR_MATCH);

    expect(resolved.title).toBe('Add import sources');
    expect(resolved.description).toContain('The PR body.');
    expect(resolved.description).toContain('- **Branch**: feat/import → main');
    expect(resolved.links[0]).toMatchObject({ type: 'github_pr', ref: 'evaneos/fleex#7' });
    expect(resolved.repo).toMatchObject({ headRefName: 'feat/import', isCrossRepository: true, prState: 'open' });
    expect(resolved.suggested?.type).toBe('review');
  });

  it('normalizes a merged PR state to lowercase', async () => {
    const githubGraphql = {
      fetchPullRequestDetail: vi.fn(async () => ({
        number: 7, title: 't', body: '', url: 'u', state: 'MERGED', isDraft: false, author: 'a',
        headRefName: 'h', baseRefName: 'main', isCrossRepository: false, nameWithOwner: 'Evaneos/Fleex',
      })),
    };
    const adapter = new GitHubPrImportAdapter(githubGraphql as never, logger as never);
    const resolved = await adapter.resolve(PR_MATCH);
    expect(resolved.repo?.prState).toBe('merged');
  });
});

describe('SlackMessageImportAdapter', () => {
  it('forwards the abort signal to the port (a cancelled preview stops the read)', async () => {
    let seenAborted: boolean | undefined;
    const slackImport = {
      synthesizeThread: vi.fn(async (_p: unknown, opts?: { signal?: AbortSignal }): Promise<SlackImportResult> => {
        seenAborted = opts?.signal?.aborted;
        return { status: 'ok', title: 'Thread', synthesis: 'Summary.' };
      }),
    };
    const adapter = new SlackMessageImportAdapter(slackImport as never, logger as never);
    const ac = new AbortController();
    ac.abort();

    await adapter.resolve(SLACK_MATCH, { signal: ac.signal });

    expect(slackImport.synthesizeThread).toHaveBeenCalledTimes(1);
    expect(seenAborted).toBe(true);
  });

  it('builds the synthesis description with a Source footer', async () => {
    const slackImport = {
      synthesizeThread: vi.fn(async (): Promise<SlackImportResult> => ({ status: 'ok', title: 'Thread', synthesis: 'Summary.' })),
    };
    const adapter = new SlackMessageImportAdapter(slackImport as never, logger as never);
    const resolved = await adapter.resolve(SLACK_MATCH);
    expect(resolved.title).toBe('Thread');
    expect(resolved.description).toContain('Summary.');
    expect(resolved.description).toContain('#### Source');
    expect(resolved.links[0]).toMatchObject({ type: 'slack_message', ref: 'C0123ABCD/1700000000.123456' });
  });

  it('maps an unavailable integration to IMPORT_SOURCE_UNAVAILABLE', async () => {
    const slackImport = { synthesizeThread: vi.fn(async (): Promise<SlackImportResult> => ({ status: 'integration_unavailable' })) };
    const adapter = new SlackMessageImportAdapter(slackImport as never, logger as never);
    await expect(adapter.resolve(SLACK_MATCH)).rejects.toBeInstanceOf(ImportError);
    await expect(adapter.resolve(SLACK_MATCH)).rejects.toMatchObject({ code: 'IMPORT_SOURCE_UNAVAILABLE' });
  });

  it('maps an empty conversation to IMPORT_EMPTY', async () => {
    const slackImport = { synthesizeThread: vi.fn(async (): Promise<SlackImportResult> => ({ status: 'empty' })) };
    const adapter = new SlackMessageImportAdapter(slackImport as never, logger as never);
    await expect(adapter.resolve(SLACK_MATCH)).rejects.toMatchObject({ code: 'IMPORT_EMPTY' });
  });
});
