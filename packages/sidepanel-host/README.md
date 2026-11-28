# @fleex/sidepanel-host

The companion behind the Fleex **Assistant**: the web/desktop panel, the mobile
tab and the Chrome side panel all talk to it over one WebSocket.

Each conversation is a **Claude Agent SDK session**, built by the same function
as a persona run in edit mode (`buildSdkOptions('edit')` in `@fleex/shared`):

- every Claude Code tool (Read, Write, Edit, Bash, Glob, Grep, Skill, Web…),
  `AskUserQuestion` aside (the Assistant asks in text);
- the user's and the project's MCP servers and skills (`settingSources`);
- the whole `fleex` CLI through Bash;
- `bypassPermissions`, and the persona env (`FLEEX_ACTOR_*` signed
  `Assistant`, background tasks off) plus `FLEEX_WORKSPACE` of the conversation;
- Claude Code's own login, `ANTHROPIC_API_KEY` as a fallback.

Its cwd is the **conversation folder** `<basePath>/workspaces/assistant-<8 hex>`
(`basePath` of the conversation's workspace in `~/.fleex/workspaces.json`),
created on the first message with a `{ kind: 'assistant' }` `.fleex.json`, and
deleted with the conversation. `fleex worktree cleanup` lists these folders
(`assistant_workspace`) and never removes them.

**The one confirmation:** a `Write`, `Edit` or `NotebookEdit` whose target
(symlinks followed) is outside the conversation folder waits for the user —
a `PreToolUse` hook awaits the answer. "Always" lets later outside writes of
that conversation through (persisted, shown as a removable chip). Bash, MCP and
`fleex` are never blocked.

## Run

```bash
# production (fleex on PATH)
bun run packages/sidepanel-host/src/server.ts
# in-repo dev (run the CLI via bun)
FLEEX_MCP_BIN=bun FLEEX_MCP_PREFIX="run /path/to/fleex/packages/cli/index.ts" \
  bun run packages/sidepanel-host/src/server.ts
```

| Env | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Fallback when Claude Code is not logged in |
| `FLEEX_SIDEPANEL_PORT` | Listen port (default 4399) |
| `FLEEX_SIDEPANEL_MODEL` | Model id (default `claude-opus-5`) |
| `FLEEX_SIDEPANEL_ALLOWED_ORIGINS` | Extra WebSocket origins, comma-separated. Listing a `chrome-extension://<id>` pins the extension: other extensions are refused |
| `FLEEX_MCP_BIN` / `FLEEX_MCP_PREFIX` | fleex binary + prefix args (badges catalogue, ticket picker, attach) |
| `FLEEX_SIDEPANEL_DEV` | `1` enables hot reload of the extension |
| `FLEEX_EXTENSION_DIR` | Override the watched extension dir (default: repo `extension/`) |

## HTTP

- `GET /health` → `{ ok, engine, hasApiKey }`
- `GET /workspaces`, `GET /models`, `GET /theme`
- `GET /chat` → WebSocket upgrade. **Origins:** none (non-browser, local
  only since the host listens on `127.0.0.1`), `localhost` / `127.0.0.1`,
  `https://<this machine's tailnet name>` (read from `tailscale status`, never
  any `*.ts.net`: Funnel lets anyone publish one), `chrome-extension://` (any,
  unless one is pinned in `FLEEX_SIDEPANEL_ALLOWED_ORIGINS`), plus
  `FLEEX_SIDEPANEL_ALLOWED_ORIGINS`. Anything else gets a 403: the Assistant
  runs Bash without asking, and browsers let any page open a WebSocket to
  localhost.

The host listens on **`127.0.0.1` only**: the LAN and the tailnet cannot reach
it directly. The phone goes through the Vite proxy (`/companion`) or
`tailscale serve`, which both connect from the machine itself.

## WebSocket protocol (`/chat`)

Conversations are multiplexed by `sessionId` and persisted to
`~/.fleex/.sidepanel/sessions/<id>.json`.

Client → server:

| `type` | Fields | Effect |
|---|---|---|
| `list_sessions` / `new_session` / `open_session` / `rename_session` / `delete_session` / `set_workspace` / `set_model` / `record_exchange` | as before | Conversation management. `open_session` also re-sends pending confirmations and the MCP status; `delete_session` deletes the folder too |
| `user` | `sessionId`, `text` | Run a turn |
| `continue` | `sessionId` | Go on after `max_turns` (a technical "Continue." turn) |
| `stop` | `sessionId` | Interrupt the turn; a pending confirmation is refused |
| `page` | `sessionId`, `content`, `url?`, `title?` | Attach the current page to the next turn (data, never instructions) |
| `confirm` | `id`, `decision: 'allow' \| 'deny' \| 'always'` | Answer an outside-folder write |
| `set_outside_writes` | `sessionId`, `allowed` | The ⚡ chip |
| `open_path` / `reveal_folder` | `sessionId`, `path?` | Open a file of the folder / reveal the folder (paths outside the folder are refused) |
| `list_tickets` | `sessionId`, `query?` | Ticket picker → `tickets` |
| `attach_artifact` | `sessionId`, `path`, `ticketId`, `displayId?` | `fleex ticket deliverable add … --agent-name Assistant` → `artifact` updated, or `artifact_attach_failed` |

Server → client (all carry `sessionId`):

| `type` | Fields |
|---|---|
| `sessions` | `[{ id, title, workspace?, model?, status, messageCount, createdAt, lastMessageAt, workDir?, outsideWritesAllowed, legacy }]` |
| `session_history` | `id`, `transcript` (`{role,text}`, `{tool}`, `{artifact}`, `{notice}`) |
| `text` | `text` (a whole text block, appended) |
| `tool_call` | `id`, `name`, `toolKind`, `target`, `input`, `access?` (fleex badge), `outsideWorkDir?` |
| `tool_result` | `id`, `name`, `status`, `ok`, `text`, `exitCode?`, `truncated?`, `outsideAutoAllowed?` |
| `confirm_request` | `id`, `tool`, `path`, `diff`, `isNewFile` |
| `artifact` | `turnId`, `card`, `replaces?` · `artifact_modified` `path` |
| `mcp_status` | `servers: [{ name, status, error? }]` |
| `max_turns` | `limit` · `notice` `notice` |
| `auth_missing` · `tickets` · `error` · `done` · `page_attached` | |

Tested in `tests/runner.test.ts` (whole turns against a scripted SDK), plus one
test file per module.
