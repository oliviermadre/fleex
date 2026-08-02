import { describe, it, expect } from 'vitest';

import { isSlackMessageUrl, parseSlackMessageUrl } from '@fleex/shared';

describe('isSlackMessageUrl', () => {
  it('accepts a canonical Slack message permalink', () => {
    expect(isSlackMessageUrl('https://acme.slack.com/archives/C01234ABCDE/p1700000000123456')).toBe(
      true,
    );
  });

  it('accepts a permalink with thread_ts/cid query params (a reply inside a thread)', () => {
    // WHY: pasting a reply yields ?thread_ts=...&cid=... — it must still be recognized so the
    // user can import a conversation by linking any message in the thread, not only its root.
    expect(
      isSlackMessageUrl(
        'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456?thread_ts=1699999999.000100&cid=C01234ABCDE',
      ),
    ).toBe(true);
  });

  it('accepts a private-channel (group) permalink', () => {
    expect(isSlackMessageUrl('https://acme.slack.com/archives/G07ABCDEF12/p1700000000123456')).toBe(
      true,
    );
  });

  it('accepts a trailing slash', () => {
    expect(
      isSlackMessageUrl('https://acme.slack.com/archives/C01234ABCDE/p1700000000123456/'),
    ).toBe(true);
  });

  it('trims surrounding whitespace before matching', () => {
    // WHY: the same paste field handles GitHub URLs and trims input; a Slack URL with a stray
    // trailing newline from the clipboard must behave identically.
    expect(
      isSlackMessageUrl('  https://acme.slack.com/archives/C01234ABCDE/p1700000000123456\n'),
    ).toBe(true);
  });

  it('rejects a Slack app/client URL that is not a message permalink', () => {
    expect(isSlackMessageUrl('https://app.slack.com/client/T0123/C01234ABCDE')).toBe(false);
  });

  it('rejects a Slack archives URL with no message id', () => {
    expect(isSlackMessageUrl('https://acme.slack.com/archives/C01234ABCDE')).toBe(false);
  });

  it('rejects a slack-lookalike host that is not *.slack.com', () => {
    // WHY: the `.slack.com` literal must be required — a path-compatible URL on another domain
    // must not be mistaken for a Slack permalink and shipped to the synthesis agent.
    expect(
      isSlackMessageUrl('https://acme.example.com/archives/C01234ABCDE/p1700000000123456'),
    ).toBe(false);
  });

  it('rejects a GitHub issue URL', () => {
    expect(isSlackMessageUrl('https://github.com/acme/repo/issues/42')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(isSlackMessageUrl('fix the login bug')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isSlackMessageUrl('')).toBe(false);
  });

  it('rejects a valid permalink embedded in a larger sentence (anchored, like the GitHub matcher)', () => {
    // WHY: parity with GITHUB_ISSUE_RE — the field treats the whole input as a single URL or a
    // title, never "URL surrounded by prose". Anchoring keeps that contract explicit.
    expect(
      isSlackMessageUrl(
        'see https://acme.slack.com/archives/C01234ABCDE/p1700000000123456 for context',
      ),
    ).toBe(false);
  });
});

describe('parseSlackMessageUrl', () => {
  it('extracts workspace, channel id and reconstructs the message ts (the `p<digits>` decoding)', () => {
    // WHY: the `p<digits>` permalink encodes ts*1e6 with the dot removed. The use case needs the
    // real "1700000000.123456" ts (Slack's own field name) to attribute the conversation.
    expect(
      parseSlackMessageUrl('https://acme.slack.com/archives/C01234ABCDE/p1700000000123456'),
    ).toEqual({
      workspace: 'acme',
      channelId: 'C01234ABCDE',
      ts: '1700000000.123456',
      threadTs: null,
      url: 'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456',
    });
  });

  it('captures thread_ts when the linked message is a thread reply', () => {
    expect(
      parseSlackMessageUrl(
        'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456?thread_ts=1699999999.000100&cid=C01234ABCDE',
      ),
    ).toEqual({
      workspace: 'acme',
      channelId: 'C01234ABCDE',
      ts: '1700000000.123456',
      threadTs: '1699999999.000100',
      url: 'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456?thread_ts=1699999999.000100&cid=C01234ABCDE',
    });
  });

  it('treats thread_ts equal to the message ts as a root message (threadTs null)', () => {
    // WHY: Slack adds ?thread_ts=<self> to a thread parent's own permalink. That is not a reply —
    // collapsing it to null keeps "is this a threaded reply?" honest for the synthesis prompt.
    expect(
      parseSlackMessageUrl(
        'https://acme.slack.com/archives/C01234ABCDE/p1700000000123456?thread_ts=1700000000.123456&cid=C01234ABCDE',
      )?.threadTs,
    ).toBeNull();
  });

  it('returns null for a non-Slack-message URL', () => {
    expect(parseSlackMessageUrl('https://github.com/acme/repo/issues/42')).toBeNull();
  });
});
