import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releasesRoutes } from '../../src/infrastructure/http/releases.routes.js';

function write(root: string, rel: string, content: string | Buffer) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

const header = (n: number, title = `Release ${n}`) =>
  `---\nnumber: ${n}\ndate: 2026-10-${String(n).padStart(2, '0')}\ntitle: "${title}"\nthemes: [A, B]\n---\nIntro ${n}.\n`;

const fragment = (title: string, category: string, extra = '') =>
  `---\ntitle: "${title}"\ncategory: ${category}\n${extra}---\nVous pouvez maintenant ${title}.\n`;

describe('releases routes', () => {
  let tmp: string;
  let root: string;
  let app: FastifyInstance;
  let warnings: string[];

  async function boot(dir = root) {
    app = Fastify();
    await app.register(releasesRoutes({ dir, logger: { warn: (m) => warnings.push(m) } }));
    await app.ready();
  }

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'fleex-releases-'));
    root = path.join(tmp, 'releases');
    mkdirSync(root);
    warnings = [];
  });

  afterEach(async () => {
    await app?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns an empty history when releases/ is missing', async () => {
    await boot(path.join(tmp, 'nope'));
    const res = await app.inject({ method: 'GET', url: '/api/releases' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ current: null, releases: [] });
  });

  it('lists releases newest first with entries sorted and image URLs rewritten', async () => {
    write(root, '9/release.md', header(9));
    write(root, '9/a-fix.md', fragment('a fix', 'fix'));
    write(root, '10/release.md', header(10, 'Dix'));
    write(root, '10/b-fix.md', fragment('b fix', 'fix'));
    write(root, '10/z-feature.md', fragment('z feature', 'feature', [
      'prs: [325]',
      'images:',
      '  - src: assets/z/hero-dark.webp',
      '    light: assets/z/hero-light.webp',
      '    alt: "Hero"',
      '',
    ].join('\n')));
    write(root, '10/a-first.md', fragment('a first', 'under-the-hood', 'order: 1\n'));
    await boot();

    const body = (await app.inject({ method: 'GET', url: '/api/releases' })).json();
    expect(body.current).toBe(10);
    expect(body.releases.map((r: { number: number }) => r.number)).toEqual([10, 9]);
    expect(body.releases[0]).toMatchObject({ title: 'Dix', themes: ['A', 'B'], intro: 'Intro 10.' });
    expect(body.releases[0].entries.map((e: { slug: string }) => e.slug)).toEqual(['a-first', 'z-feature', 'b-fix']);
    expect(body.releases[0].entries[1].images[0]).toEqual({
      src: '/api/releases/assets/10/assets/z/hero-dark.webp',
      light: '/api/releases/assets/10/assets/z/hero-light.webp',
      alt: 'Hero',
    });
    expect(body.unreleased).toBeUndefined();
  });

  it('skips invalid fragments and release dirs without a valid header, and logs them', async () => {
    write(root, '3/release.md', header(3));
    write(root, '3/good.md', fragment('good', 'feature'));
    write(root, '3/bad.md', fragment('bad', 'nope'));
    write(root, '3/no-front.md', 'just text');
    write(root, '4/bad-header.md', fragment('x', 'feature'));
    write(root, '5/release.md', '---\nnumber: 5\n---\n');
    write(root, '6/release.md', header(7));
    await boot();

    const body = (await app.inject({ method: 'GET', url: '/api/releases' })).json();
    expect(body.current).toBe(3);
    expect(body.releases).toHaveLength(1);
    expect(body.releases[0].entries.map((e: { slug: string }) => e.slug)).toEqual(['good']);
    expect(warnings.some((w) => w.includes('3/bad.md'))).toBe(true);
    expect(warnings.some((w) => w.includes('3/no-front.md'))).toBe(true);
    expect(warnings.some((w) => w.includes('releases/4'))).toBe(true);
    expect(warnings.some((w) => w.includes('releases/5'))).toBe(true);
    expect(warnings.some((w) => w.includes('releases/6'))).toBe(true);
  });

  it('adds unreleased entries only when ?unreleased=1', async () => {
    write(root, 'unreleased/.gitkeep', '');
    write(root, 'unreleased/697-qa.md', fragment('qa', 'feature', [
      'images:',
      '  - src: assets/697-qa/hero-dark.webp',
      '    alt: "QA"',
      '',
    ].join('\n')));
    await boot();

    const plain = (await app.inject({ method: 'GET', url: '/api/releases' })).json();
    expect(plain).toEqual({ current: null, releases: [] });

    const body = (await app.inject({ method: 'GET', url: '/api/releases?unreleased=1' })).json();
    expect(body.unreleased).toHaveLength(1);
    expect(body.unreleased[0].images[0].src).toBe('/api/releases/assets/unreleased/assets/697-qa/hero-dark.webp');
  });

  it('serves images with their mime type and nosniff', async () => {
    write(root, '10/assets/z/hero-dark.webp', Buffer.from('RIFFxxxxWEBP'));
    await boot();
    const res = await app.inject({ method: 'GET', url: '/api/releases/assets/10/assets/z/hero-dark.webp' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toBe('RIFFxxxxWEBP');
  });

  it('answers 404 for traversal, missing files and non-image types', async () => {
    write(tmp, 'secret.png', 'TOP-SECRET-CONTENT');
    write(root, '10/notes.md', fragment('x', 'feature'));
    write(root, '10/evil.svg', '<svg onload="alert(1)"/>');
    await boot();
    for (const url of [
      '/api/releases/assets/../secret.png',
      '/api/releases/assets/10/../../secret.png',
      '/api/releases/assets/10/%2e%2e/%2e%2e/secret.png',
      '/api/releases/assets/%2e%2e%2fsecret.png',
      '/api/releases/assets/10/missing.webp',
      '/api/releases/assets/10/notes.md',
      '/api/releases/assets/10/evil.svg',
      '/api/releases/assets/',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('TOP-SECRET-CONTENT');
    }
  });
});
