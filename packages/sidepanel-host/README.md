# @fleex/sidepanel-host

Local companion for the Fleex Chrome side panel assistant. Holds the Anthropic
API key, runs the tool-use loop **server-side**, gates mutating tool calls
behind a confirmation round-trip, and executes tools via the fleex CLI. The
browser extension is a thin client.

## Run

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# production (fleex on PATH)
bun run packages/sidepanel-host/src/server.ts
# in-repo dev (run the CLI via bun)
FLEEX_MCP_BIN=bun FLEEX_MCP_PREFIX="run /path/to/fleex/packages/cli/index.ts" \
  bun run packages/sidepanel-host/src/server.ts
```

| Env | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Required for live use |
| `FLEEX_SIDEPANEL_PORT` | Listen port (default 4399) |
| `FLEEX_SIDEPANEL_MODEL` | Model id (default `claude-opus-4-8`) |
| `FLEEX_MCP_BIN` / `FLEEX_MCP_PREFIX` | fleex binary + prefix args |

## HTTP

- `GET /health` → `{ ok, tools }`
- `GET /workspaces` → `[{ name, isDefault }]`
- `GET /chat` → WebSocket upgrade

## WebSocket protocol (`/chat`)

Client → server:

| `type` | Fields | Effect |
|---|---|---|
| `user` | `text` | Run an assistant turn |
| `page` | `content`, `url?`, `title?` | Attach current page (used once, as untrusted reference) |
| `set_workspace` | `workspace` | Target a workspace (injected as `--workspace`) |
| `confirm` | `id`, `approved` | Approve/deny a pending mutating tool call |

Server → client:

| `type` | Fields |
|---|---|
| `text` | `text` (streamed delta) |
| `tool_call` | `id`, `name`, `input`, `argv`, `mutating` |
| `confirm_request` | `id`, `name`, `argv`, `input` — render a confirm prompt |
| `tool_result` | `id`, `name`, `ok`, `text` |
| `tool_denied` | `id`, `name` |
| `done` | `stopReason` |
| `error` | `message` |
| `workspace` / `page_attached` | acks |

**Gating:** read-only tools run automatically; mutating tools emit
`confirm_request` and block until the client replies with `confirm`. The loop,
gating, and streaming are unit-tested in `tests/assistant.test.ts`.
