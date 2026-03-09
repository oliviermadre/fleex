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
- **9 built-in themes** — Fleex, Ember, Ocean, Verdant, Light, Dark, Matrix, Summer, Fall
- **Multi-machine support** — gateway architecture for remote hosts

## Architecture

```
Browser (React 19)  ←→  Server (Fastify)  ←→  Host Gateway (Bun)
     UI + xterm.js         API + WebSocket        tmux + PTY + fs
```

4 packages: `web`, `server`, `shared`, `host-gateway`

Storage: SQLite (default), JSON, PostgreSQL

## Prerequisites

- [git](https://git-scm.com/)
- [bun](https://bun.sh/)
- [tmux](https://github.com/tmux/tmux)
- [claude](https://docs.anthropic.com/en/docs/claude-cli) — Anthropic CLI
- [gh](https://cli.github.com/) — GitHub CLI (optional, recommended)

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/oliviermadre/fleex/main/install.sh | bash
```

The interactive setup wizard will walk you through:
- Display name and base worktree path
- Storage driver selection (SQLite, JSON, or PostgreSQL)

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

## CLI Reference

| Command | Description |
|---------|-------------|
| `fleex start [--port <port>]` | Start all services (gateway, server, web) |
| `fleex stop [name]` | Stop current or named instance |
| `fleex stop --all` | Stop all running instances |
| `fleex restart` | Restart current instance |
| `fleex status` | Show status of all instances |
| `fleex logs [svc]` | Tail logs (all, gateway, server, web) |
| `fleex remove [name]` | Remove a stopped instance |
| `fleex remove --all-stopped` | Remove all stopped instances |
| `fleex self-update` | Pull latest and update CLI |

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | React 19, Zustand, xterm.js, Tailwind CSS 4, Vite |
| Backend | Fastify 5, WebSocket, Pino |
| Gateway | Bun, PTY |
| Storage | SQLite / PostgreSQL / JSON |
| Runtime | Bun (dev + gateway), Node.js (server) |

## Development

```bash
git clone git@github.com:oliviermadre/fleex.git
cd fleex
bun install
fleex start
```

## License

TBD
