# Fleex — Claude Code Guidelines

## Front-end (`packages/web`)

Any UI work: read `packages/web/CLAUDE.md` first — reusable primitives (one `toast()` for every notification) and how to treat HTML prototypes.

## Migrations

**Never modify an existing migration file once it has been committed.** Migrations may have already been executed on production databases (SQLite, PostgreSQL, Supabase). Always create a new migration file with the next sequence number to apply fixes or schema changes.

Pattern: `packages/server/src/infrastructure/migrations/migrations/NNN_description.ts`

## Supabase RLS

When creating new tables in a migration, always add RLS policies for Supabase:

```typescript
if (ctx.adapter === 'supabase') {
  await ctx.exec('ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY');
  await ctx.exec(`CREATE POLICY "service_role_<table_name>" ON <table_name> FOR ALL USING (true) WITH CHECK (true)`);
}
```

## End-to-end QA (agents included)

"Stack not running" is not a reason to stop. If your ticket touches the CLI, the API, the server or the MCP, run the end-to-end QA yourself on the **`qa` workspace** (throwaway SQLite, one DB per instance, event hub and Supabase blanked, no API key), then clean up.

Always from your worktree root, always with the worktree's CLI and `--workspace qa` (agents inherit `FLEEX_WORKSPACE=default`, so anything without the flag targets `default@<branch>`):

```bash
bun packages/cli/index.ts start --workspace qa              # server.log must say: SQLite storage initialized + Event hub disabled
bun packages/cli/index.ts board create --name QA --workspace qa
bun packages/cli/index.ts ticket show 1 --workspace qa
FLEEX_WORKSPACE=qa bun packages/cli/index.ts mcp start       # MCP (stdio)
# API: the `server` port printed by start → curl http://localhost:<port>/api/...
```

Compare with `main` (same commands on both sides, then `diff`, normalising UUIDs and timestamps):

```bash
git worktree add -b qa/<n>-base ../qa-<n>-base origin/main   # NAMED branch, else the instance is qa@HEAD
cp .env ../qa-<n>-base/ && (cd ../qa-<n>-base && bun install && bun packages/cli/index.ts start --workspace qa)
```

Clean up, always, even when the QA fails — both instances from YOUR worktree (its `stop` only reaps processes listening on the instance's ports; older ones also killed clients, i.e. the user's own stack):

```bash
bun packages/cli/index.ts stop --workspace qa && bun packages/cli/index.ts remove --workspace qa
bun packages/cli/index.ts stop qa@qa-<n>-base && bun packages/cli/index.ts remove qa@qa-<n>-base
find ~/.fleex/qa -maxdepth 1 \( -name 'qa@<branch-slug>.db*' -o -name 'qa@qa-<n>-base.db*' \) -delete   # branch-slug = branch, / → -
git worktree remove --force ../qa-<n>-base && git branch -D qa/<n>-base
```

Forbidden:
- `fleex start` without `--workspace qa` in a worktree: it boots your branch on the default workspace (production Supabase), applies your pending migrations to it and, at boot, marks EVERY running agent execution as interrupted — yours included.
- The `sqlite` workspace (that is the user's own data) and the `fleex` on the PATH (it runs `~/.fleex/repo`, not your code).
- If `qa` is missing from `~/.fleex/workspaces.json` (check: `jq -e '.workspaces | map(.name) | index("qa")' ~/.fleex/workspaces.json`): start nothing, report it.

To talk to the real Fleex (comment, link a PR) from a worktree: run the command from outside the repo (`cd ~ && fleex ...`). Inside it, the CLI targets the worktree's own stack.

Limits: the DB starts empty (create fixtures through the CLI), SQLite only — Supabase/pgsql-specific code → unit tests + say so in the report. No real agent runs (empty API key).

QA report: commands run, branch vs `main` outputs, verdict, proof of cleanup.
