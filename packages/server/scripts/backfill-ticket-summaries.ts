#!/usr/bin/env bun
/**
 * Backfill ticket summaries for historical tickets.
 *
 * Generates ticket-summary deliverables for all tickets in done/cancelled status
 * that don't already have one.
 *
 * Usage:
 *   bun run packages/server/scripts/backfill-ticket-summaries.ts [--dry-run] [--delay=2000] [--status=done,cancelled]
 */

import { createContainer } from '../src/infrastructure/container.js';

interface Args {
  dryRun: boolean;
  delay: number;
  statuses: string[];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    dryRun: false,
    delay: 2000,
    statuses: ['done', 'cancelled'],
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg.startsWith('--delay=')) {
      result.delay = parseInt(arg.split('=')[1]!, 10);
    } else if (arg.startsWith('--status=')) {
      result.statuses = arg.split('=')[1]!.split(',');
    }
  }

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs();
  console.log('🔍 Backfill ticket summaries');
  console.log(`   Dry run: ${args.dryRun}`);
  console.log(`   Delay: ${args.delay}ms`);
  console.log(`   Statuses: ${args.statuses.join(', ')}`);
  console.log('');

  const container = await createContainer();
  const { ticketStore, deliverableStore, generateTicketSummary } = container;

  // Get all boards to iterate through tickets
  const boards = await ticketStore.getAllBoards();
  const allTickets = [];

  for (const board of boards) {
    const tickets = await ticketStore.getTicketsByBoard(board.id);
    allTickets.push(...tickets);
  }

  // Filter to done/cancelled tickets
  const closedTickets = allTickets
    .filter((t) => args.statuses.includes(t.status))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  console.log(`📋 Found ${closedTickets.length} tickets in [${args.statuses.join(', ')}] status`);

  // Check which ones already have summaries
  const toProcess = [];
  let skipped = 0;

  for (const ticket of closedTickets) {
    const existing = await deliverableStore.getByTicketAndType(ticket.id, 'ticket-summary');
    if (existing) {
      skipped++;
    } else {
      toProcess.push(ticket);
    }
  }

  console.log(`   ${toProcess.length} need summaries`);
  console.log(`   ${skipped} already have summaries (skipped)`);
  console.log('');

  if (args.dryRun) {
    console.log('🏃 DRY RUN — would process:');
    for (const ticket of toProcess) {
      console.log(`   #${ticket.displayId} [${ticket.status}] ${ticket.title}`);
    }
    console.log('');
    console.log('Done (dry run). No summaries generated.');
    process.exit(0);
  }

  let created = 0;
  const errors: Array<{ ticketId: string; title: string; error: string }> = [];

  for (let i = 0; i < toProcess.length; i++) {
    const ticket = toProcess[i]!;
    console.log(`[${i + 1}/${toProcess.length}] Processing #${ticket.displayId}: ${ticket.title}`);

    try {
      await generateTicketSummary.execute({
        ticketId: ticket.id,
        status: ticket.status as 'done' | 'cancelled',
      });
      created++;
      console.log(`   ✅ Summary created`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ ticketId: ticket.id, title: ticket.title, error: errorMsg });
      console.log(`   ❌ Error: ${errorMsg}`);
    }

    // Throttle between requests
    if (i < toProcess.length - 1) {
      await sleep(args.delay);
    }
  }

  console.log('');
  console.log('═══════════════════════════════');
  console.log('📊 Backfill Report');
  console.log('═══════════════════════════════');
  console.log(`✅ ${created} summaries created`);
  console.log(`❌ ${errors.length} errors`);
  console.log(`⏭️  ${skipped} tickets skipped (already had summary)`);

  if (errors.length > 0) {
    console.log('');
    console.log('Errors:');
    for (const e of errors) {
      console.log(`   ${e.ticketId}: ${e.error}`);
    }
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
