import { cn } from '../../lib/cn';
import { costTier, formatTicketCost } from '../../lib/cost';
import { tint } from '../../lib/tints';

const BADGE_CLASS =
  'inline-flex flex-shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium font-mono';

/**
 * Cumulative agentic cost of a ticket, shown centred in the Kanban card header
 * (#404). Colour escalates green → yellow → red → near-black as cost rises so
 * the board reads "cheap → very expensive" at a glance.
 *
 * Renders nothing at $0 (no execution / no computed cost) so backlog cards stay
 * clean — the caller keeps its spacers around this so the header layout is
 * unchanged when the badge is absent.
 */
export function CostBadge({ costUsd }: { costUsd: number }) {
  if (costUsd <= 0) return null;

  const tier = costTier(costUsd);
  const label = formatTicketCost(costUsd);
  const title = `Coût cumulé agentique : ${label}`;

  if (tier.kind === 'tint') {
    return (
      <span className={cn(BADGE_CLASS, tint(tier.hue))} title={title}>
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(BADGE_CLASS, 'border')}
      style={{ backgroundColor: tier.bg, color: tier.fg, borderColor: tier.border }}
      title={title}
    >
      {label}
    </span>
  );
}
