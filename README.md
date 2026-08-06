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
