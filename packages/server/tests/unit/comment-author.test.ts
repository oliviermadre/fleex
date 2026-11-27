import { describe, it, expect } from 'vitest';
import { resolveCommentAuthor } from '../../src/infrastructure/http/todo-actor.js';

// CA2 / D5: what the companion Assistant (or a persona run) posts through
// `fleex ticket comment` must be signed by it, as an agent — not by the human
// whose machine runs the CLI. The CLI sends the x-fleex-actor-* headers built
// from FLEEX_ACTOR_TYPE / FLEEX_ACTOR_NAME (see packages/cli/src/core/actor.ts).
describe('resolveCommentAuthor', () => {
  it('signs the comment with the agent declared by the CLI headers', () => {
    expect(resolveCommentAuthor({ 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': 'Assistant', 'x-fleex-source': 'cli' }, 'NaS'))
      .toEqual({ authorType: 'agent', authorName: 'Assistant' });
  });

  it('decodes the URL-encoded name of a workflow step', () => {
    expect(resolveCommentAuthor({ 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': encodeURIComponent('workflow:Factory → Build') }, 'NaS'))
      .toEqual({ authorType: 'agent', authorName: 'workflow:Factory → Build' });
  });

  it('keeps the human as author for the browser and the human CLI (no actor header)', () => {
    expect(resolveCommentAuthor({}, 'NaS')).toEqual({ authorType: 'user', authorName: 'NaS' });
    expect(resolveCommentAuthor({ 'x-fleex-source': 'cli' }, 'NaS')).toEqual({ authorType: 'user', authorName: 'NaS' });
  });

  it('never lets a header rename the human: a "user" actor stays the configured human', () => {
    expect(resolveCommentAuthor({ 'x-fleex-actor-type': 'user', 'x-fleex-actor-name': 'someone-else' }, 'NaS'))
      .toEqual({ authorType: 'user', authorName: 'NaS' });
  });

  it('falls back to the human when the agent header has no name', () => {
    expect(resolveCommentAuthor({ 'x-fleex-actor-type': 'agent' }, 'NaS')).toEqual({ authorType: 'user', authorName: 'NaS' });
  });
});
