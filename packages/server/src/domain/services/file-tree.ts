import type { FileTreeNode } from '@fleex/shared';

/**
 * Parse `git status --porcelain` output into changed (tracked) and untracked
 * path lists. For renames (`R  old -> new`) the destination is the changed
 * path. Untracked entries (`??`) are returned separately so the tree can
 * include files that HEAD's `ls-tree` does not know about.
 */
export function parseStatusPorcelain(out: string): { changed: string[]; untracked: string[] } {
  const changed: string[] = [];
  const untracked: string[] = [];

  for (const rawLine of out.split('\n')) {
    if (rawLine.length < 4) continue;
    const status = rawLine.slice(0, 2);
    const rest = rawLine.slice(3);

    if (status === '??') {
      untracked.push(rest);
      continue;
    }
    // Rename/copy: "orig -> dest" — the destination is what changed.
    const arrow = rest.indexOf(' -> ');
    changed.push(arrow === -1 ? rest : rest.slice(arrow + 4));
  }

  return { changed, untracked };
}

interface MutableNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  changed: boolean;
  children?: Map<string, MutableNode>;
}

/**
 * Build a nested file tree for the Code panel. `trackedPaths` come from
 * `git ls-tree`, `untrackedPaths` from porcelain `??` entries; `changedPaths`
 * (plus every untracked path) mark files as changed, and that flag propagates
 * up to every ancestor directory so a collapsed dir can show a dot. The tree is
 * pruned to `depth` levels (top-level nodes are depth 1); ancestor changed
 * flags survive pruning. Directories sort before files, each alphabetically.
 */
export function buildFileTree(
  trackedPaths: string[],
  changedPaths: string[],
  untrackedPaths: string[],
  depth: number,
): FileTreeNode[] {
  const changedSet = new Set<string>([...changedPaths, ...untrackedPaths]);
  const allPaths = new Set<string>([...trackedPaths, ...untrackedPaths]);

  const root: MutableNode = { name: '', path: '', kind: 'dir', changed: false, children: new Map() };

  for (const path of allPaths) {
    const segments = path.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    const isChanged = changedSet.has(path);

    let node = root;
    let acc = '';
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i]!;
      acc = acc ? `${acc}/${name}` : name;
      const isLeaf = i === segments.length - 1;
      node.children ??= new Map();
      let child = node.children.get(name);
      if (!child) {
        child = { name, path: acc, kind: isLeaf ? 'file' : 'dir', changed: false, children: undefined };
        node.children.set(name, child);
      }
      if (isChanged) child.changed = true; // propagate up every ancestor + the leaf
      node = child;
    }
  }

  return serialize(root, 1, depth);
}

function serialize(node: MutableNode, level: number, maxDepth: number): FileTreeNode[] {
  if (!node.children) return [];
  const children = [...node.children.values()].sort(compareNodes);

  return children.map((c): FileTreeNode => {
    const base: FileTreeNode = { name: c.name, path: c.path, kind: c.kind };
    const withChanged = c.changed ? { ...base, changed: true } : base;
    if (c.kind === 'dir' && level < maxDepth) {
      const kids = serialize(c, level + 1, maxDepth);
      return kids.length > 0 ? { ...withChanged, children: kids } : withChanged;
    }
    return withChanged;
  });
}

function compareNodes(a: MutableNode, b: MutableNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name);
}
