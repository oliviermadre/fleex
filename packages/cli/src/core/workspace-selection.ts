/**
 * Single source of truth for *which* workspace this CLI process targets and
 * *how* that choice was made.
 *
 * The subtlety this module exists to solve: `activateWorkspace()` writes the
 * chosen name into `process.env.FLEEX_WORKSPACE` (so the server subprocess and a
 * later `resolveInstance()` see it). But an env var is indistinguishable from one
 * *inherited* from the user's shell — which is exactly how an ambient
 * `FLEEX_WORKSPACE` can silently steer the CLI to another instance. So whenever a
 * command *explicitly* activates a workspace (via a `--workspace` flag or by
 * resolving the default), we also record it here, in **in-process** state that
 * never leaks to child processes. `resolveWorkspaceSelection()` (in instance.ts)
 * then trusts this over the ambient env, and can label the true source.
 *
 * Zero dependencies on purpose: it is imported by both `workspaces.ts` (writer)
 * and `instance.ts` (reader), so keeping it dependency-free avoids an import
 * cycle between those two modules.
 */

/** How the targeted workspace was chosen, most-authoritative first. */
export type WorkspaceSource = 'flag' | 'env' | 'default' | 'legacy';

interface Selection {
  name: string;
  /** 'flag' when chosen via `--workspace`, 'default' when resolved as is_default. */
  source: 'flag' | 'default';
}

let selected: Selection | null = null;

/**
 * Record the workspace an explicit activation resolved to. Called by
 * {@link activateWorkspace}: a caller-supplied name means a `--workspace` flag,
 * an absent one means the configured default workspace.
 */
export function setSelectedWorkspace(name: string, source: 'flag' | 'default'): void {
  selected = { name, source };
}

/** The workspace recorded by an explicit activation, or null if none happened. */
export function getSelectedWorkspace(): Readonly<Selection> | null {
  return selected;
}

/** Test-only: forget any recorded activation so each case starts clean. */
export function resetSelectedWorkspace(): void {
  selected = null;
}
