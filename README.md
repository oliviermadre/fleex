# Fleex

A web-based control center for orchestrating AI coding agents across repositories.

Manage multiple Claude agents, monitor terminals in real time, track work via kanban, and configure your entire AI development workflow — all from a single browser tab.

<!-- screenshot -->

## Features

- **Multi-repo terminal management** — tmux sessions with live xterm.js streaming
- **AI agent orchestration** — personas, @mention-based task handoff, structured deliverables
- **Kanban board** — 5-column workflow: backlog, todo, doing, reviewing, done
- **Repository dashboard** — PRs, issues, worktrees, diff stats via GitHub GraphQL
- **Real-time everything** — 7 WebSocket channels, live agent event streaming
- **Claude config editor** — tree-based editor for `~/.claude` configs
- **Scratchpads** — auto-saving markdown notes per repo
- **10 built-in themes** — Fleex, Ember, Ocean, Verdant, Light, Dark, Matrix, Summer, Fall, Catppuccin Latte
- **Multi-machine support** — gateway architecture for remote hosts
- **Mobile PWA** — kanban, tickets and live SDK agent sessions from your phone over Tailscale ([docs/mobile.md](docs/mobile.md))

## Architecture

```
Browser (React 19)  ←→  Server (Fastify)  ←→  Host Gateway (Bun)
     UI + xterm.js         API + WebSocket        tmux + PTY + fs
```

4 packages: `web`, `server`, `shared`, `host-gateway`

Storage: SQLite (default), PostgreSQL, Supabase

## Prerequisites

- [git](https://git-scm.com/)
- [bun](https://bun.sh/) v1.3.5 minimum !
- [tmux](https://github.com/tmux/tmux)
- [claude](https://docs.anthropic.com/en/docs/claude-cli) — Anthropic CLI
- [gh](https://cli.github.com/) — GitHub CLI (optional, recommended)

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/oliviermadre/fleex/main/install.sh | bash
```

The interactive setup wizard will walk you through:
- Display name and base worktree path
- SQLite database file path (SQLite is the only backend offered at install time)

It seeds 3 default agent personas and a Personal board to get you started.

## Quick Start

```bash
fleex start
```

Opens your browser to the Fleex UI. From there you can add repositories, spin up agents, and start working.

```bash
fleex status
```

Check the status of all running instances.

## Optional environment

Some features rely on third-party APIs and are gracefully skipped when their
credentials are absent.

| Variable | Used for | If missing |
|---|---|---|
| `ANTHROPIC_API_KEY` | Dynamic discovery of available Claude models via `GET /api/models` (drives every model dropdown in the UI). | A static fallback list is served — Fleex stays usable, but new Anthropic releases won't appear until the fallback is updated in code. |

Export the key in the shell that launches Fleex (`fleex start`), e.g.:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
fleex start
```

Or set it once per workspace in the `env` block of `~/.fleex/workspaces.json` (see
[Workspaces](#workspaces) below), which keeps secrets in a single `0600` file.

## Semantic memory (beta)

By default, the context injected into agent prompts is chosen by ranking past
ticket summaries on shared tags, board and recency. The semantic engine instead
retrieves by meaning across everything indexed — summaries, comment threads,
routine outputs, notes, epics, skills and agent memory.

It is opt-in, under **Settings › Memory**, which also shows what the index holds
and offers a reindex. Switching is reversible and leaves the index in place.

Before switching, **shadow mode** answers what switching would change: runs keep
using the current ranking, and the semantic engine's choice is recorded alongside
it — visible in the **Context** tab of any execution, marked as not injected, with
the items only it found highlighted. That tab also shows the prompt exactly as it
was sent, in both a browsable outline and raw form.

Embeddings run **locally** — no API, and no network once the model is cached in
`~/.fleex/models/`. The encoder (`@huggingface/transformers`) is an optional
dependency, so a normal install provides it and there is nothing to add by hand;
an install that skipped it — an unsupported platform for the ONNX runtime, or
`--omit=optional` — still indexes everything and keeps it findable by keyword,
with retrieval falling back to the default ranking rather than degrading a run's
context. It is picked up as soon as it appears, without restarting Fleex.

Anything indexed while the model was still downloading is embedded by a background
sweep once it is ready — nothing has to be re-saved to become searchable.

Three multilingual encoders are selectable in the same panel, from 112 MB at 384
dimensions to 300 MB at 768, and switching between them is a setting rather than a
migration: every chunk records the model that embedded it, retrieval only considers
vectors from the configured one, and the same sweep re-embeds the rest in the
background. **Measure** reports recall and MRR on your own corpus — the only
benchmark that answers which encoder to keep. Embeddings can also be delegated to a
local **Ollama** daemon when one is already running, which is much faster with a GPU
behind it; never the default, since it is another process to keep up.

Once the engine is on, the index stays current by itself — a listener re-indexes
whatever a domain event touched — and everything built on top of it is
individually switchable in the same panel:

| Feature | What it does | Cost |
|---|---|---|
| Search in the command palette | `⌘K` text matching no command searches memory instead | local |
| Answer questions from memory | `fleex memory ask` and the matching assistant tool: a cited answer drawn from past work | one LLM call per question |
| Prefer the current repository | Ranks notes and decisions from a ticket's repo above equally similar material elsewhere | local |
| Warn about similar tickets | Surfaces existing tickets while a new title is typed | local |
| Prioritise your corrections | Discussions where you corrected an agent rank above ordinary ones | local |
| Coach your agents | Proposes amendments to an agent's memory from the times you corrected it — always for review, never applied on its own | one LLM call per proposal |
| Compile what you know | Builds a sourced reference document about a subject, with contradictions and open questions called out | one LLM call per document |
| Save moments from runs | Lift a paragraph out of an execution and keep it as a note, ranked above the output it came from | local |
| Remember conversations | Distils each assistant conversation as it ends, so preferences survive it | one LLM call per conversation |
| Suggest routines | Spots a skill or agent you rerun on a regular cadence and proposes the schedule — arithmetic over the execution log, no model. Lives under `fleex routine suggest` | local |
| Relate notes | Surfaces notes the index finds close to the one you are reading | local |
| Learn from finished runs | Distils what each run discovered about the codebase — what worked, what failed, which files mattered | one LLM call per run |
| Remember terminal sessions | Distils `claude` sessions run outside a ticket worktree and files them under their repository | one LLM call per session |

Every one of them is reachable from all three surfaces: the API, the CLI, and the
UI it belongs to — the palette for search and questions, the ticket form for
duplicates, the agent editor for coaching, the execution log for curation, the
routines panel for suggestions, the documents library for compilations, and the
notes view for links.

Write `@scratchpad:global` or `@scratchpad:owner/name` in any note, ticket
description or comment to link to a note. The `@` picker for it lives in the
main note editor.
Backlinks appear under the note. Both work on either memory engine.

From the terminal:

```bash
fleex memory engine                      # engine, encoder, budget, feature switches
fleex memory engine semantic             # opt into the beta
fleex memory engine --shadow             # record what the beta would inject
fleex memory engine --model EmbeddingGemma-300M
fleex memory engine --disable ask        # same switches as the Settings panel
fleex memory search "session expiry"     # ranked excerpts, offline, no LLM
fleex memory ask "why sessions not JWT?" # cited answer
fleex memory similar "login times out"   # is this ticket already filed?
fleex memory compile "the auth module"   # a sourced reference document
fleex memory coach Builder               # what an agent should have learned
fleex memory keep <executionId>          # keep a moment of a run
fleex memory links owner/app             # backlinks, and related notes when relatedNotes is on
fleex memory status                      # what the index holds
fleex memory reindex                     # walk the corpus again (safe to re-run)
fleex memory bench                       # how well retrieval does on this corpus
```

| Storage driver | Semantic engine |
|---|---|
| `sqlite` (default) | Supported. Vectors are stored as float32 blobs and scored in process — at single-user scale a full scan is a few milliseconds. |
| `supabase` | Supported. Vectors live in a `pgvector` column with an HNSW index and are scored by a `match_memory_chunks` function, so a query never ships the corpus over the network. |
| `pgsql` | Not yet — no index implementation, so the engine reports itself unavailable. |

## CLI Reference

| Command | Description |
|---------|-------------|
| `fleex start [--port <port>] [--workspace <name>]` | Start all services (gateway, server, web) for a workspace |
| `fleex stop [name]` | Stop current or named instance |
| `fleex stop --all` | Stop all running instances |
| `fleex restart [--workspace <name>]` | Restart current instance |
| `fleex status` | Show status of all instances (with workspace + driver) |
| `fleex desktop [--workspace <name>]` | Open the Electron desktop window for a workspace |
| `fleex logs [svc]` | Tail logs (all, gateway, server, web) |
| `fleex remove [name]` | Remove a stopped instance |
| `fleex remove --all-stopped` | Remove all stopped instances |
| `fleex self-update [--workspace <name>] [--all-workspaces]` | Pull latest, update CLI, migrate workspace DB(s) |

## Workspaces

A **workspace** is a named, self-contained configuration (storage driver, database,
event-hub, API keys) for a complete Fleex stack. Workspaces let you run several
independent stacks from a single repo — e.g. a shared team Supabase alongside a
local SQLite sandbox — each as its own gateway/server/web/desktop set.

Workspaces are defined globally in `~/.fleex/workspaces.json`:

```json
{
  "workspaces": [
    {
      "name": "tada",
      "is_default": true,
      "env": {
        "FLEEX_STORAGE_DRIVER": "supabase",
        "SUPABASE_URL": "https://xxxx.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "ey...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    },
    {
      "name": "perso",
      "env": { "FLEEX_STORAGE_DRIVER": "sqlite" }
    }
  ]
}
```

- **`name`** — the workspace identifier used with `--workspace`.
- **`is_default`** — exactly one workspace should set this to `true`; it is used when
  no `--workspace` flag is given. (Multiple defaults, or none, is treated as a
  corrupt file.)
- **`env`** — a nested block of environment variables injected when the workspace is
  activated. **Workspace env wins over everything** — it overrides both shell exports
  and the repo `.env`.

### Secrets

`workspaces.json` holds secrets (Supabase keys, hub tokens, `ANTHROPIC_API_KEY`), so
it is created with `0600` permissions. Fleex warns if the file is more permissive and
never logs its values. Keep it out of version control.

### Running parallel stacks

Each running stack is identified by `<workspace>@<branch>`, so the same branch can run
under several workspaces at once:

```bash
fleex desktop --workspace tada    # tada@main  → Supabase stack + Electron window
fleex desktop --workspace perso   # perso@main → SQLite stack + Electron window
```

`fleex status` shows the **Workspace** and **Driver** of every running instance.

### Scheduled routines across several instances

Instances of the same workspace share one database — two machines on the same Supabase,
or `~/.fleex/repo` plus a worktree on the same `fleex.db` — so they all see the same
routine come due. Two rules keep that from firing it twice:

- **A due occurrence is claimed before it runs.** The instance that atomically moves
  `next_run_at` forward is the only one allowed to launch; the others find the slot
  already taken and move on. Whichever machine is awake takes the routine, so nothing
  is lost when one of them is closed. The routine records which instance won
  (`lastClaimedBy`) — that is how you tell "it ran on the other laptop" from "it never
  ran".
- **Only the canonical install schedules.** A stack started from a worktree does not
  arm its scheduler: a QA instance running an unmerged branch must not execute a
  production routine. Routines still run — on the instance in `~/.fleex/repo`, against
  the same shared database.

`GET /api/routines/scheduler` reports whether the instance you are talking to schedules,
and why. Override the placement rule with `FLEEX_ROUTINE_SCHEDULER=on|off` — `on` to
schedule from a worktree on purpose, `off` to silence one machine of a two-machine setup.

### Updating

`fleex self-update` is workspace-aware:

| Invocation | Migrations run for |
|---|---|
| `fleex self-update` | the `is_default` workspace |
| `fleex self-update --workspace <name>` | the named workspace |
| `fleex self-update --all-workspaces` | every workspace's database |

The code is pulled and rebuilt once; only the database migration step loops per workspace.

### Migration from `.env` (backward compatibility)

Earlier versions stored config in a per-repo `.env` file. No manual migration is needed:

- **Fresh installs** write `~/.fleex/workspaces.json` directly (a single `default`
  workspace) during the setup wizard.
- **Existing installs**: the first `fleex self-update` automatically creates
  `~/.fleex/workspaces.json` from your existing `~/.fleex/repo/.env` (as the `default`
  workspace) when no workspaces file is present. The legacy `.env` continues to work
  as a fallback until then.

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | React 19, Zustand, xterm.js, Tailwind CSS 4, Vite |
| Backend | Fastify 5, WebSocket, Pino |
| Gateway | Bun, PTY |
| Storage | SQLite / PostgreSQL / Supabase |
| Runtime | Bun (dev + gateway), Node.js (server) |

## Development

```bash
git clone git@github.com:oliviermadre/fleex.git
cd fleex
bun install
fleex start
```

## License

[Elastic License 2.0 (ELv2)](LICENSE) — free to use, modify, and self-host. Commercial use by third parties (resale, hosted service, SaaS) is not permitted.
