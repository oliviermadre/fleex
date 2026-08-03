# Fleex — Claude Code Guidelines

## Migrations

**Never modify an existing migration file once it has been committed.** Migrations may have already been executed on production databases (SQLite, PostgreSQL, Supabase). Always create a new migration file with the next sequence number to apply fixes or schema changes.

Pattern: `packages/server/src/infrastructure/migrations/migrations/NNN_description.ts`

## Supabase RLS

When creating new tables in a migration, always add RLS policies for Supabase:

```typescript
if (ctx.adapter === 'supabase') {
  await ctx.exec('ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY');
  await ctx.exec(
    `CREATE POLICY "service_role_<table_name>" ON <table_name> FOR ALL USING (true) WITH CHECK (true)`,
  );
}
```
