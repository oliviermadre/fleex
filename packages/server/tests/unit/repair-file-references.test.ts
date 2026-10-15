import { describe, it, expect } from 'vitest';
import { knownFileIds, repairFileReferences } from '../../src/application/utils/repair-file-references.js';

const A = '9a822289-c6a3-4c70-8f13-064ed046e9a6';
const B = '67b2f765-645d-450b-b4af-afc9b6f6bf4e';
const known = knownFileIds([`x ![i](/api/files/${A})`, `[f](/api/files/${B})`]);

describe('repairFileReferences', () => {
  it('collects the attachment ids already on the ticket', () => {
    expect([...known].sort()).toEqual([A, B].sort());
  });

  it('leaves a valid reference alone', () => {
    const r = repairFileReferences(`![i](/api/files/${A})`, known);
    expect(r).toEqual({ text: `![i](/api/files/${A})`, repaired: [], unresolved: [] });
  });

  it('corrects a uuid retyped with one wrong character to the single close attachment', () => {
    const typo = A.slice(0, -2) + 'c6';
    const r = repairFileReferences(`![i](/api/files/${typo})`, known);
    expect(r.text).toBe(`![i](/api/files/${A})`);
    expect(r.repaired).toEqual([{ from: typo, to: A }]);
  });

  it('does not guess when the id is far from every known attachment', () => {
    const r = repairFileReferences('![i](/api/files/00000000-1111-2222-3333-444444444444)', known);
    expect(r.repaired).toEqual([]);
    expect(r.unresolved).toEqual(['00000000-1111-2222-3333-444444444444']);
  });

  it('does not guess when two known attachments are equally close', () => {
    const k = new Set(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2']);
    const r = repairFileReferences('/api/files/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', k);
    expect(r.unresolved).toHaveLength(1);
    expect(r.repaired).toEqual([]);
  });

  it('does nothing when the text has no file reference', () => {
    expect(repairFileReferences('rien', known)).toEqual({ text: 'rien', repaired: [], unresolved: [] });
  });
});
