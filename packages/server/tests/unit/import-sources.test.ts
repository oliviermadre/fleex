import { describe, it, expect } from 'vitest';
import {
  detectSource,
  getSource,
  githubIssueSource,
  githubPrSource,
  IMPORT_SOURCES,
} from '@fleex/shared';

describe('detectSource — GitHub issue', () => {
  it('produces the exact `org/name#N` ref with casing preserved', () => {
    // WHY: the hard constraint — getTicketsLinkedTo('github_issue', ref) compares
    // strictly, so an issue ref must keep GitHub's original casing byte-for-byte.
    const match = detectSource('https://github.com/Evaneos/Fleex/issues/12');
    expect(match).toEqual({
      sourceId: 'github_issue',
      ref: 'Evaneos/Fleex#12',
      url: 'https://github.com/Evaneos/Fleex/issues/12',
      label: '#12',
      display: 'Evaneos/Fleex#12',
      params: { org: 'Evaneos', name: 'Fleex', number: 12 },
    });
  });

  it('tolerates a query string (a browser-copied link drags a ?utm_…)', () => {
    expect(detectSource('https://github.com/Evaneos/Fleex/issues/12?utm=x')?.ref).toBe('Evaneos/Fleex#12');
  });

  it('tolerates a fragment', () => {
    expect(detectSource('https://github.com/a/b/issues/9#issuecomment-1')?.ref).toBe('a/b#9');
  });

  it('tolerates http:// and a trailing slash', () => {
    expect(detectSource('http://github.com/a/b/issues/3/')?.ref).toBe('a/b#3');
  });
});

describe('detectSource — GitHub pull request', () => {
  it('lowercases the ref but keeps display/params in original casing', () => {
    // WHY: PR refs must be lowercase (the ticket constraint) so historically
    // mixed-cased links still resolve; the GraphQL query still needs real casing.
    const match = detectSource('https://github.com/Evaneos/Fleex/pull/7');
    expect(match).toEqual({
      sourceId: 'github_pr',
      ref: 'evaneos/fleex#7',
      url: 'https://github.com/Evaneos/Fleex/pull/7',
      label: '#7',
      display: 'Evaneos/Fleex#7',
      params: { org: 'Evaneos', name: 'Fleex', number: 7 },
    });
  });

  it('tolerates the /files sub-path', () => {
    expect(detectSource('https://github.com/Evaneos/Fleex/pull/7/files')?.ref).toBe('evaneos/fleex#7');
  });

  it('tolerates a review fragment', () => {
    expect(detectSource('https://github.com/a/b/pull/12#discussion_r42')?.ref).toBe('a/b#12');
  });
});

describe('detectSource — Slack message', () => {
  it('produces the `channelId/ts` ref, decoding the p<digits> segment', () => {
    const match = detectSource(
      'https://acme.slack.com/archives/C0123ABCD/p1700000000123456?thread_ts=1699999999.000100&cid=C0123ABCD',
    );
    expect(match?.sourceId).toBe('slack_message');
    expect(match?.ref).toBe('C0123ABCD/1700000000.123456');
    expect(match?.label).toBe('Slack thread');
    expect(match?.params).toMatchObject({ channelId: 'C0123ABCD', ts: '1700000000.123456', threadTs: '1699999999.000100' });
  });

  it('tolerates a trailing fragment (newly added to SLACK_MESSAGE_URL_RE)', () => {
    expect(detectSource('https://acme.slack.com/archives/C0123ABCD/p1700000000123456#x')?.ref).toBe(
      'C0123ABCD/1700000000.123456',
    );
  });

  it('labels a root message as "Slack message"', () => {
    expect(detectSource('https://acme.slack.com/archives/C0123ABCD/p1700000000123456')?.label).toBe('Slack message');
  });
});

describe('detectSource — rejections', () => {
  it('rejects a URL embedded in prose (it is a title, not an import)', () => {
    expect(detectSource('fix https://github.com/a/b/issues/1')).toBeNull();
  });

  it('rejects a bare repo URL', () => {
    expect(detectSource('https://github.com/a/b')).toBeNull();
  });

  it('rejects a non-GitHub host', () => {
    expect(detectSource('https://gitlab.com/a/b/issues/1')).toBeNull();
  });

  it('rejects an org/name with illegal characters', () => {
    expect(detectSource('https://github.com/a b/c/issues/1')).toBeNull();
  });

  it('rejects empty and whitespace-only input', () => {
    expect(detectSource('')).toBeNull();
    expect(detectSource('   ')).toBeNull();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(detectSource('  https://github.com/a/b/issues/1\n')?.ref).toBe('a/b#1');
  });
});

describe('fromParts ≡ detect(equivalent url)', () => {
  it('issue: fromParts matches detecting its own URL', () => {
    const fromParts = githubIssueSource.fromParts('Evaneos', 'Fleex', 12);
    expect(detectSource(fromParts.url)).toEqual(fromParts);
  });

  it('pr: fromParts matches detecting its own URL', () => {
    const fromParts = githubPrSource.fromParts('Evaneos', 'Fleex', 7);
    expect(detectSource(fromParts.url)).toEqual(fromParts);
  });
});

describe('registry', () => {
  it('resolves each descriptor by its id', () => {
    for (const source of IMPORT_SOURCES) {
      expect(getSource(source.id)).toBe(source);
    }
  });

  it('throws on an unknown id', () => {
    // @ts-expect-error — deliberately invalid id
    expect(() => getSource('linear_issue')).toThrow();
  });

  it('exposes the resolution kind that drives the resolving screen', () => {
    expect(getSource('github_issue').resolution).toBe('instant');
    expect(getSource('github_pr').resolution).toBe('instant');
    expect(getSource('slack_message').resolution).toBe('slow');
  });
});
