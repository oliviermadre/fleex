/**
 * Types for the "Sync overlay" feature: capturing gitignored files from a
 * worktree and pushing them into the per-repo overlay (`overlays/<org>/<name>/files`).
 *
 * Flow: the web asks the server to scan every repo of a workspace
 * (`git status --ignored`), compares each ignored file to what already lives in
 * the overlay, then copies the user-selected subset. Semantics are additive:
 * unchecked files are never removed — cleanup is a separate, explicit gesture
 * (see OverlaySyncRemoveRequest).
 */

/** Per-file comparison against the current overlay content. */
export type OverlayFileStatus =
  /** Absent from the overlay → will be created. */
  | 'new'
  /** Present in the overlay with different content → will be overwritten. */
  | 'modified'
  /** Present in the overlay with identical content → no-op. */
  | 'identical';

export interface OverlaySyncFileNode {
  readonly type: 'file';
  readonly name: string;
  /** Path relative to the worktree root (also the overlay-relative path). */
  readonly relPath: string;
  readonly status: OverlayFileStatus;
  readonly size: number;
  readonly localMtimeMs: number | null;
  readonly overlayMtimeMs: number | null;
}

export interface OverlaySyncDirNode {
  readonly type: 'dir';
  readonly name: string;
  readonly relPath: string;
  readonly children: OverlaySyncNode[];
  /** Denylisted heavy dir (node_modules, dist, …) — collapsed, not expanded. */
  readonly denylisted?: boolean;
  /** Expansion was cut short because the directory held too many files. */
  readonly truncated?: boolean;
}

export type OverlaySyncNode = OverlaySyncFileNode | OverlaySyncDirNode;

/** An entry already present in the overlay (panel ③ / cleanup). */
export interface OverlayContentEntry {
  readonly relPath: string;
  /** Present in the overlay but absent from the local ignored set → cleanup candidate. */
  readonly orphan: boolean;
}

/** One repo of the workspace the caller wants to sync. */
export interface OverlaySyncRepoTarget {
  readonly org: string;
  readonly name: string;
  /** Absolute path of the repo's worktree on the host. */
  readonly worktreePath: string;
}

export interface OverlaySyncRepoScan {
  readonly org: string;
  readonly name: string;
  readonly worktreePath: string;
  /** Absolute overlay target: overlays/<org>/<name>/files. */
  readonly overlayFilesDir: string;
  /** False when the worktree is unreachable (not copyable). */
  readonly available: boolean;
  /** Human-readable reason when `available` is false. */
  readonly message?: string;
  readonly tree: OverlaySyncNode[];
  readonly overlayContents: OverlayContentEntry[];
}

export interface OverlaySyncScanRequest {
  readonly repos: OverlaySyncRepoTarget[];
}

export interface OverlaySyncScanResponse {
  readonly groups: OverlaySyncRepoScan[];
}

/** Bounded preview of a single file, local side and/or overlay side. */
export interface OverlaySyncFilePreview {
  readonly content: string | null;
  readonly size: number;
  readonly mtimeMs: number | null;
  readonly binary: boolean;
  /** Content was cut to the preview cap. */
  readonly truncated: boolean;
}

export interface OverlaySyncPreviewRequest {
  readonly org: string;
  readonly name: string;
  readonly worktreePath: string;
  readonly relPath: string;
}

export interface OverlaySyncPreviewResponse {
  readonly relPath: string;
  readonly status: OverlayFileStatus;
  readonly local: OverlaySyncFilePreview | null;
  readonly overlay: OverlaySyncFilePreview | null;
}

export interface OverlaySyncApplyItem {
  readonly org: string;
  readonly name: string;
  readonly worktreePath: string;
  readonly relPath: string;
}

export interface OverlaySyncApplyRequest {
  readonly items: OverlaySyncApplyItem[];
}

export interface OverlaySyncCopiedEntry {
  readonly org: string;
  readonly name: string;
  readonly relPath: string;
  /** Absolute path the file was copied to. */
  readonly target: string;
  /** True when an existing overlay file was replaced. */
  readonly overwritten: boolean;
}

export interface OverlaySyncFailedEntry {
  readonly org: string;
  readonly name: string;
  readonly relPath: string;
  readonly error: string;
}

export interface OverlaySyncApplyResponse {
  readonly copied: OverlaySyncCopiedEntry[];
  readonly errors: OverlaySyncFailedEntry[];
}

export interface OverlaySyncRemoveRequest {
  readonly org: string;
  readonly name: string;
  readonly relPaths: string[];
}

export interface OverlaySyncRemoveResponse {
  readonly removed: { relPath: string }[];
  readonly errors: { relPath: string; error: string }[];
}
