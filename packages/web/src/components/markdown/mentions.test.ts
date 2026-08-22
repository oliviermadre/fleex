import { describe, it, expect } from 'vitest';
import { preprocessMentions, preprocessReferences, SCRATCHPAD_REF_HREF_PREFIX } from './mentions';

const UUID = '05d50f27-b12e-4338-8c36-e840fd288222';

describe('preprocessReferences (ticket-only — used by the generic Markdown renderer)', () => {
  it('rewrites @ticket:<displayId> to a #fleex-ticket link', () => {
    expect(preprocessReferences('Blocked by @ticket:378')).toBe(
      'Blocked by [@ticket:378](#fleex-ticket:378)',
    );
  });

  it('rewrites @ticket:<uuid> to a #fleex-ticket link', () => {
    expect(preprocessReferences(`See @ticket:${UUID}`)).toBe(
      `See [@ticket:${UUID}](#fleex-ticket:${UUID})`,
    );
  });

  it('leaves a ticket mention inside an inline code span untouched', () => {
    expect(preprocessReferences('use `@ticket:378` verbatim')).toBe(
      'use `@ticket:378` verbatim',
    );
  });

  it('leaves a ticket mention inside a fenced code block untouched', () => {
    expect(preprocessReferences('```\n@ticket:378\n```')).toBe('```\n@ticket:378\n```');
  });

  it('leaves a struck ticket mention verbatim (GFM renders it as strikethrough text)', () => {
    expect(preprocessReferences('~~@ticket:378~~ done')).toBe('~~@ticket:378~~ done');
  });

  it('does not touch other mention types (they stay literal in non-comment surfaces)', () => {
    expect(preprocessReferences('hello @agent:catalyst and @olivier')).toBe(
      'hello @agent:catalyst and @olivier',
    );
  });
});

describe('preprocessMentions (comments — every mention type incl. tickets)', () => {
  it('rewrites a ticket mention BEFORE the human fallback (not captured as an @ticket human)', () => {
    expect(preprocessMentions('ref @ticket:378')).toBe('ref [@ticket:378](#fleex-ticket:378)');
  });

  it('rewrites a ticket mention by uuid', () => {
    expect(preprocessMentions(`ref @ticket:${UUID}`)).toBe(
      `ref [@ticket:${UUID}](#fleex-ticket:${UUID})`,
    );
  });

  // NB: the existing encoding keeps the type prefix in the href (e.g.
  // `#fleex-agent:agent:name`) so the comment `a` handler round-trips the full
  // `@agent:name` text. These assertions lock that pre-existing behavior.
  it('still rewrites agent mentions', () => {
    expect(preprocessMentions('@agent:catalyst')).toBe(
      '[@agent:catalyst](#fleex-agent:agent:catalyst)',
    );
  });

  it('still rewrites panel mentions', () => {
    expect(preprocessMentions('@panel:squad')).toBe('[@panel:squad](#fleex-panel:panel:squad)');
  });

  it('still rewrites skill mentions', () => {
    expect(preprocessMentions('@skill:review')).toBe('[@skill:review](#fleex-skill:skill:review)');
  });

  // The launcher/autocompletes teach `@workflow:slug` as the invocation syntax
  // and the server executes it (extractWorkflowMentions) — the comment renderer
  // must chip it like every other actionable mention type, not leave it as text.
  it('rewrites workflow mentions', () => {
    expect(preprocessMentions('@workflow:deploy')).toBe(
      '[@workflow:deploy](#fleex-workflow:workflow:deploy)',
    );
  });

  it('handles struck workflow mentions', () => {
    expect(preprocessMentions('~~@workflow:deploy~~')).toBe(
      '[@workflow:deploy](#fleex-struck:workflow:deploy)',
    );
  });

  // Routines are referenceable with the same `@type:slug` convention as every
  // other primitive — but reference ONLY: no server-side extraction exists on
  // purpose, so a routine mention must chip in the UI yet never trigger a run.
  it('rewrites routine mentions (reference-only chip)', () => {
    expect(preprocessMentions('@routine:amelioration-continue')).toBe(
      '[@routine:amelioration-continue](#fleex-routine:routine:amelioration-continue)',
    );
  });

  it('handles struck routine mentions', () => {
    expect(preprocessMentions('~~@routine:daily-recap~~')).toBe(
      '[@routine:daily-recap](#fleex-struck:routine:daily-recap)',
    );
  });

  it('still rewrites human mentions via the fallback', () => {
    expect(preprocessMentions('hi @olivier')).toBe('hi [@olivier](#fleex-human:olivier)');
  });

  it('still handles struck agent mentions', () => {
    expect(preprocessMentions('~~@agent:catalyst~~')).toBe(
      '[@agent:catalyst](#fleex-struck:agent:catalyst)',
    );
  });

  it('renders a struck ticket mention as a struck span (comment surface)', () => {
    expect(preprocessMentions('~~@ticket:378~~')).toBe('[@ticket:378](#fleex-struck:ticket:378)');
  });

  it('preserves code spans', () => {
    expect(preprocessMentions('`@ticket:1`')).toBe('`@ticket:1`');
  });
});

describe('preprocessReferences — note references', () => {
  it('encodes a repo note', () => {
    expect(preprocessReferences('see @scratchpad:acme/app'))
      .toBe('see [@scratchpad:acme/app](#fleex-scratchpad:acme%2Fapp)');
  });

  it('encodes the global note to its storage key', () => {
    expect(preprocessReferences('see @scratchpad:global'))
      .toBe('see [@scratchpad:global](#fleex-scratchpad:__global__)');
  });

  it('lowercases the key in the href but keeps the typed label', () => {
    expect(preprocessReferences('@scratchpad:Acme/App'))
      .toBe('[@scratchpad:Acme/App](#fleex-scratchpad:acme%2Fapp)');
  });

  it('leaves a value that names no note verbatim', () => {
    expect(preprocessReferences('@scratchpad:my-idea')).toBe('@scratchpad:my-idea');
  });

  it('leaves a reference inside an inline code span alone', () => {
    expect(preprocessReferences('write `@scratchpad:acme/app`')).toBe('write `@scratchpad:acme/app`');
  });

  it('leaves a struck reference as strikethrough text', () => {
    expect(preprocessReferences('~~@scratchpad:acme/app~~')).toBe('~~@scratchpad:acme/app~~');
  });

  it('still encodes ticket mentions', () => {
    expect(preprocessReferences('@ticket:378')).toBe('[@ticket:378](#fleex-ticket:378)');
  });

  it('encodes both kinds in one document', () => {
    expect(preprocessReferences('@ticket:7 and @scratchpad:global'))
      .toBe('[@ticket:7](#fleex-ticket:7) and [@scratchpad:global](#fleex-scratchpad:__global__)');
  });

  it('exposes the href prefix it encodes to', () => {
    expect(SCRATCHPAD_REF_HREF_PREFIX).toBe('#fleex-scratchpad:');
  });
});

describe('preprocessMentions — note references', () => {
  it('encodes a note reference without being eaten by the human fallback', () => {
    // `@[a-zA-Z0-9_-]+` would otherwise capture `@scratchpad` and leave
    // `:acme/app` dangling — the same trap the @ticket: ordering guards against.
    expect(preprocessMentions('see @scratchpad:acme/app'))
      .toBe('see [@scratchpad:acme/app](#fleex-scratchpad:acme%2Fapp)');
  });

  it('encodes a struck note reference the way every other struck mention is encoded', () => {
    expect(preprocessMentions('~~@scratchpad:global~~'))
      .toBe('[@scratchpad:global](#fleex-struck:scratchpad:global)');
  });

  it('still encodes an agent mention', () => {
    expect(preprocessMentions('@agent:catalyst')).toBe(
      '[@agent:catalyst](#fleex-agent:agent:catalyst)',
    );
  });
});
