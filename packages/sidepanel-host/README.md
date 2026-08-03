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

| Env                                  | Meaning                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                  | Required for live use                                                                  |
| `FLEEX_SIDEPANEL_PORT`               | Listen port (default 4399)                                                             |
| `FLEEX_SIDEPANEL_MODEL`              | Model id (default `claude-opus-5`)                                                     |
| `FLEEX_MCP_BIN` / `FLEEX_MCP_PREFIX` | fleex binary + prefix args                                                             |
| `FLEEX_SIDEPANEL_DEV`                | `1` enables hot reload: watch the extension dir and tell the panel to reload on change |
| `FLEEX_EXTENSION_DIR`                | Override the watched extension dir (default: repo `extension/`)                        |

## HTTP

- `GET /health` → `{ ok, tools }`
- `GET /workspaces` → `[{ name, isDefault }]`
- `GET /chat` → WebSocket upgrade

## WebSocket protocol (`/chat`)

Multiple conversations (**sessions**) are multiplexed over one socket, routed by
`sessionId`. Sessions are persisted to `~/.fleex/.sidepanel/sessions/<id>.json`
and survive a restart (a stale `working` status is reset to `idle` on load).

Client → server:

| `type`             | Fields                                   | Effect                                                                                                                         |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `list_sessions`    | —                                        | Request the session list                                                                                                       |
| `new_session`      | `workspace?`                             | Create a conversation; replies `session_created`                                                                               |
| `open_session`     | `id`                                     | Fetch a conversation's transcript (on switch)                                                                                  |
| `rename_session`   | `id`, `title`                            | Rename                                                                                                                         |
| `delete_session`   | `id`                                     | Close/delete                                                                                                                   |
| `set_workspace`    | `id`, `workspace`                        | Set a conversation's workspace (`--workspace`)                                                                                 |
| `user`             | `sessionId`, `text`                      | Run an assistant turn                                                                                                          |
| `page`             | `sessionId`, `content`, `url?`, `title?` | Attach current page (used once, untrusted)                                                                                     |
| `confirm`          | `sessionId`, `id`, `approved`, `always?` | Approve/deny a pending mutating tool call. `always: 'tool' \| 'session'` also grants a standing approval (ignored on a denial) |
| `set_auto_approve` | `id`, `all`, `tools`                     | Replace a conversation's auto-approval state (full replacement, not a patch)                                                   |

Server → client:

| `type`                  | Fields                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`              | `sessions: [{ id, title, workspace?, status, messageCount, createdAt, autoApprove }]` — drives the sidebar; re-sent on every change |
| `session_created`       | `id`                                                                                                                                |
| `session_history`       | `id`, `transcript` — re-render the chat on switch                                                                                   |
| `text`                  | `sessionId`, `text` (streamed delta)                                                                                                |
| `tool_call`             | `sessionId`, `id`, `name`, `input`, `argv`, `mutating`, `autoApproved`                                                              |
| `confirm_request`       | `sessionId`, `id`, `name`, `argv`, `input`                                                                                          |
| `tool_result`           | `sessionId`, `id`, `name`, `ok`, `text`                                                                                             |
| `tool_denied`           | `sessionId`, `id`, `name`                                                                                                           |
| `done`                  | `sessionId`, `stopReason`                                                                                                           |
| `error`                 | `sessionId?`, `message`                                                                                                             |
| `page_attached`         | `sessionId`, `title`                                                                                                                |
| `auto_approve_disarmed` | `sessionId`, `reason: 'page_attached'`                                                                                              |

**Status** (`idle` / `working` / `awaiting_input`) is broadcast via `sessions`
so the sidebar shows, per conversation, whether the LLM is working, waiting for
your confirmation, or idle.

**Gating:** read-only tools run automatically; mutating tools emit
`confirm_request` and block until the client replies with `confirm`.

**Auto-approval** (`⚡ Always allow`) short-circuits that round-trip for a
command name — or for everything — within **one conversation**. It is stored on
the session (so it survives a companion restart mid-batch), never inherited by
a new conversation, and wiped when a page is attached (untrusted content is the
injection vector the gate defends against). The predicate is re-read on every
call, so approving the first of 50 `ticket create` calls clears the other 49 in
the same turn.

The loop, gating, and streaming are unit-tested in `tests/assistant.test.ts`;
the session store in `tests/sessions.test.ts`; the auto-approval decisions in
`tests/auto-approve.test.ts`.
