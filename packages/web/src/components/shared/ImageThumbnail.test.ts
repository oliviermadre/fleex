import { describe, it, expect } from 'vitest';
import { extractMarkdownImages } from './ImageThumbnail';

describe('extractMarkdownImages', () => {
  it('extracts a real image into the gallery and leaves a placeholder link', () => {
    const { images, cleaned } = extractMarkdownImages('avant ![shot](/api/files/abc) après');
    expect(images).toHaveLength(1);
    expect(images[0]!.alt).toBe('shot');
    expect(cleaned).toBe('avant [🖼 shot](#fleex-img:0) après');
  });

  it('ignores image syntax quoted in an inline code span (an agent describing a link is not sending an image)', () => {
    const md = 'le lien brut `![image.png](/api/files/2761282e-…)` reste non résolu';
    const { images, cleaned } = extractMarkdownImages(md);
    expect(images).toEqual([]);
    expect(cleaned).toBe(md);
  });

  it('ignores image syntax inside fenced code blocks', () => {
    const md = '```md\n![x](/api/files/abc)\n```\n\n~~~\n![y](/api/files/def)\n~~~';
    const { images, cleaned } = extractMarkdownImages(md);
    expect(images).toEqual([]);
    expect(cleaned).toBe(md);
  });

  it('still extracts real images around code, and numbers placeholders in order', () => {
    const { images, cleaned } = extractMarkdownImages('![a](/u/1) `![no](/u/x)` ![b](/u/2)');
    expect(images.map((i) => i.alt)).toEqual(['a', 'b']);
    expect(cleaned).toBe('[🖼 a](#fleex-img:0) `![no](/u/x)` [🖼 b](#fleex-img:1)');
  });

  // The case that was still broken after the regex-masking fix: prose mentions a lone
  // ``` (no closing fence) before a real code span; the masking paired the 3rd backtick of
  // that run with the opening backtick of the span, leaving the span's content "outside code".
  it('does not let a lone triple-backtick in prose shift the pairing of a later code span', () => {
    const md = 'il découpe sur les blocs de code (``` et ~~~) et les code spans. Un `![x](/api/files/abc)` cité reste du texte.';
    const { images, cleaned } = extractMarkdownImages(md);
    expect(images).toEqual([]);
    expect(cleaned).toBe(md);
  });

  it('handles multi-backtick code spans that contain a backtick and image syntax', () => {
    const md = 'voir ``a ` ![x](/u/1)`` puis ![vraie](/u/2)';
    const { images, cleaned } = extractMarkdownImages(md);
    expect(images.map((i) => i.alt)).toEqual(['vraie']);
    expect(cleaned).toBe('voir ``a ` ![x](/u/1)`` puis [🖼 vraie](#fleex-img:0)');
  });

  it('ignores indented code blocks and fences with an info string', () => {
    const md = 'texte\n\n    ![a](/u/1)\n\n```ts\n![b](/u/2)\n```\n';
    const { images, cleaned } = extractMarkdownImages(md);
    expect(images).toEqual([]);
    expect(cleaned).toBe(md);
  });

  it('ignores an escaped image', () => {
    const md = '\\![a](/u/1)';
    expect(extractMarkdownImages(md).images).toEqual([]);
  });

  it('extracts images in lists, blockquotes and several per line', () => {
    const md = '- ![a](/u/1) ![b](/u/2)\n> ![c](/u/3)';
    const { images, cleaned } = extractMarkdownImages(md);
    expect(images.map((i) => i.alt)).toEqual(['a', 'b', 'c']);
    expect(cleaned).toBe('- [🖼 a](#fleex-img:0) [🖼 b](#fleex-img:1)\n> [🖼 c](#fleex-img:2)');
  });

  it('keeps a URL with parentheses and drops the title from the src', () => {
    const { images, cleaned } = extractMarkdownImages('![shot](/files/a_(1).png "titre") fin');
    expect(images).toHaveLength(1);
    expect(images[0]!.src).toContain('a_(1).png');
    expect(images[0]!.src).not.toContain('titre');
    expect(cleaned).toBe('[🖼 shot](#fleex-img:0) fin');
  });

  it('returns the markdown untouched when it has no image syntax', () => {
    const md = 'rien `à` voir';
    expect(extractMarkdownImages(md)).toEqual({ images: [], cleaned: md });
  });
});
