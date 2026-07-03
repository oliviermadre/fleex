import { describe, it, expect } from 'vitest';
import { isNotionUrl, parseNotionUrl } from '@fleex/shared';

// A canonical 32-hex page id and its dashed-UUID normalization, reused below.
const HEX_ID = '2f1a3b4c5d6e7f8091a2b3c4d5e6f708';
const DASHED_ID = '2f1a3b4c-5d6e-7f80-91a2-b3c4d5e6f708';

describe('isNotionUrl', () => {
  it('accepts a title-slug page link (the form the browser copies)', () => {
    expect(isNotionUrl(`https://www.notion.so/Spec-Onboarding-${HEX_ID}`)).toBe(true);
  });

  it('accepts a bare page id with no title slug', () => {
    expect(isNotionUrl(`https://www.notion.so/${HEX_ID}`)).toBe(true);
  });

  it('accepts a workspace-scoped page link (notion.so/<workspace>/<slug-id>)', () => {
    expect(isNotionUrl(`https://www.notion.so/acme/Spec-Onboarding-${HEX_ID}`)).toBe(true);
  });

  it('accepts a dashed-UUID id', () => {
    // WHY: ids pasted from some Notion surfaces / the API arrive as a dashed UUID, not the
    // compact 32-hex form. Both must be recognized so detection does not depend on the source.
    expect(isNotionUrl(`https://www.notion.so/${DASHED_ID}`)).toBe(true);
  });

  it('accepts a link without the www subdomain', () => {
    expect(isNotionUrl(`https://notion.so/Spec-Onboarding-${HEX_ID}`)).toBe(true);
  });

  it('accepts a database-view link (?v=…)', () => {
    expect(isNotionUrl(`https://www.notion.so/${HEX_ID}?v=8d9e0f1a2b3c4d5e6f708192a3b4c5d6`)).toBe(true);
  });

  it('accepts a link with tracking query params (?pvs=4)', () => {
    expect(isNotionUrl(`https://www.notion.so/Spec-Onboarding-${HEX_ID}?pvs=4`)).toBe(true);
  });

  it('accepts a block anchor (#<blockId>)', () => {
    expect(isNotionUrl(`https://www.notion.so/Spec-Onboarding-${HEX_ID}#a1b2c3d4e5f6`)).toBe(true);
  });

  it('accepts a trailing slash', () => {
    expect(isNotionUrl(`https://www.notion.so/Spec-Onboarding-${HEX_ID}/`)).toBe(true);
  });

  it('trims surrounding whitespace before matching', () => {
    // WHY: the same paste field handles GitHub/Slack URLs and trims input; a Notion URL with a
    // stray trailing newline from the clipboard must behave identically.
    expect(isNotionUrl(`  https://www.notion.so/Spec-Onboarding-${HEX_ID}\n`)).toBe(true);
  });

  it('rejects a public notion.site URL (out of scope for v1)', () => {
    // WHY: published sites use heterogeneous id formats; mistaking one for a workspace page would
    // ship an unreadable reference to the synthesis agent.
    expect(isNotionUrl(`https://acme.notion.site/Spec-Onboarding-${HEX_ID}`)).toBe(false);
  });

  it('rejects a notion-lookalike host that is not notion.so', () => {
    expect(isNotionUrl(`https://notion.example.com/${HEX_ID}`)).toBe(false);
  });

  it('rejects a notion.so URL with no recognizable id', () => {
    expect(isNotionUrl('https://www.notion.so/my-workspace')).toBe(false);
  });

  it('rejects a GitHub issue URL', () => {
    expect(isNotionUrl('https://github.com/acme/repo/issues/42')).toBe(false);
  });

  it('rejects a Slack message URL', () => {
    expect(isNotionUrl('https://acme.slack.com/archives/C01234ABCDE/p1700000000123456')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(isNotionUrl('write the onboarding spec')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isNotionUrl('')).toBe(false);
  });

  it('rejects a valid link embedded in a larger sentence (anchored, like the other matchers)', () => {
    // WHY: parity with the GitHub/Slack matchers — the field treats the whole input as a single
    // URL or a title, never "URL surrounded by prose". Anchoring keeps that contract explicit.
    expect(isNotionUrl(`see https://www.notion.so/Spec-Onboarding-${HEX_ID} for context`)).toBe(false);
  });
});

describe('parseNotionUrl', () => {
  it('extracts the page id (normalized to a dashed UUID) from a title-slug link', () => {
    // WHY: the use case keys the provenance link off a stable id; normalizing the compact 32-hex
    // form to a dashed UUID gives one canonical handle regardless of which URL shape was pasted.
    expect(parseNotionUrl(`https://www.notion.so/Spec-Onboarding-${HEX_ID}`)).toEqual({
      pageId: DASHED_ID,
      workspace: null,
      isDatabaseView: false,
      url: `https://www.notion.so/Spec-Onboarding-${HEX_ID}`,
    });
  });

  it('normalizes a bare 32-hex id and a dashed UUID to the same canonical pageId', () => {
    expect(parseNotionUrl(`https://www.notion.so/${HEX_ID}`)?.pageId).toBe(DASHED_ID);
    expect(parseNotionUrl(`https://www.notion.so/${DASHED_ID}`)?.pageId).toBe(DASHED_ID);
  });

  it('captures the workspace slug when the path is <workspace>/<slug-id>', () => {
    expect(parseNotionUrl(`https://www.notion.so/acme/Spec-Onboarding-${HEX_ID}`)).toMatchObject({
      pageId: DASHED_ID,
      workspace: 'acme',
    });
  });

  it('flags a database-view link (?v=…) so the prompt summarizes the database, not each row', () => {
    const parsed = parseNotionUrl(`https://www.notion.so/${HEX_ID}?v=8d9e0f1a2b3c4d5e6f708192a3b4c5d6`);
    expect(parsed?.isDatabaseView).toBe(true);
    expect(parsed?.pageId).toBe(DASHED_ID);
  });

  it('does NOT flag a plain page (no ?v=) as a database view', () => {
    expect(parseNotionUrl(`https://www.notion.so/Spec-Onboarding-${HEX_ID}?pvs=4`)?.isDatabaseView).toBe(false);
  });

  it('returns null for a non-Notion URL', () => {
    expect(parseNotionUrl('https://github.com/acme/repo/issues/42')).toBeNull();
  });
});
