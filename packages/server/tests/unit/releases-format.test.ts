import { describe, it, expect } from 'vitest';
import { parseReleaseEntry, parseReleaseHeader } from '@fleex/shared';

// The Nouveautés page silently skips an invalid file, so the parser is the only
// guard between a typo in releases/ and an entry that quietly loses a field.
const entry = (fm: string, body = 'Vous pouvez maintenant…') => `---\n${fm}\n---\n${body}\n`;

describe('release entry format', () => {
  it('parses a valid entry with its images', () => {
    const r = parseReleaseEntry('x', entry(
      'title: "Un titre"\ncategory: feature\nimages:\n  - src: assets/a-dark.webp\n    light: assets/a-light.webp\n    alt: "Alt"',
    ));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.images?.[0]?.light).toBe('assets/a-light.webp');
  });

  it('rejects unknown keys, so a typo does not silently drop a caption', () => {
    const top = parseReleaseEntry('x', entry('title: "T"\ncategory: feature\ncatpion: "oops"'));
    const img = parseReleaseEntry('x', entry('title: "T"\ncategory: feature\nimages:\n  - src: a.webp\n    alt: A\n    catpion: B'));
    expect(top.ok).toBe(false);
    expect(img.ok).toBe(false);
  });

  it('accepts backfilled entries (source: slack, captured_at) and checks their values', () => {
    expect(parseReleaseEntry('x', entry('title: "T"\ncategory: fix\nsource: slack\ncaptured_at: 2026-10-20')).ok).toBe(true);
    expect(parseReleaseEntry('x', entry('title: "T"\ncategory: fix\nsource: notion')).ok).toBe(false);
  });

  it('requires a title, a known category, an image alt and a body', () => {
    expect(parseReleaseEntry('x', entry('category: feature')).ok).toBe(false);
    expect(parseReleaseEntry('x', entry('title: "T"\ncategory: feat')).ok).toBe(false);
    expect(parseReleaseEntry('x', entry('title: "T"\ncategory: feature\nimages:\n  - src: a.webp')).ok).toBe(false);
    expect(parseReleaseEntry('x', entry('title: "T"\ncategory: feature', '')).ok).toBe(false);
  });

  it('rejects unknown keys in release.md too', () => {
    expect(parseReleaseHeader('---\nnumber: 15\ndate: 2026-10-16\ntitle: T\n---\n').ok).toBe(true);
    expect(parseReleaseHeader('---\nnumber: 15\ndate: 2026-10-16\ntitle: T\ntitel: x\n---\n').ok).toBe(false);
  });
});
