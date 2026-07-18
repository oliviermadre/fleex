import type {
  OverlayFileStatus,
  OverlaySyncFileNode,
  OverlaySyncNode,
  OverlaySyncDirNode,
} from '@fleex/shared';

/**
 * Directory names that are heavy build/dependency artifacts. When
 * `git status --ignored` collapses one of these into a single entry we keep it
 * collapsed and unchecked rather than walking (potentially) millions of files.
 */
export const DENYLIST_DIRS = new Set<string>([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  'vendor',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.idea',
  'tmp',
]);

/** True when any path segment matches the heavy-dir denylist. */
export function isDenylistedDir(relPath: string): boolean {
  return relPath
    .split('/')
    .filter(Boolean)
    .some((segment) => DENYLIST_DIRS.has(segment));
}

/**
 * A relPath is safe to copy/remove when it stays inside the worktree/overlay
 * root: no absolute paths, no `..` traversal, no empty/`.` segments.
 */
export function isSafeRelPath(relPath: string): boolean {
  if (!relPath || relPath.startsWith('/') || relPath.includes('\0')) return false;
  const segments = relPath.split('/');
  return segments.every((s) => s !== '' && s !== '.' && s !== '..');
}

export interface ParsedIgnored {
  /** Individually ignored files (no trailing slash in porcelain output). */
  files: string[];
  /** Whole ignored directories git collapsed (trailing slash in porcelain output). */
  dirs: string[];
}

/**
 * Parse the output of `git status --ignored --porcelain -z`, keeping only the
 * ignored (`!!`) entries. Git collapses a fully-ignored directory into a single
 * `dir/` entry; those land in `dirs`, individual files in `files`.
 */
export function parseIgnoredEntries(porcelainZ: string): ParsedIgnored {
  const files: string[] = [];
  const dirs: string[] = [];
  for (const raw of porcelainZ.split('\0')) {
    if (raw.length < 4) continue;
    const code = raw.slice(0, 2);
    if (code !== '!!') continue;
    // Format: "XY<space>PATH"
    const path = raw.slice(3);
    if (!path) continue;
    if (path.endsWith('/')) dirs.push(path.slice(0, -1));
    else files.push(path);
  }
  return { files, dirs };
}

/** Classify a local file against its overlay counterpart (null = absent). */
export function classifyStatus(
  localContent: string,
  overlayContent: string | null,
): OverlayFileStatus {
  if (overlayContent === null) return 'new';
  return overlayContent === localContent ? 'identical' : 'modified';
}

export interface CollapsedDir {
  relPath: string;
  denylisted?: boolean;
  truncated?: boolean;
}

/**
 * Assemble a nested tree from a flat list of file nodes plus collapsed
 * directory markers. Directories are created on demand from each file's
 * relPath. Children are sorted directories-first, then alphabetically.
 */
export function buildTree(
  files: OverlaySyncFileNode[],
  collapsedDirs: CollapsedDir[] = [],
): OverlaySyncNode[] {
  const root: OverlaySyncNode[] = [];

  const ensureDir = (
    children: OverlaySyncNode[],
    name: string,
    relPath: string,
  ): OverlaySyncDirNode => {
    const existing = children.find(
      (n): n is OverlaySyncDirNode => n.type === 'dir' && n.name === name,
    );
    if (existing) return existing;
    const node: OverlaySyncDirNode = { type: 'dir', name, relPath, children: [] };
    children.push(node);
    return node;
  };

  const descend = (relPath: string): { children: OverlaySyncNode[]; name: string } => {
    const segments = relPath.split('/').filter(Boolean);
    let children = root;
    let acc = '';
    for (let i = 0; i < segments.length - 1; i++) {
      acc = acc ? `${acc}/${segments[i]}` : segments[i]!;
      children = ensureDir(children, segments[i]!, acc).children;
    }
    return { children, name: segments[segments.length - 1]! };
  };

  for (const file of files) {
    const { children, name } = descend(file.relPath);
    // Avoid duplicate insertion of the same relPath.
    if (children.some((n) => n.type === 'file' && n.relPath === file.relPath)) continue;
    children.push({ ...file, name });
  }

  for (const dir of collapsedDirs) {
    const { children, name } = descend(dir.relPath);
    const node = ensureDir(children, name, dir.relPath);
    if (dir.denylisted) (node as { denylisted?: boolean }).denylisted = true;
    if (dir.truncated) (node as { truncated?: boolean }).truncated = true;
  }

  sortNodes(root);
  return root;
}

function sortNodes(nodes: OverlaySyncNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.type === 'dir') sortNodes(node.children);
  }
}
