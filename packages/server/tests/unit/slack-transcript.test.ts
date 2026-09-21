import { describe, it, expect } from 'vitest';
import { formatSlackTranscript, collectUserIds, type SlackMessage } from '../../src/domain/services/slack-transcript.js';

const msg = (over: Partial<SlackMessage>): SlackMessage => ({ ts: '1700000000.000100', text: '', ...over });
const names = new Map([['U1', 'Ana'], ['U2', 'Léo']]);

describe('formatSlackTranscript', () => {
  it('writes who said what, in order, with a readable UTC time', () => {
    const out = formatSlackTranscript(
      [msg({ user: 'U1', text: 'Quota blew up' }), msg({ user: 'U2', text: 'On it', ts: '1700000060.000200' })],
      names,
    );

    expect(out).toBe('[2023-11-14 22:13] Ana: Quota blew up\n[2023-11-14 22:14] Léo: On it');
  });

  it('turns Slack markup into what a reader (and the summary) can understand', () => {
    const out = formatSlackTranscript(
      [msg({ user: 'U1', text: 'cc <@U2> see <#C9|odys-dev> and <https://x.io/a|the doc> &amp; <https://y.io> &lt;3 <!here>' })],
      names,
    );

    expect(out).toContain('cc @Léo see #odys-dev and the doc (https://x.io/a) & https://y.io <3 @here');
  });

  it('never drops a speaker: unknown users keep their id, bots keep their name', () => {
    const out = formatSlackTranscript(
      [msg({ user: 'U404', text: 'hi <@U404>' }), msg({ bot_id: 'B1', username: 'Sentry', text: 'alert' }), msg({ text: 'orphan' })],
      names,
    );

    expect(out).toContain('U404: hi @U404');
    expect(out).toContain('Sentry: alert');
    expect(out).toContain('unknown: orphan');
  });

  it('keeps a trace of files, which are often the whole point of a message', () => {
    const out = formatSlackTranscript([msg({ user: 'U1', text: '', files: [{ name: 'trace.png' }, { title: 'Spec' }] })], names);

    expect(out).toContain('Ana: [file: trace.png] [file: Spec]');
  });

  it('skips join/leave noise and blank messages', () => {
    const out = formatSlackTranscript(
      [msg({ user: 'U1', text: 'joined', subtype: 'channel_join' }), msg({ user: 'U1', text: '   ' }), msg({ user: 'U2', text: 'real' })],
      names,
    );

    expect(out).toBe('[2023-11-14 22:13] Léo: real');
  });
});

describe('collectUserIds', () => {
  it('finds authors AND mentioned users, once each, so every name can be resolved', () => {
    expect(collectUserIds([msg({ user: 'U1', text: 'ping <@U2> and <@U2|leo> and <@U3>' }), msg({ user: 'U1' })]).sort()).toEqual(['U1', 'U2', 'U3']);
  });
});
