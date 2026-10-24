import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDemoTarget, loadSeed, mergeSeedDocs } from '../../src/commands/demo/_seed.ts';
import { buildShotUrl, outputFile, parseShotList, resolvePlaceholders } from '../../src/commands/shoot/_shotlist.ts';
import { validateReleases } from '../../src/commands/release/_validate.ts';

const DEMO_ENV = {
  FLEEX_DEMO_MODE: '1',
  FLEEX_STORAGE_DRIVER: 'sqlite',
  FLEEX_SQLITE_PATH: '~/.fleex/demo/{instance}.db',
} as NodeJS.ProcessEnv;

describe('assertDemoTarget — demo reset deletes a DB file, so it must only ever hit the demo one', () => {
  it('resolves the per-instance demo DB', () => {
    expect(assertDemoTarget({ workspace: 'demo', instanceSlug: 'demo@main', env: DEMO_ENV, homedir: '/h' }))
      .toBe('/h/.fleex/demo/demo@main.db');
  });

  it.each([
    ['default workspace', { workspace: 'default', env: DEMO_ENV }, /only runs on the "demo" workspace/],
    ['sqlite workspace (the user data)', { workspace: 'sqlite', env: DEMO_ENV }, /only runs on the "demo" workspace/],
    ['demo name without the demo env (no --workspace flag)', { workspace: 'demo', env: { ...DEMO_ENV, FLEEX_DEMO_MODE: undefined } }, /FLEEX_DEMO_MODE=1/],
    ['a shared DB path', { workspace: 'demo', env: { ...DEMO_ENV, FLEEX_SQLITE_PATH: '/h/.fleex/fleex.db' } }, /per-instance/],
    ['Supabase storage', { workspace: 'demo', env: { ...DEMO_ENV, FLEEX_STORAGE_DRIVER: 'supabase' } }, /sqlite/],
  ])('refuses %s', (_label, o, re) => {
    expect(() => assertDemoTarget({ instanceSlug: 'x@main', homedir: '/h', ...o } as any)).toThrow(re);
  });
});

describe('seed loading', () => {
  let repo: string;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-demo-'));
    fs.mkdirSync(path.join(repo, 'demo/seed'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'demo/scenarios'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'demo/deliverables'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'demo/seed/b.yaml'), 'tickets:\n  - { key: t2, board: nova, title: B }\n');
    fs.writeFileSync(path.join(repo, 'demo/seed/a.yaml'),
      'boards:\n  - { key: nova, name: Nova }\ntickets:\n  - key: t1\n    board: nova\n    title: A\n    deliverables:\n      - { title: PRD, file: deliverables/prd.md }\n');
    fs.writeFileSync(path.join(repo, 'demo/deliverables/prd.md'), '# PRD\n');
    fs.writeFileSync(path.join(repo, 'demo/scenarios/feat.yaml'), 'tickets:\n  - { key: t3, board: nova, title: C }\n');
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('merges seed files alphabetically, then the scenario, and inlines deliverable files', () => {
    const seed = loadSeed(repo, 'feat') as any;
    expect(seed.tickets.map((t: any) => t.key)).toEqual(['t1', 't2', 't3']);
    expect(seed.tickets[0].deliverables[0]).toEqual({ title: 'PRD', content: '# PRD\n' });
  });

  it('names the known scenarios when one is missing', () => {
    expect(() => loadSeed(repo, 'nope')).toThrow(/unknown scenario "nope".*Known: feat/);
  });

  it('refuses a deliverable file outside demo/', () => {
    fs.writeFileSync(path.join(repo, 'demo/seed/c.yaml'), 'tickets:\n  - { key: x, board: nova, title: X, deliverables: [{ title: Y, file: ../../etc/passwd }] }\n');
    expect(() => loadSeed(repo)).toThrow(/outside demo/);
  });

  it('mergeSeedDocs concatenates per key', () => {
    expect(mergeSeedDocs([{ a: [1] }, { a: [2], b: [3] }])).toEqual({ a: [1, 2], b: [3] });
  });
});

describe('shot list', () => {
  const repo = '/repo';

  it('applies the defaults: 1440×900 @2x, dark + light, WebP into releases/unreleased/assets/<feature>', () => {
    const l = parseShotList('feature: my-feat\nshots:\n  - { id: hero, goto: /tickets }\n', repo);
    expect(l).toMatchObject({ viewport: { width: 1440, height: 900, scale: 2 }, themes: ['dark', 'light'], format: 'webp' });
    expect(l.out).toBe('/repo/releases/unreleased/assets/my-feat');
    expect(outputFile(l, 'hero', 'light')).toBe('/repo/releases/unreleased/assets/my-feat/hero-light.webp');
  });

  it('reports every mistake in one pass so the agent fixes the file once', () => {
    const bad = 'feature: Bad Name\nformat: gif\nshots:\n  - { id: a, goto: tickets }\n  - { id: a, goto: /x, actions: [{ jump: x }] }\n';
    expect(() => parseShotList(bad, repo)).toThrow(/feature[\s\S]*format[\s\S]*goto[\s\S]*duplicate id[\s\S]*actions\[0\]/);
  });

  it('refuses an output folder outside the repo', () => {
    expect(() => parseShotList('feature: f\nout: ../elsewhere\nshots: [{ id: a, goto: / }]\n', repo)).toThrow(/inside the repo/);
  });

  it('turns seed keys into ids, and says what to run when the seed is missing', () => {
    const state = { seededAt: '', scenario: null, ticketsByKey: { 'nova-12': { id: 'uuid-12', displayId: 7 } }, boardsByKey: { nova: 'b-uuid' } };
    expect(resolvePlaceholders('/tickets/board/{{board:nova}}/ticket/{{ticket:nova-12}}', state)).toBe('/tickets/board/b-uuid/ticket/uuid-12');
    expect(resolvePlaceholders('/x/{{ticketNumber:nova-12}}', state)).toBe('/x/7');
    expect(() => resolvePlaceholders('/{{ticket:nope}}', state)).toThrow(/unknown ticket key "nope"/);
    expect(() => resolvePlaceholders('/{{ticket:nova-12}}', null)).toThrow(/fleex demo reset/);
  });

  it('always shoots in demo mode with the requested theme', () => {
    expect(buildShotUrl('http://localhost:5173', '/tickets?x=1', 'light')).toBe('http://localhost:5173/tickets?x=1&demo=1&theme=light');
  });
});

describe('validateReleases', () => {
  let root: string;
  const fragment = (extra = '') => `---\ntitle: "Une idée"\ncategory: feature\n${extra}---\nVous pouvez maintenant…\n`;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-releases-'));
    fs.mkdirSync(path.join(root, 'unreleased/assets/x'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('accepts a fragment whose images exist', () => {
    fs.writeFileSync(path.join(root, 'unreleased/assets/x/a.webp'), 'img');
    fs.writeFileSync(path.join(root, 'unreleased/x.md'), fragment('images:\n  - { src: assets/x/a.webp, alt: "A" }\n'));
    expect(validateReleases(root)).toEqual({ fragments: 1, releases: 0, problems: [] });
  });

  it('flags a missing image, a bad front-matter and a release header that disagrees with its folder', () => {
    fs.writeFileSync(path.join(root, 'unreleased/x.md'), fragment('images:\n  - { src: assets/x/missing.webp, alt: "A" }\n'));
    fs.writeFileSync(path.join(root, 'unreleased/y.md'), '---\ncategory: nope\n---\n');
    fs.mkdirSync(path.join(root, '3'));
    fs.writeFileSync(path.join(root, '3/release.md'), '---\nnumber: 4\ndate: 2026-10-24\ntitle: T\n---\n');
    const msgs = validateReleases(root).problems.map((p) => `${p.file}: ${p.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      'unreleased/x.md: image not found: assets/x/missing.webp',
      expect.stringMatching(/^unreleased\/y\.md: "title" is required/),
      expect.stringMatching(/^unreleased\/y\.md: "category" must be one of/),
      'unreleased/y.md: the body (what the user can now do) is empty',
      '3/release.md: number 4 does not match the directory 3',
    ]));
  });

  it('rejects unknown keys, so a typo does not silently drop a caption or a field', () => {
    fs.writeFileSync(path.join(root, 'unreleased/assets/x/a.webp'), 'img');
    fs.writeFileSync(path.join(root, 'unreleased/x.md'), fragment('categroy: fix\nimages:\n  - { src: assets/x/a.webp, alt: "A", catpion: "oops" }\n'));
    fs.mkdirSync(path.join(root, '3'));
    fs.writeFileSync(path.join(root, '3/release.md'), '---\nnumber: 3\ndate: 2026-10-24\ntitle: T\nsubtitle: S\n---\n');
    const msgs = validateReleases(root).problems.map((p) => `${p.file}: ${p.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^unreleased\/x\.md: unknown key "categroy"/),
      expect.stringMatching(/^unreleased\/x\.md: unknown key "catpion" in images\[0\]/),
      expect.stringMatching(/^3\/release\.md: unknown key "subtitle"/),
    ]));
  });

  it('accepts the backfill keys (source: slack, captured_at) and checks their values', () => {
    fs.writeFileSync(path.join(root, 'unreleased/x.md'), fragment('source: slack\ncaptured_at: 2026-10-20\n'));
    expect(validateReleases(root).problems).toEqual([]);
    fs.writeFileSync(path.join(root, 'unreleased/x.md'), fragment('source: notion\ncaptured_at: hier\n'));
    const msgs = validateReleases(root).problems.map((p) => p.message);
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^"source" must be one of pr, slack/),
      '"captured_at" must be YYYY-MM-DD',
    ]));
  });

  it('warns (does not fail) above 300 KB', () => {
    fs.writeFileSync(path.join(root, 'unreleased/assets/x/big.webp'), Buffer.alloc(301 * 1024));
    fs.writeFileSync(path.join(root, 'unreleased/x.md'), fragment('images:\n  - { src: assets/x/big.webp, alt: "A" }\n'));
    expect(validateReleases(root).problems).toEqual([{ file: 'unreleased/x.md', level: 'warning', message: 'assets/x/big.webp is 301 KB (> 300 KB)' }]);
  });
});
