import { describe, it, expect } from 'vitest';
import { preprocessMentions, preprocessTicketMentions } from './mentions';

const UUID = '05d50f27-b12e-4338-8c36-e840fd288222';

describe('preprocessTicketMentions (ticket-only — used by the generic Markdown renderer)', () => {
  it('rewrites @ticket:<displayId> to a #fleex-ticket link', () => {
    expect(preprocessTicketMentions('Blocked by @ticket:378')).toBe(
      'Blocked by [@ticket:378](#fleex-ticket:378)',
    );
  });

  it('rewrites @ticket:<uuid> to a #fleex-ticket link', () => {
    expect(preprocessTicketMentions(`See @ticket:${UUID}`)).toBe(
      `See [@ticket:${UUID}](#fleex-ticket:${UUID})`,
    );
  });

  it('leaves a ticket mention inside an inline code span untouched', () => {
    expect(preprocessTicketMentions('use `@ticket:378` verbatim')).toBe(
      'use `@ticket:378` verbatim',
    );
  });

  it('leaves a ticket mention inside a fenced code block untouched', () => {
    expect(preprocessTicketMentions('```\n@ticket:378\n```')).toBe('```\n@ticket:378\n```');
  });

  it('leaves a struck ticket mention verbatim (GFM renders it as strikethrough text)', () => {
    expect(preprocessTicketMentions('~~@ticket:378~~ done')).toBe('~~@ticket:378~~ done');
  });

  it('does not touch other mention types (they stay literal in non-comment surfaces)', () => {
    expect(preprocessTicketMentions('hello @agent:catalyst and @olivier')).toBe(
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
