import type { Migration } from '../types.js';

/**
 * Global, unique display_id for tickets.
 *
 * Until now `display_id` was a per-board sequence (boards.next_display_id) which
 * produced collisions: every board had its own ticket #1, so the API had to be
 * disambiguated by board_id. We replace this with a globally unique counter.
 *
 * Steps (per dialect):
 *   1. Renumber existing tickets by created_at ASC starting at 1.
 *   2. Set up the counter:
 *      - pgsql/supabase: native SEQUENCE + DEFAULT nextval(...) on tickets.display_id.
 *      - sqlite: no extra structure — the adapter inserts using
 *        `(SELECT COALESCE(MAX(display_id), 0) + 1 FROM tickets)`.
 *   3. Add a UNIQUE index on tickets.display_id (zero collisions enforced by the DB).
 *   4. Drop boards.next_display_id (column is now obsolete).
 *
 * Renumbering is irreversible: old display_ids are abandoned by design. The down
 * migration removes the unique index, the sequence, and re-adds next_display_id
 * but cannot restore the original per-board numbering.
 */
const migration: Migration = {
  name: '016_global_display_id',

  async up(ctx) {
    if (ctx.adapter === 'json') return; // JSON adapter computes display_id at runtime

    // ── Step 1: Renumber tickets by created_at ASC (tie-break on id) ──
    const renumberSql = ctx.dialect({
      sqlite: `
        UPDATE tickets SET display_id = (
          SELECT rn FROM (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
            FROM tickets
          ) sub WHERE sub.id = tickets.id
        )
      `,
      pgsql: `
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
          FROM tickets
        )
        UPDATE tickets t SET display_id = o.rn FROM ordered o WHERE t.id = o.id
      `,
      supabase: `
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
          FROM tickets
        )
        UPDATE tickets t SET display_id = o.rn FROM ordered o WHERE t.id = o.id
      `,
      json: null,
    });
    if (renumberSql) await ctx.exec(renumberSql);

    // ── Step 2: Counter setup ──
    if (ctx.adapter === 'pgsql' || ctx.adapter === 'supabase') {
      await ctx.exec(`CREATE SEQUENCE IF NOT EXISTS tickets_display_id_seq`);
      // Cale la sequence sur MAX(display_id) actuel (0 si table vide)
      await ctx.exec(`
        SELECT setval(
          'tickets_display_id_seq',
          GREATEST((SELECT COALESCE(MAX(display_id), 0) FROM tickets), 1),
          (SELECT COALESCE(MAX(display_id), 0) FROM tickets) > 0
        )
      `);
      await ctx.exec(`ALTER TABLE tickets ALTER COLUMN display_id SET DEFAULT nextval('tickets_display_id_seq')`);
      // Lie la séquence à la colonne pour que les dumps/clones la transportent
      await ctx.exec(`ALTER SEQUENCE tickets_display_id_seq OWNED BY tickets.display_id`);
    }

    // ── Step 3: UNIQUE constraint on display_id ──
    const uniqueIdxSql = `CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_display_id_unique ON tickets(display_id)`;
    await ctx.exec(uniqueIdxSql);

    // ── Step 4: Drop boards.next_display_id (now obsolete) ──
    const dropColSql = ctx.dialect({
      sqlite: `ALTER TABLE boards DROP COLUMN next_display_id`,
      pgsql: `ALTER TABLE boards DROP COLUMN IF EXISTS next_display_id`,
      supabase: `ALTER TABLE boards DROP COLUMN IF EXISTS next_display_id`,
      json: null,
    });
    if (dropColSql) {
      try {
        await ctx.exec(dropColSql);
      } catch {
        // SQLite < 3.35 doesn't support DROP COLUMN — leave the column in place,
        // it becomes a harmless legacy field.
      }
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;

    // Drop UNIQUE index
    await ctx.exec(`DROP INDEX IF EXISTS idx_tickets_display_id_unique`);

    // Re-add next_display_id on boards
    const reAddColSql = ctx.dialect({
      sqlite: `ALTER TABLE boards ADD COLUMN next_display_id INTEGER NOT NULL DEFAULT 1`,
      pgsql: `ALTER TABLE boards ADD COLUMN IF NOT EXISTS next_display_id INT NOT NULL DEFAULT 1`,
      supabase: `ALTER TABLE boards ADD COLUMN IF NOT EXISTS next_display_id INT NOT NULL DEFAULT 1`,
      json: null,
    });
    if (reAddColSql) {
      try {
        await ctx.exec(reAddColSql);
      } catch {
        // Column may already exist
      }
    }

    // Restore a best-effort per-board next_display_id = MAX(display_id) + 1 over each board
    const restoreCounterSql = ctx.dialect({
      sqlite: `
        UPDATE boards SET next_display_id = COALESCE(
          (SELECT MAX(display_id) + 1 FROM tickets WHERE tickets.board_id = boards.id),
          1
        )
      `,
      pgsql: `
        UPDATE boards b SET next_display_id = COALESCE(
          (SELECT MAX(display_id) + 1 FROM tickets t WHERE t.board_id = b.id),
          1
        )
      `,
      supabase: `
        UPDATE boards b SET next_display_id = COALESCE(
          (SELECT MAX(display_id) + 1 FROM tickets t WHERE t.board_id = b.id),
          1
        )
      `,
      json: null,
    });
    if (restoreCounterSql) await ctx.exec(restoreCounterSql);

    // Drop sequence + DEFAULT on PG/Supabase
    if (ctx.adapter === 'pgsql' || ctx.adapter === 'supabase') {
      await ctx.exec(`ALTER TABLE tickets ALTER COLUMN display_id DROP DEFAULT`);
      await ctx.exec(`DROP SEQUENCE IF EXISTS tickets_display_id_seq`);
    }

    // Note: the per-ticket display_id values themselves are NOT restored to
    // their pre-renumbering state. That information is permanently lost.
  },
};

export default migration;
