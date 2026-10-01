import { describe, expect, it } from 'vitest';
import { CLICK_MENU, inMenuFor, legacyClickByStatus, resolveClickAction } from '@fleex/shared';
import type { PinnedIcon } from '@fleex/shared';

// The user's k9s case: a main `k9s`, two context commands both offered in OK.
const k9s: PinnedIcon = {
  id: 'k9s', icon: '', iconType: 'svg', label: 'k9s', actionType: 'shell', actionValue: 'k9s',
  status: { command: 'true', intervalSec: 60 },
  conditionalActions: [
    { id: 'stg', label: 'k9s staging', when: ['ok'], actionType: 'shell', actionValue: 'k9s --context staging' },
    { id: 'prd', label: 'k9s production', when: ['ok'], actionType: 'shell', actionValue: 'k9s --context production' },
  ],
};

describe('left click vs right-click menu', () => {
  it('legacy config (no clickByStatus) keeps "first matching rule wins", so nothing changes on upgrade', () => {
    expect(resolveClickAction(k9s, 'ok').actionValue).toBe('k9s --context staging');
    expect(resolveClickAction(k9s, 'ko').actionValue).toBe('k9s');
    expect(legacyClickByStatus(k9s)).toEqual({ ok: 'stg', warn: 'main', ko: 'main', unknown: 'main' });
  });

  it('with clickByStatus, the menu filter no longer decides the left click', () => {
    const icon = { ...k9s, clickByStatus: { ok: 'main', ko: 'prd' } };
    expect(resolveClickAction(icon, 'ok').actionValue).toBe('k9s');
    // `prd` is only *offered in the menu* in OK, yet it is the KO left click.
    expect(resolveClickAction(icon, 'ko').actionValue).toBe('k9s --context production');
    expect(resolveClickAction(icon, 'warn').rule).toBeNull();
  });

  it('a choice pointing at a deleted command falls back to the main one', () => {
    expect(resolveClickAction({ ...k9s, clickByStatus: { ok: 'gone' } }, 'ok').actionValue).toBe('k9s');
  });

  it('"open the menu" is flagged, with the main command for callers that cannot show a menu', () => {
    const target = resolveClickAction({ ...k9s, clickByStatus: { unknown: CLICK_MENU } }, 'unknown');
    expect(target.openMenu).toBe(true);
    expect(target.actionValue).toBe('k9s');
  });

  it('without a probe the click is always the main command', () => {
    const { status: _s, ...noProbe } = k9s;
    expect(resolveClickAction({ ...noProbe, clickByStatus: { ok: 'prd' } }, null).actionValue).toBe('k9s');
  });

  it('a command is offered in the menu for its statuses; none ticked or no probe = always', () => {
    expect(inMenuFor({ when: ['ok'] }, 'ko')).toBe(false);
    expect(inMenuFor({ when: ['ok'] }, 'ok')).toBe(true);
    expect(inMenuFor({ when: [] }, 'ko')).toBe(true);
    expect(inMenuFor({ when: ['ok'] }, null)).toBe(true);
  });
});
