/**
 * Mention pre-processing shared across every Markdown surface.
 *
 * We encode `@mentions` as Markdown links with a custom `#fleex-…` href prefix so
 * that react-markdown processes the rest of the content normally, and each surface
 * intercepts the mention in its `a` component override to render a chip.
 *
 * Two entry points, because the surfaces differ:
 *  - `preprocessMentions`     → comments. Encodes ALL mention types (agent /
 *    panel / skill / human / ticket / note, plus their struck-through variants)
 *    because the comment renderer knows how to render each as a chip.
 *  - `preprocessReferences`   → the generic renderer (ticket description,
 *    scratchpad, deliverables). Encodes ticket **and note** references, leaving
 *    every other `@thing` as literal text so we don't change how those surfaces
 *    render today.
 *
 * A ticket reference is `@ticket:<displayId>` (e.g. `@ticket:378`) or, for agents
 * that only know the UUID, `@ticket:<uuid>`. This canonical pattern is the single
 * source of truth for both processors.
 */

/** Href prefix an active ticket mention is encoded to (`#fleex-ticket:<id>`). */
export const TICKET_MENTION_HREF_PREFIX = '#fleex-ticket:';

import { normaliseNoteKey } from '@fleex/shared';

/** Href prefix a note reference is encoded to (`#fleex-scratchpad:<key>`). */
export const SCRATCHPAD_REF_HREF_PREFIX = '#fleex-scratchpad:';

// One or two `/`-joined segments, each ending on a word character so a reference
// closing a sentence does not swallow the period. Kept as a single fragment so
// both regexes below stay in sync, exactly like TICKET_ID.
const NOTE_REF = String.raw`[\w.-]*\w(?:\/[\w.-]*\w)?`;

/**
 * Encode a captured `@scratchpad:<value>` as a Markdown link, or return it
 * verbatim when the value names no note.
 *
 * The key is URI-encoded: a repo key contains a slash, which would end the link
 * destination early and produce a broken link.
 */
function encodeNoteRef(active: string): string {
  const key = normaliseNoteKey(active.slice('@scratchpad:'.length));
  if (key === null) return active;
  return `[${active}](${SCRATCHPAD_REF_HREF_PREFIX}${encodeURIComponent(key)})`;
}

// A uuid (fixed 36 chars) OR a numeric displayId. The uuid alternative MUST come
// first: `\d+` would otherwise match only the leading digits of a uuid. Kept as a
// single fragment so both regexes stay in sync.
const TICKET_ID = String.raw`[0-9a-fA-F-]{36}|\d+`;

/**
 * Encode ticket and note references, preserving code spans and leaving struck
 * references verbatim (remark-gfm renders `~~…~~` as strikethrough — no chip).
 * Every other `@mention` is left untouched: the generic surfaces have no chip
 * for an agent or a skill, and encoding one would render a broken link.
 */
const REFERENCE_MENTION = new RegExp(
  // 1: code span · 2: struck ticket · 3: struck note · 4: active ticket · 5: active note
  '(```[\\s\\S]*?```|`[^`]*`)' +
    `|(~~@ticket:(?:${TICKET_ID})~~)` +
    `|(~~@scratchpad:(?:${NOTE_REF})~~)` +
    `|(@ticket:(?:${TICKET_ID}))` +
    `|(@scratchpad:(?:${NOTE_REF}))`,
  'g',
);

export function preprocessReferences(body: string): string {
  return body.replace(
    REFERENCE_MENTION,
    (match, codeSpan, struckTicket, struckNote, activeTicket, activeNote) => {
      if (codeSpan !== undefined) return codeSpan;
      if (struckTicket !== undefined) return struckTicket;
      if (struckNote !== undefined) return struckNote;
      if (activeTicket !== undefined)
        return `[${activeTicket}](${TICKET_MENTION_HREF_PREFIX}${activeTicket.slice('@ticket:'.length)})`;
      if (activeNote !== undefined) return encodeNoteRef(activeNote);
      return match;
    },
  );
}

/**
 * Encode every mention type for the comment renderer.
 *
 * Mapping:
 *   @agent:name        →  [@agent:name](#fleex-agent:name)
 *   @panel:name        →  [@panel:name](#fleex-panel:name)
 *   @skill:name        →  [@skill:name](#fleex-skill:name)
 *   @workflow:slug     →  [@workflow:slug](#fleex-workflow:slug)
 *   @routine:slug      →  [@routine:slug](#fleex-routine:slug)   (reference only — never a trigger)
 *   @ticket:<id>       →  [@ticket:<id>](#fleex-ticket:<id>)
 *   @scratchpad:value  →  [@scratchpad:value](#fleex-scratchpad:key)
 *   @username          →  [@username](#fleex-human:username)
 *   ~~@…~~ (any type)  →  [@…](#fleex-struck:…)
 *
 * The `@ticket:` alternatives sit BEFORE the human fallback so `@ticket:378` is
 * never captured as an `@ticket` human mention with a dangling `:378`.
 * Content inside backtick code spans is left untouched.
 */
const ALL_MENTIONS = new RegExp(
  // 1 codeSpan
  '(```[\\s\\S]*?```|`[^`]*`)' +
    // struck variants — 2 agent · 3 panel · 4 skill · 5 workflow · 6 routine · 7 ticket · 8 note · 9 human
    '|~~(@agent:[a-zA-Z0-9_-]+)~~' +
    '|~~(@panel:[a-zA-Z0-9_-]+)~~' +
    '|~~(@skill:[a-zA-Z0-9_-]+)~~' +
    '|~~(@workflow:[a-zA-Z0-9_-]+)~~' +
    '|~~(@routine:[a-zA-Z0-9_-]+)~~' +
    `|~~(@ticket:(?:${TICKET_ID}))~~` +
    `|~~(@scratchpad:(?:${NOTE_REF}))~~` +
    '|~~(@[a-zA-Z0-9_-]+)~~' +
    // active variants — 10 agent · 11 panel · 12 skill · 13 workflow · 14 routine · 15 ticket · 16 note · 17 human
    '|(@agent:[a-zA-Z0-9_-]+)' +
    '|(@panel:[a-zA-Z0-9_-]+)' +
    '|(@skill:[a-zA-Z0-9_-]+)' +
    '|(@workflow:[a-zA-Z0-9_-]+)' +
    '|(@routine:[a-zA-Z0-9_-]+)' +
    `|(@ticket:(?:${TICKET_ID}))` +
    `|(@scratchpad:(?:${NOTE_REF}))` +
    '|(@[a-zA-Z0-9_-]+)',
  'g',
);

export function preprocessMentions(body: string): string {
  return body.replace(
    ALL_MENTIONS,
    (
      match: string,
      codeSpan: string | undefined,
      struckAgent: string | undefined,
      struckPanel: string | undefined,
      struckSkill: string | undefined,
      struckWorkflow: string | undefined,
      struckRoutine: string | undefined,
      struckTicket: string | undefined,
      struckNote: string | undefined,
      struckHuman: string | undefined,
      activeAgent: string | undefined,
      activePanel: string | undefined,
      activeSkill: string | undefined,
      activeWorkflow: string | undefined,
      activeRoutine: string | undefined,
      activeTicket: string | undefined,
      activeNote: string | undefined,
      activeHuman: string | undefined,
    ) => {
      if (codeSpan !== undefined) return codeSpan;
      if (struckAgent !== undefined) return `[${struckAgent}](#fleex-struck:${struckAgent.slice(1)})`;
      if (struckPanel !== undefined) return `[${struckPanel}](#fleex-struck:${struckPanel.slice(1)})`;
      if (struckSkill !== undefined) return `[${struckSkill}](#fleex-struck:${struckSkill.slice(1)})`;
      if (struckWorkflow !== undefined) return `[${struckWorkflow}](#fleex-struck:${struckWorkflow.slice(1)})`;
      if (struckRoutine !== undefined) return `[${struckRoutine}](#fleex-struck:${struckRoutine.slice(1)})`;
      if (struckTicket !== undefined) return `[${struckTicket}](#fleex-struck:${struckTicket.slice(1)})`;
      if (struckNote !== undefined) return `[${struckNote}](#fleex-struck:${struckNote.slice(1)})`;
      if (struckHuman !== undefined) return `[${struckHuman}](#fleex-struck:${struckHuman.slice(1)})`;
      if (activeAgent !== undefined) return `[${activeAgent}](#fleex-agent:${activeAgent.slice(1)})`;
      if (activePanel !== undefined) return `[${activePanel}](#fleex-panel:${activePanel.slice(1)})`;
      if (activeSkill !== undefined) return `[${activeSkill}](#fleex-skill:${activeSkill.slice(1)})`;
      if (activeWorkflow !== undefined) return `[${activeWorkflow}](#fleex-workflow:${activeWorkflow.slice(1)})`;
      if (activeRoutine !== undefined) return `[${activeRoutine}](#fleex-routine:${activeRoutine.slice(1)})`;
      if (activeTicket !== undefined)
        return `[${activeTicket}](${TICKET_MENTION_HREF_PREFIX}${activeTicket.slice('@ticket:'.length)})`;
      if (activeNote !== undefined) return encodeNoteRef(activeNote);
      if (activeHuman !== undefined) return `[${activeHuman}](#fleex-human:${activeHuman.slice(1)})`;
      return match;
    },
  );
}
