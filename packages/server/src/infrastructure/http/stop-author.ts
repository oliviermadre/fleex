import type { StopAuthor } from '@fleex/shared';

type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * Who stops a run through an HTTP route. The browser, and the CLI run by a
 * human, send no agent identity: the human. A call carrying an agent identity
 * (`x-fleex-actor-type: agent`, set by the CLI from the env of an agent run) is
 * not a human decision and must not be protected as one: `system`. The
 * assistant never comes through here — its stops go through its thread tools.
 */
export function stopAuthorFromHeaders(headers: HeaderBag): Extract<StopAuthor, 'user' | 'system'> {
  const raw = headers['x-fleex-actor-type'];
  return (Array.isArray(raw) ? raw[0] : raw) === 'agent' ? 'system' : 'user';
}
