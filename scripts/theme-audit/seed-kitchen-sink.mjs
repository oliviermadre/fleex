/**
 * Kitchen-sink seed (ticket #395): a demo board covering every colored UI
 * variant — status × type × priority × tags × due dates × blocked/favorite ×
 * PR/issue links — so the contrast sweep exercises every badge/tint.
 *
 * Seeds via the HTTP API of a running (throwaway) instance. Idempotent: if
 * the "Kitchen Sink" board already has tickets, seeding is skipped.
 *
 * Usage: node scripts/theme-audit/seed-kitchen-sink.mjs http://localhost:PORT
 */

const STATUSES = ['backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled'];
const TYPES = ['build', 'fix', 'review', 'ops', 'lead', 'think'];
const PRIORITIES = ['none', 'low', 'medium', 'high'];
const TAGS = ['design', 'urgent', 'backend', 'frontend', 'infra', 'docs', 'a11y', 'perf'];

function daysFromNow(n) {
  return new Date(Date.now() + n * 86400_000).toISOString();
}

async function api(base, path, init) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

export async function seedKitchenSink(base) {
  const boards = await api(base, '/boards');
  let board = boards.find((b) => b.name === 'Kitchen Sink');
  if (board) {
    const tickets = await api(base, '/tickets');
    if (tickets.some((t) => t.boardId === board.id)) {
      console.log('  Kitchen Sink board already seeded — skipping.');
      return board;
    }
  } else {
    board = await api(base, '/boards', {
      method: 'POST',
      body: JSON.stringify({ name: 'Kitchen Sink', emoji: '🎨' }),
    });
  }

  // Every status × every type (6×6 grid also cycles priorities, tags, due dates).
  let i = 0;
  for (const status of STATUSES) {
    for (const type of TYPES) {
      const priority = PRIORITIES[i % PRIORITIES.length];
      const tags = [TAGS[i % TAGS.length], TAGS[(i + 3) % TAGS.length]];
      // Cycle due dates: overdue / due tomorrow / due next week / none.
      const dueDate = [daysFromNow(-2), daysFromNow(1), daysFromNow(10), null][i % 4];
      const links =
        i % 6 === 0
          ? [
              { type: 'github_pr', ref: 'acme/fleex#1', label: 'PR #1', url: 'https://github.com/acme/fleex/pull/1' },
              { type: 'github_issue', ref: 'acme/fleex#2', label: 'Issue #2', url: 'https://github.com/acme/fleex/issues/2' },
            ]
          : undefined;
      const ticket = await api(base, '/tickets', {
        method: 'POST',
        body: JSON.stringify({
          boardId: board.id,
          title: `[sink] ${status} / ${type} / ${priority}`,
          description: `Kitchen-sink ticket covering **${status}** × **${type}** × **${priority}**.`,
          status,
          type,
          priority,
          tags,
          dueDate,
          ...(links ? { links } : {}),
        }),
      });
      // Blocked + favorite flags render extra colored affordances on cards.
      if (i % 7 === 0) await api(base, `/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ blocked: true }) });
      if (i % 5 === 0) await api(base, `/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ favorite: true }) });
      i++;
    }
  }
  console.log(`  Seeded Kitchen Sink board with ${i} tickets.`);
  return board;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] || process.env.AUDIT_BASE;
  if (!base) {
    console.error('Usage: node scripts/theme-audit/seed-kitchen-sink.mjs http://localhost:PORT');
    process.exit(2);
  }
  await seedKitchenSink(base.replace(/\/$/, ''));
}
