# Fleex — Dockerized test stack

A throwaway, self-contained stack for **visually testing a feature** end-to-end
and **capturing screenshots** — without installing Bun, tmux, or the Claude CLI
on your machine.

It boots the three runtime services with live-reload:

```
web (Vite :5173)  →  server (Fastify :3000)  →  gateway (Bun :3001)
   React UI            API + WebSocket            fs / exec / pty
```

Storage uses the **SQLite** driver on a dedicated volume (`/data/fleex.db`), so
each `down -v` gives you a clean slate. The repository is bind-mounted into the
containers, so editing source on the host hot-reloads the running services.

## Prerequisites

- Docker Engine + Compose v2 (`docker compose`)
- Nothing else — Bun, Node and Playwright all live inside the images.

## Usage

All commands run from the repo root.

```bash
# Start (first run builds the image + installs deps — a few minutes)
docker compose -f docker-compose.test.yml up -d --build

# Open the UI
open http://localhost:5173        # macOS  (xdg-open on Linux)

# Tail logs
docker compose -f docker-compose.test.yml logs -f server web

# Stop and wipe all data/volumes
docker compose -f docker-compose.test.yml down -v
```

| Service   | URL / port              | Notes                                  |
|-----------|-------------------------|----------------------------------------|
| web       | http://localhost:5173   | Vite dev server (hot reload)           |
| server    | http://localhost:3000   | Fastify API + WebSocket                |
| gateway   | http://localhost:3001   | Bun fs/exec/pty                        |

### Screenshots

The `shot.sh` helper runs a one-off Playwright container against the stack and
drops a PNG into `test-stack/screenshots/`:

```bash
./test-stack/shot.sh                  # home page, auto-named
./test-stack/shot.sh /board board.png # a specific route
./test-stack/shot.sh / home.png --full # full-page capture
```

Under the hood that is just:

```bash
docker compose -f docker-compose.test.yml --profile tools \
  run --rm --build screenshot <path-or-url> <output.png> [--full]
```

Tunables (env vars on the `screenshot` service / `shot.sh` invocation):
`WAIT_MS`, `VIEWPORT_WIDTH`, `VIEWPORT_HEIGHT`, `FLEEX_URL`.

## Notes

- **`ANTHROPIC_API_KEY`** — optional. If exported in your shell before `up`, it
  is forwarded to the server to enable live model discovery in the UI;
  otherwise a static fallback list is used.
- The `gateway` container has no `git`/`tmux`/`claude` — flows that shell out to
  those on a real host won't fully work here. This stack targets **UI / API
  visual testing**, not live agent orchestration.
- First boot is slow (image build + `bun install`); subsequent boots reuse the
  `app_node_modules` volume and the built image.
