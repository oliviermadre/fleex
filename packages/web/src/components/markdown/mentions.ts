/**
 * Mention pre-processing shared across every Markdown surface.
 *
 * We encode `@mentions` as Markdown links with a custom `#fleex-…` href prefix so
 * that react-markdown processes the rest of the content normally, and each surface
 * intercepts the mention in its `a` component override to render a chip.
 *
 * Two entry points, because the surfaces differ:
 *  - `preprocessMentions`        → comments. Encodes ALL mention types (agent /
 *    panel / skill / human / ticket, plus their struck-through variants) because
 *    the comment renderer knows how to render each as a chip.
 *  - `preprocessTicketMentions`  → the generic renderer (ticket description,
 *    scratchpad, deliverables). Encodes ONLY ticket mentions, leaving every other
 *    `@thing` as literal text so we don't change how those surfaces render today.
 *
 * A ticket reference is `@ticket:<displayId>` (e.g. `@ticket:378`) or, for agents
 * that only know the UUID, `@ticket:<uuid>`. This canonical pattern is the single
 * source of truth for both processors.
 */

/** Href prefix an active ticket mention is encoded to (`#fleex-ticket:<id>`). */
export const TICKET_MENTION_HREF_PREFIX = '#fleex-ticket:';

// A uuid (fixed 36 chars) OR a numeric displayId. The uuid alternative MUST come
// first: `\d+` would otherwise match only the leading digits of a uuid. Kept as a
// single fragment so both regexes stay in sync.
const TICKET_ID = String.raw`[0-9a-fA-F-]{36}|\d+`;

/**
 * Encode ONLY ticket mentions, preserving code spans and leaving struck ticket
 * mentions verbatim (remark-gfm renders `~~…~~` as strikethrough text — no chip).
 * Every other `@mention` is left untouched.
 */
const TICKET_ONLY_MENTION = new RegExp(
  // 1: code span (verbatim) · 2: struck ticket (verbatim) · 3: active ticket
  '(```[\\s\\S]*?```|`[^`]*`)' +
    `|(~~@ticket:(?:${TICKET_ID})~~)` +
    `|(@ticket:(?:${TICKET_ID}))`,
  'g',
);

export function preprocessTicketMentions(body: string): string {
  return body.replace(TICKET_ONLY_MENTION, (match, codeSpan, struck, active) => {
    if (codeSpan !== undefined) return codeSpan;
    if (struck !== undefined) return struck;
    if (active !== undefined)
      return `[${active}](${TICKET_MENTION_HREF_PREFIX}${active.slice('@ticket:'.length)})`;
    return match;
  });
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
    // struck variants — 2 agent · 3 panel · 4 skill · 5 workflow · 6 routine · 7 ticket · 8 human
    '|~~(@agent:[a-zA-Z0-9_-]+)~~' +
    '|~~(@panel:[a-zA-Z0-9_-]+)~~' +
    '|~~(@skill:[a-zA-Z0-9_-]+)~~' +
    '|~~(@workflow:[a-zA-Z0-9_-]+)~~' +
    '|~~(@routine:[a-zA-Z0-9_-]+)~~' +
    `|~~(@ticket:(?:${TICKET_ID}))~~` +
    '|~~(@[a-zA-Z0-9_-]+)~~' +
    // active variants — 9 agent · 10 panel · 11 skill · 12 workflow · 13 routine · 14 ticket · 15 human
    '|(@agent:[a-zA-Z0-9_-]+)' +
    '|(@panel:[a-zA-Z0-9_-]+)' +
    '|(@skill:[a-zA-Z0-9_-]+)' +
    '|(@workflow:[a-zA-Z0-9_-]+)' +
    '|(@routine:[a-zA-Z0-9_-]+)' +
    `|(@ticket:(?:${TICKET_ID}))` +
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
      struckHuman: string | undefined,
      activeAgent: string | undefined,
      activePanel: string | undefined,
      activeSkill: string | undefined,
      activeWorkflow: string | undefined,
      activeRoutine: string | undefined,
      activeTicket: string | undefined,
      activeHuman: string | undefined,
    ) => {
      if (codeSpan !== undefined) return codeSpan;
      if (struckAgent !== undefined) return `[${struckAgent}](#fleex-struck:${struckAgent.slice(1)})`;
      if (struckPanel !== undefined) return `[${struckPanel}](#fleex-struck:${struckPanel.slice(1)})`;
      if (struckSkill !== undefined) return `[${struckSkill}](#fleex-struck:${struckSkill.slice(1)})`;
      if (struckWorkflow !== undefined) return `[${struckWorkflow}](#fleex-struck:${struckWorkflow.slice(1)})`;
      if (struckRoutine !== undefined) return `[${struckRoutine}](#fleex-struck:${struckRoutine.slice(1)})`;
      if (struckTicket !== undefined) return `[${struckTicket}](#fleex-struck:${struckTicket.slice(1)})`;
      if (struckHuman !== undefined) return `[${struckHuman}](#fleex-struck:${struckHuman.slice(1)})`;
      if (activeAgent !== undefined) return `[${activeAgent}](#fleex-agent:${activeAgent.slice(1)})`;
      if (activePanel !== undefined) return `[${activePanel}](#fleex-panel:${activePanel.slice(1)})`;
      if (activeSkill !== undefined) return `[${activeSkill}](#fleex-skill:${activeSkill.slice(1)})`;
      if (activeWorkflow !== undefined) return `[${activeWorkflow}](#fleex-workflow:${activeWorkflow.slice(1)})`;
      if (activeRoutine !== undefined) return `[${activeRoutine}](#fleex-routine:${activeRoutine.slice(1)})`;
      if (activeTicket !== undefined)
        return `[${activeTicket}](${TICKET_MENTION_HREF_PREFIX}${activeTicket.slice('@ticket:'.length)})`;
      if (activeHuman !== undefined) return `[${activeHuman}](#fleex-human:${activeHuman.slice(1)})`;
      return match;
    },
  );
}
