/**
 * Pure helpers behind the queue's PR glyph: turn a ticket's `github_pr` links and
 * the bulk PR details into WorkPrLinks, and pick the one state the glyph shows for
 * the whole ticket.
 */
import type { TicketLink } from '@fleex/shared';
import type { PullRequestDetails } from '../../../services/api';
import type { WorkPrLink, WorkPrState } from '../types';

const PR_REF_RE = /^([^/]+)\/([^#]+)#(\d+)$/;

/** GitHub's state and draft flag → the glyph's state; null when GitHub hasn't answered. */
export function toWorkPrState(details: Pick<PullRequestDetails, 'state' | 'isDraft'> | undefined): WorkPrState | null {
  if (!details) return null;
  if (details.state === 'MERGED') return 'merged';
  if (details.state === 'CLOSED') return 'closed';
  return details.isDraft ? 'draft' : 'open';
}

/** The ticket's PRs in link order; links whose ref isn't "org/name#number" are skipped. */
export function prLinksFor(
  links: readonly TicketLink[],
  details: Readonly<Record<string, PullRequestDetails>>,
): WorkPrLink[] {
  const prs: WorkPrLink[] = [];
  for (const link of links) {
    if (link.type !== 'github_pr') continue;
    const match = link.ref.match(PR_REF_RE);
    if (!match) continue;
    const [, org, name, number] = match;
    const d = details[link.ref];
    prs.push({
      ref: link.ref,
      label: `${name}#${number}`,
      url: link.url ?? d?.url ?? `https://github.com/${org}/${name}/pull/${number}`,
      state: toWorkPrState(d),
      title: d?.title ?? null,
      additions: d?.additions ?? null,
      deletions: d?.deletions ?? null,
    });
  }
  return prs;
}

/** Most actionable first: something still open beats a draft, beats merged, beats closed. */
const STATE_PRIORITY: WorkPrState[] = ['open', 'draft', 'merged', 'closed'];

/** The state the glyph shows for a whole ticket; null while none has loaded. */
export function aggregatePrState(prs: readonly Pick<WorkPrLink, 'state'>[]): WorkPrState | null {
  return STATE_PRIORITY.find((state) => prs.some((pr) => pr.state === state)) ?? null;
}
