import type { Migration } from '../types.js';

/**
 * Migration 003: Add files table for uploaded file metadata.
 */
const migration: Migration = {
  name: '008_add_files_table',

  async up(ctx) {
    const filesSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (filesSql) await ctx.exec(filesSql);

    // Supabase RLS + Storage bucket
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE files ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`
        DO $$ BEGIN
          CREATE POLICY "service_role_files" ON files FOR ALL USING (true) WITH CHECK (true);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);

      // Create the storage bucket for file uploads
      await ctx.exec(
        `INSERT INTO storage.buckets (id, name, public) VALUES ('files', 'files', false) ON CONFLICT (id) DO NOTHING`,
      );

      // Allow service_role full access to storage objects in the "files" bucket
      await ctx.exec(`
        DO $$ BEGIN
          CREATE POLICY "service_role_files_objects" ON storage.objects
          FOR ALL
          USING (bucket_id = 'files')
          WITH CHECK (bucket_id = 'files');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS files');
  },
};

export default migration;
