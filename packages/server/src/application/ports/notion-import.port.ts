import type { ParsedNotionUrl } from '@fleex/shared';

/**
 * Outcome of asking Claude's native Notion integration to read a page and
 * synthesize it.
 *
 * Discriminated on `status`:
 *  - `ok`                      → a usable synthesis was produced.
 *  - `integration_unavailable` → no Notion tool was reachable. The user must
 *                                connect Notion to Claude before retrying.
 *  - `inaccessible`            → the page exists but could not be read, e.g. a
 *                                private/forbidden page or one that was deleted.
 *  - `empty`                   → the page was reached but contained no useful
 *                                content to summarize.
 */
export type NotionImportResult =
  | {
      readonly status: 'ok';
      /** Short, human-readable title derived from the page / synthesis. */
      readonly title: string;
      /** Faithful markdown synthesis of the page. Becomes the ticket description. */
      readonly synthesis: string;
    }
  | { readonly status: 'integration_unavailable' }
  | { readonly status: 'inaccessible'; readonly detail?: string }
  | { readonly status: 'empty' };

/**
 * Port for retrieving and synthesizing a Notion page. The concrete adapter
 * delegates to Claude via the Agent SDK, relying on the user's native Notion
 * integration. Fleex never authenticates to Notion itself, never configures an
 * MCP server, and never stores raw Notion content — only the synthesis returned
 * here is persisted.
 */
export interface NotionImportPort {
  synthesizePage(parsed: ParsedNotionUrl): Promise<NotionImportResult>;
}
