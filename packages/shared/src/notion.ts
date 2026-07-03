/**
 * Parsing utilities for Notion page links.
 *
 * Notion workspace links look like:
 *   https://www.notion.so/<32-hex-id>
 *   https://www.notion.so/Page-Title-<32-hex-id>
 *   https://www.notion.so/<workspace>/Page-Title-<32-hex-id>
 *   https://www.notion.so/<workspace>/<dashed-uuid>?v=<viewId>   (a database view)
 *
 * The trailing segment of the path always ends in the page (or database) id:
 * either a compact 32-hex string (the form browsers copy) or a dashed UUID
 * (8-4-4-4-12). When the link carries a `?v=<viewId>` query it targets a
 * *database view* rather than a plain page.
 *
 * This module is the single source of truth used by both the frontend (to
 * detect a pasted Notion link in the ticket-creation field) and the backend
 * (to validate the link before delegating retrieval to Claude's native Notion
 * integration). It is purely syntactic — it never contacts Notion. Public
 * `notion.site` sites are intentionally out of scope (heterogeneous id formats).
 */

/**
 * Matches a Notion workspace page/database URL on `notion.so` (with or without
 * the `www.` prefix). The path may carry an optional workspace segment and an
 * optional human-readable title slug before the id. A trailing slash and the
 * query string / fragment are all optional, mirroring the leniency of the
 * GitHub-issue and Slack matchers so a stray slash or tracking param from the
 * clipboard does not break detection.
 *
 * Capture groups:
 *   1. workspace slug (when the path has a `<workspace>/<slug-id>` shape)
 *   2. the page/database id (compact 32-hex or dashed UUID)
 */
export const NOTION_URL_RE =
  /^https?:\/\/(?:www\.)?notion\.so\/(?:([^/?#]+)\/)?(?:[^/?#]*-)?([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#][^\s]*)?$/i;

export interface ParsedNotionUrl {
  /** Page (or database) id normalized to a dashed UUID (8-4-4-4-12), lower-case. */
  readonly pageId: string;
  /** Workspace slug when the URL carries one (`notion.so/<workspace>/…`), else `null`. */
  readonly workspace: string | null;
  /** True when the link targets a database *view* (`?v=<viewId>`) rather than a page. */
  readonly isDatabaseView: boolean;
  /** The original, normalized (trimmed) URL that was parsed. */
  readonly url: string;
}

/**
 * Normalizes a captured Notion id (compact 32-hex or already-dashed UUID) into a
 * canonical lower-case dashed UUID (8-4-4-4-12). The id is the stable handle the
 * synthesis prompt hands to Claude's Notion integration.
 */
function normalizePageId(raw: string): string {
  const hex = raw.replace(/-/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * True when the URL's query string contains a `v` param — Notion's marker that
 * the link points at a database *view* rather than a plain page.
 */
function hasDatabaseView(url: string): boolean {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return false;
  const afterQuery = url.slice(queryIndex + 1);
  const hashIndex = afterQuery.indexOf('#');
  const query = hashIndex === -1 ? afterQuery : afterQuery.slice(0, hashIndex);
  return new URLSearchParams(query).has('v');
}

/**
 * Parses a Notion page/database URL. Returns `null` when the input is not a
 * recognizable Notion workspace link.
 */
export function parseNotionUrl(url: string): ParsedNotionUrl | null {
  const trimmed = url.trim();
  const match = NOTION_URL_RE.exec(trimmed);
  if (!match) return null;

  const [, workspace, rawId] = match;
  if (!rawId) return null;

  return {
    pageId: normalizePageId(rawId),
    workspace: workspace ?? null,
    isDatabaseView: hasDatabaseView(trimmed),
    url: trimmed,
  };
}

/** Convenience predicate mirroring the frontend GitHub-issue / Slack detection helpers. */
export function isNotionUrl(url: string): boolean {
  return NOTION_URL_RE.test(url.trim());
}

/**
 * Reserved ticket tags used to carry the asynchronous Notion-import lifecycle on
 * the ticket itself. Because reading a Notion page through Claude's native
 * integration is slow, the import runs in the background: the ticket is created
 * immediately with {@link NOTION_IMPORT_PENDING_TAG}, then on completion the tag
 * is cleared (success) or swapped to {@link NOTION_IMPORT_FAILED_TAG} (failure).
 * Tags are persisted in every store and shipped in the ticket DTO, so this state
 * is reload-safe and lets the UI render a spinner / retry affordance without a
 * new schema field. (Same mechanism as the Slack import lifecycle tags.)
 */
export const NOTION_IMPORT_PENDING_TAG = 'notion-import-pending';
export const NOTION_IMPORT_FAILED_TAG = 'notion-import-failed';

/** All reserved Notion-import lifecycle tags. */
export const NOTION_IMPORT_TAGS: readonly string[] = [
  NOTION_IMPORT_PENDING_TAG,
  NOTION_IMPORT_FAILED_TAG,
];

/** True when `tag` is one of the reserved Notion-import lifecycle tags (not a user tag). */
export function isNotionImportTag(tag: string): boolean {
  return tag === NOTION_IMPORT_PENDING_TAG || tag === NOTION_IMPORT_FAILED_TAG;
}
