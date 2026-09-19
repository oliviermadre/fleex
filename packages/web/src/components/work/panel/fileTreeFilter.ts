import type { FileTreeNode } from '@fleex/shared';

/**
 * Narrow a file tree to the files whose name contains `query` (case-insensitive).
 * Directories are kept only as ancestors of a matching file — a directory whose
 * own name matches is not a hit, since the search is for files. A blank query
 * returns the tree untouched.
 */
export function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const q = query.trim().toLowerCase();
  return q ? prune(nodes, q) : nodes;
}

function prune(nodes: FileTreeNode[], q: string): FileTreeNode[] {
  const out: FileTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.name.toLowerCase().includes(q)) out.push(node);
      continue;
    }
    const children = node.children ? prune(node.children, q) : [];
    if (children.length > 0) out.push({ ...node, children });
  }
  return out;
}
