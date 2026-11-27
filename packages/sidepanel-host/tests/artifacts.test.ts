import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCard, changedFiles, csvHead, deliverableTypeFor, lastCitedTicket } from '../src/artifacts.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-art-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('artefacts', () => {
  it('finds the files a call produced, never the manifest nor dependencies (RG33)', () => {
    const t0 = Date.now() - 10;
    fs.writeFileSync(path.join(dir, '.fleex.json'), '{}');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), '');
    fs.writeFileSync(path.join(dir, 'tickets.csv'), 'a,b\n1,2\n');
    expect(changedFiles(dir, t0)).toEqual([path.join(dir, 'tickets.csv')]);
  });

  it('gives scripts a one-line card and other files a preview (T8)', () => {
    fs.writeFileSync(path.join(dir, 'export.ts'), 'x');
    fs.writeFileSync(path.join(dir, 't.csv'), 'id,"title, with comma"\n1,a\n');
    expect(buildCard(path.join(dir, 'export.ts'), dir)).toMatchObject({ kind: 'script', relPath: 'export.ts', attachable: true });
    const csv = buildCard(path.join(dir, 't.csv'), dir)!;
    expect(csv.kind).toBe('full');
    expect(csv.preview).toEqual({ type: 'csv', rows: [['id', 'title, with comma'], ['1', 'a']] });
  });

  it('refuses to attach binaries and files over 1 MB (P16)', () => {
    fs.writeFileSync(path.join(dir, 'chart.png'), Buffer.from([0x89, 0x50]));
    fs.writeFileSync(path.join(dir, 'big.md'), 'x'.repeat(1024 * 1024 + 1));
    expect(buildCard(path.join(dir, 'chart.png'), dir)!.attachable).toBe(false);
    expect(buildCard(path.join(dir, 'big.md'), dir)!.attachable).toBe(false);
  });

  it('types a deliverable from its extension', () => {
    expect(deliverableTypeFor('r.html')).toBe('html');
    expect(deliverableTypeFor('export.py')).toBe('code');
    expect(deliverableTypeFor('rapport.md')).toBe('report');
    expect(deliverableTypeFor('t.csv')).toBe('report');
  });

  it('preselects the last ticket cited in the conversation (P19)', () => {
    expect(lastCitedTicket(['look at #12', 'then ticket 482 please'])).toBe('482');
    expect(lastCitedTicket(['nothing here'])).toBeUndefined();
  });

  it('reads only the first CSV rows', () => {
    expect(csvHead('a\nb\nc\nd\ne\nf\ng')).toHaveLength(5);
  });
});
