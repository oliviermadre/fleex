import { describe, it, expect } from 'vitest';
import type { MarketplacePrimitiveEntry } from '@fleex/shared';
import { computeRemovalClosure, refKey } from '../../src/core/marketplace.ts';

function entry(
  kind: MarketplacePrimitiveEntry['kind'],
  slug: string,
  dependencies: MarketplacePrimitiveEntry['dependencies'] = [],
): MarketplacePrimitiveEntry {
  return { kind, slug, displayName: slug, path: `${kind}s/${slug}.json`, dependencies };
}

const keys = (entries: MarketplacePrimitiveEntry[]) => entries.map(refKey).sort();

describe('computeRemovalClosure', () => {
  it('removes only the target when nothing depends on it', () => {
    const primitives = [
      entry('persona', 'jarvis'),
      entry('skill', 'standalone'),
    ];
    const { toRemove, dependents } = computeRemovalClosure(primitives, [
      { kind: 'skill', slug: 'standalone' },
    ]);
    expect(keys(toRemove)).toEqual(['skill:standalone']);
    expect(dependents).toEqual([]);
  });

  it('cascades to a skill and a panel that depend on the persona', () => {
    const primitives = [
      entry('persona', 'jarvis'),
      entry('skill', 'search', [{ kind: 'persona', slug: 'jarvis' }]),
      entry('panel', 'debate', [{ kind: 'persona', slug: 'jarvis' }]),
      entry('persona', 'unrelated'),
    ];
    const { toRemove, dependents } = computeRemovalClosure(primitives, [
      { kind: 'persona', slug: 'jarvis' },
    ]);
    expect(keys(toRemove)).toEqual(['panel:debate', 'persona:jarvis', 'skill:search']);
    expect(keys(dependents)).toEqual(['panel:debate', 'skill:search']);
    // The unrelated persona survives.
    expect(keys(toRemove)).not.toContain('persona:unrelated');
  });

  it('follows a transitive chain persona -> skill -> workflow', () => {
    const primitives = [
      entry('persona', 'jarvis'),
      entry('skill', 'search', [{ kind: 'persona', slug: 'jarvis' }]),
      entry('workflow', 'research', [{ kind: 'skill', slug: 'search' }]),
    ];
    const { toRemove, dependents } = computeRemovalClosure(primitives, [
      { kind: 'persona', slug: 'jarvis' },
    ]);
    expect(keys(toRemove)).toEqual(['persona:jarvis', 'skill:search', 'workflow:research']);
    expect(keys(dependents)).toEqual(['skill:search', 'workflow:research']);
  });

  it('ignores a target that is not in the manifest', () => {
    const primitives = [entry('persona', 'jarvis')];
    const { toRemove, dependents } = computeRemovalClosure(primitives, [
      { kind: 'persona', slug: 'ghost' },
    ]);
    expect(toRemove).toEqual([]);
    expect(dependents).toEqual([]);
  });

  it('leaves no remaining primitive referencing a removed one (invariant)', () => {
    const primitives = [
      entry('persona', 'a'),
      entry('skill', 's1', [{ kind: 'persona', slug: 'a' }]),
      entry('panel', 'p1', [{ kind: 'persona', slug: 'a' }]),
      entry('workflow', 'w1', [{ kind: 'skill', slug: 's1' }]),
      entry('persona', 'b'),
      entry('skill', 's2', [{ kind: 'persona', slug: 'b' }]),
    ];
    const { toRemove } = computeRemovalClosure(primitives, [{ kind: 'persona', slug: 'a' }]);
    const removed = new Set(toRemove.map(refKey));
    const survivors = primitives.filter((e) => !removed.has(refKey(e)));
    for (const s of survivors) {
      for (const dep of s.dependencies) {
        expect(removed.has(refKey(dep))).toBe(false);
      }
    }
    // The independent 'b' subtree is untouched.
    expect(survivors.map(refKey).sort()).toEqual(['persona:b', 'skill:s2']);
  });
});
