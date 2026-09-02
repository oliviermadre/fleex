/**
 * Regression tests for the bug this ticket reports: a Catalyst spec that
 * *documented* an escape sequence could not be saved, the workflow step failed,
 * and every relaunch reproduced the identical failure — the ticket was stuck in
 * a loop.
 *
 * The trigger is not exotic (spec §2.2): the agent authors the six visible
 * characters of an escape sequence, and a single dropped backslash in the
 * emitted JSON makes the parser yield one real NUL. Postgres then refuses the
 * `text` cast with 22P05.
 */

import { describe, it, expect, vi } from 'vitest';
import { hasUnstorableChars } from '@fleex/shared';
import { SubmitDeliverableUseCase } from '../../src/application/use-cases/submit-deliverable.js';
import type { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';

// D5 / spec §0 — no literal escape sequence, no raw NUL in source.
const cu = (n: number) => String.fromCharCode(n);
const BS = cu(92);
const NUL = cu(0);
const escOf = (ch: string) => BS + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0');

/**
 * The shape that actually broke attempt 1: a spec proposing a sentinel, where
 * the escape sequence the author typed arrived as one real NUL.
 */
const AUTHORED_SPEC =
  '# Spec — renderer sentinel\n\n' +
  'Replace the space-delimited placeholder with ' + NUL + ', which is\n' +
  'structurally unforgeable because `mdInline()` only ever receives\n' +
  'HTML-escaped input.\n';

const setup = () => {
  const saved: TicketDeliverableEntity[] = [];
  const deliverableStore = {
    save: vi.fn(async (d: TicketDeliverableEntity) => { saved.push(d); }),
  };
  const ticketStore = { saveActivity: vi.fn(async () => {}) };
  const config = { get: () => ({}) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const uc = new SubmitDeliverableUseCase(
    deliverableStore as never,
    ticketStore as never,
    config as never,
    logger as never,
  );

  return { uc, saved, deliverableStore, ticketStore };
};

const submit = (uc: SubmitDeliverableUseCase, content = AUTHORED_SPEC) =>
  uc.execute({
    ticketId: 't-1',
    agentName: 'catalyst',
    type: 'spec',
    title: 'Spec — renderer sentinel ' + NUL,
    content,
    status: 'final',
  });

describe('SubmitDeliverableUseCase storage safety', () => {
  it('hands the store a content the database can actually accept', async () => {
    // AC 19. Asserted on code units via `hasUnstorableChars`, NOT as a
    // substring of JSON.stringify: escaping makes the serialiser double the
    // backslash, so the tail of the serialised text *is* the sequence a naive
    // substring check looks for — that check fails on correct output (§6.0).
    const { uc, saved } = setup();

    await submit(uc);

    expect(saved).toHaveLength(1);
    expect(hasUnstorableChars(saved[0]!.content)).toBe(false);
    expect(hasUnstorableChars(saved[0]!.title)).toBe(false);
  });

  it('preserves what the author meant to write, rather than deleting it', async () => {
    // D2 — the whole point of escaping over stripping. Dropping the character
    // would silently gut the sentence that is *about* that character.
    const { uc, saved } = setup();

    await submit(uc);

    expect(saved[0]!.content).toContain('placeholder with ' + escOf(NUL) + ', which is');
    expect(saved[0]!.content).toContain('structurally unforgeable');
  });

  it('records an activity row the database can accept too', async () => {
    // The activity payload is a second jsonb write on the same path; fixing
    // only the deliverable would just move the failure.
    const { uc, ticketStore } = setup();

    await submit(uc);

    const activity = ticketStore.saveActivity.mock.calls[0]![0] as { changes: unknown };
    expect(hasUnstorableChars(JSON.stringify(activity.changes))).toBe(false);
  });

  it('produces byte-identical content when the same payload is submitted twice', async () => {
    // AC 21 — this is what unblocks the reported loop. A relaunch regenerates
    // the same markdown; it must land the same way instead of failing again.
    const { uc, saved } = setup();

    await submit(uc);
    await submit(uc);

    expect(saved).toHaveLength(2);
    expect(saved[1]!.content).toBe(saved[0]!.content);
    expect(saved[1]!.title).toBe(saved[0]!.title);
  });

  it('leaves a spec with no unstorable character completely untouched', async () => {
    // Non-objective guard (D1): this is a storage guarantee, not a text
    // cleaner. A normal spec must round-trip byte-for-byte.
    const { uc, saved } = setup();
    const normal = '# Spec\n\nTabs\there, emoji 😀, CJK 漢字, accents éàü.\n';

    await submit(uc, normal);

    expect(saved[0]!.content).toBe(normal);
  });
});
