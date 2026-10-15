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
    const md = '```md\n![x](/api/files/abc)\n```\net ~~~\n![y](/api/files/def)\n~~~';
    const { images, cleaned } = extractMarkdownImages(md);
    expect(images).toEqual([]);
    expect(cleaned).toBe(md);
  });

  it('still extracts real images around code, and numbers placeholders in order', () => {
    const { images, cleaned } = extractMarkdownImages('![a](/u/1) `![no](/u/x)` ![b](/u/2)');
    expect(images.map((i) => i.alt)).toEqual(['a', 'b']);
    expect(cleaned).toBe('[🖼 a](#fleex-img:0) `![no](/u/x)` [🖼 b](#fleex-img:1)');
  });
});
